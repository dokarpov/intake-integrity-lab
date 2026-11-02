-- 011: Durable, complete-only source sync. No source-system writes.
-- Requires 005 and 007; DDL must be run as a separate migration owner.
-- Existing immutable evidence is preserved. A failed or incomplete run is
-- NEVER surfaced as a new published snapshot or comparison.
ALTER TABLE sales_source_snapshots
 DROP CONSTRAINT IF EXISTS sales_source_snapshots_record_count_check;
ALTER TABLE sales_source_snapshots ADD CONSTRAINT sales_source_snapshots_record_count_check
 CHECK (record_count BETWEEN 0 AND 1000000);
ALTER TABLE sales_source_snapshots ADD COLUMN IF NOT EXISTS mapping_version text;
ALTER TABLE sales_source_snapshots ADD COLUMN IF NOT EXISTS observed_from timestamptz;
ALTER TABLE sales_source_snapshots ADD COLUMN IF NOT EXISTS observed_until timestamptz;
ALTER TABLE sales_source_snapshots ADD COLUMN IF NOT EXISTS collection_quality text
 CHECK (collection_quality IN ('best_effort_full_scan','verified_consistent_snapshot'));
ALTER TABLE sales_source_records ADD COLUMN IF NOT EXISTS upstream_version text;
ALTER TABLE sales_source_records ADD COLUMN IF NOT EXISTS upstream_observed_at timestamptz;

CREATE TABLE IF NOT EXISTS sales_source_sync_runs (
 tenant_id text NOT NULL,
 run_id uuid NOT NULL DEFAULT gen_random_uuid(),
 run_key text NOT NULL CHECK(length(run_key) BETWEEN 1 AND 160),
 mapping_version text NOT NULL CHECK(length(mapping_version) BETWEEN 1 AND 100),
 status text NOT NULL DEFAULT 'queued'
   CHECK(status IN ('queued','collecting','failed','published')),
 lease_owner text,
 lease_until timestamptz,
 onec_count integer NOT NULL DEFAULT 0 CHECK(onec_count BETWEEN 0 AND 1000000),
 bitrix_count integer NOT NULL DEFAULT 0 CHECK(bitrix_count BETWEEN 0 AND 1000000),
 onec_complete boolean NOT NULL DEFAULT false,
 bitrix_complete boolean NOT NULL DEFAULT false,
 actor_ref text NOT NULL CHECK(length(actor_ref) BETWEEN 1 AND 255),
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 completed_at timestamptz,
 failure_code text,
 onec_snapshot_id uuid,
 bitrix_snapshot_id uuid,
 counts_json jsonb,
 PRIMARY KEY(tenant_id,run_id),
 UNIQUE(tenant_id,run_key),
 FOREIGN KEY(tenant_id,onec_snapshot_id) REFERENCES sales_source_snapshots(tenant_id,snapshot_id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,bitrix_snapshot_id) REFERENCES sales_source_snapshots(tenant_id,snapshot_id) ON DELETE RESTRICT,
 CHECK(status <> 'published' OR (onec_snapshot_id IS NOT NULL AND
    bitrix_snapshot_id IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS source_sync_recent
 ON sales_source_sync_runs(tenant_id,completed_at DESC,run_id DESC)
 WHERE status='published';

CREATE TABLE IF NOT EXISTS sales_source_sync_staging (
 tenant_id text NOT NULL, run_id uuid NOT NULL,
 source text NOT NULL CHECK(source IN ('1c','bitrix24')),
 source_record_id text NOT NULL CHECK(length(source_record_id) BETWEEN 1 AND 120),
 shared_key text CHECK(shared_key IS NULL OR length(shared_key) BETWEEN 1 AND 120),
 company text NOT NULL CHECK(length(company) BETWEEN 1 AND 200),
 counterparty_type text CHECK(counterparty_type IS NULL OR length(counterparty_type)<=60),
 contact_ref text CHECK(contact_ref IS NULL OR length(contact_ref)<=120),
 owner_ref text CHECK(owner_ref IS NULL OR length(owner_ref)<=120),
 original_status text CHECK(original_status IS NULL OR length(original_status)<=120),
 upstream_version text CHECK(upstream_version IS NULL OR length(upstream_version)<=160),
 observed_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,run_id,source,source_record_id),
 FOREIGN KEY(tenant_id,run_id) REFERENCES sales_source_sync_runs(tenant_id,run_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS source_sync_staging_keys
 ON sales_source_sync_staging(tenant_id,run_id,source,shared_key);

CREATE TABLE IF NOT EXISTS sales_source_sync_pages (
 tenant_id text NOT NULL,run_id uuid NOT NULL,
 source text NOT NULL CHECK(source IN ('1c','bitrix24')),
 page_index integer NOT NULL CHECK(page_index>=0 AND page_index<20000),
 content_sha256 char(64) NOT NULL CHECK(length(content_sha256)=64),
 record_count integer NOT NULL CHECK(record_count BETWEEN 0 AND 100),
 PRIMARY KEY(tenant_id,run_id,source,page_index),
 FOREIGN KEY(tenant_id,run_id) REFERENCES sales_source_sync_runs(tenant_id,run_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS sales_source_sync_findings (
 tenant_id text NOT NULL,run_id uuid NOT NULL,
 finding_id uuid NOT NULL DEFAULT gen_random_uuid(),
 code text NOT NULL CHECK(code IN ('unmapped_source_record',
 'ambiguous_shared_key','missing_in_1c','missing_in_bitrix24',
 'field_difference','field_not_comparable')),
 shared_key text,field text,
 source_record_1c text,source_record_bitrix24 text,
 value_1c text,value_bitrix24 text,
 PRIMARY KEY(tenant_id,run_id,finding_id),
 FOREIGN KEY(tenant_id,run_id) REFERENCES sales_source_sync_runs(tenant_id,run_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS source_sync_findings_order
 ON sales_source_sync_findings(tenant_id,run_id,code,shared_key,field,finding_id);

-- RLS is not optional: each tenant operation must SET LOCAL intake.tenant_id
-- inside the same transaction. Application/worker DB users MUST NOT be owner,
-- superuser or BYPASSRLS. These policies are defense in depth, not a grant.
DO $$
DECLARE table_name text;policy_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY[
  'sales_source_sync_runs','sales_source_sync_staging','sales_source_sync_pages','sales_source_sync_findings'
 ] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
  policy_name:=table_name||'_tenant';
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I',policy_name,table_name);
  EXECUTE format('CREATE POLICY %I ON %I FOR ALL
   USING (tenant_id=NULLIF(current_setting(''intake.tenant_id'',true),''''))
   WITH CHECK (tenant_id=NULLIF(current_setting(''intake.tenant_id'',true),''''))',
   policy_name,table_name);
 END LOOP;
END $$;

-- Published report/observations are immutable; staging is read/write only
-- until atomic publication, and then no additional pages may be accepted.
CREATE OR REPLACE FUNCTION source_sync_reject_published_mutation()
 RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (SELECT status FROM sales_source_sync_runs WHERE tenant_id=NEW.tenant_id
       AND run_id=NEW.run_id) <> 'collecting' THEN
  RAISE EXCEPTION 'cannot alter published or failed sync';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS source_sync_staging_open_only ON sales_source_sync_staging;
CREATE TRIGGER source_sync_staging_open_only BEFORE INSERT OR UPDATE ON sales_source_sync_staging
 FOR EACH ROW EXECUTE FUNCTION source_sync_reject_published_mutation();

DROP TRIGGER IF EXISTS source_sync_pages_open_only ON sales_source_sync_pages;
CREATE TRIGGER source_sync_pages_open_only BEFORE INSERT OR UPDATE ON sales_source_sync_pages
 FOR EACH ROW EXECUTE FUNCTION source_sync_reject_published_mutation();

-- Never grant application DELETE against any evidence/staging table. Retention
-- and DSR deletion (with audit) require separately approved governance.
