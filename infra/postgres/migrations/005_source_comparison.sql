-- 005: Read-only source snapshot comparison. No CRM or 1C modifications.
CREATE TABLE IF NOT EXISTS sales_source_snapshots (
 tenant_id text NOT NULL,
 snapshot_id uuid NOT NULL DEFAULT gen_random_uuid(),
 source text NOT NULL CHECK (source IN ('1c','bitrix24')),
 import_key text NOT NULL CHECK(length(import_key) BETWEEN 1 AND 160),
 content_sha256 char(64) NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
 policy_version text NOT NULL DEFAULT 'cross-source-v1',
 record_count integer NOT NULL CHECK(record_count BETWEEN 1 AND 100),
 actor_ref text NOT NULL CHECK(length(actor_ref)>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,snapshot_id),
 UNIQUE(tenant_id,source,import_key)
);
CREATE INDEX IF NOT EXISTS sales_source_snapshot_recent ON sales_source_snapshots(tenant_id,source,created_at DESC,snapshot_id DESC);
CREATE TABLE IF NOT EXISTS sales_source_records (
 tenant_id text NOT NULL,
 snapshot_id uuid NOT NULL,
 source_record_id text NOT NULL CHECK(length(source_record_id) BETWEEN 1 AND 120),
 shared_key text CHECK(shared_key IS NULL OR length(shared_key) BETWEEN 1 AND 120),
 company text NOT NULL CHECK(length(company) BETWEEN 1 AND 200),
 counterparty_type text CHECK(counterparty_type IS NULL OR length(counterparty_type) <= 60),
 contact_ref text CHECK(contact_ref IS NULL OR length(contact_ref) <= 120),
 owner_ref text CHECK(owner_ref IS NULL OR length(owner_ref) <= 120),
 original_status text CHECK(original_status IS NULL OR length(original_status) <= 120),
 PRIMARY KEY(tenant_id,snapshot_id,source_record_id),
 FOREIGN KEY(tenant_id,snapshot_id) REFERENCES sales_source_snapshots(tenant_id,snapshot_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS sales_source_records_shared_key ON sales_source_records(tenant_id,snapshot_id,shared_key);
CREATE TABLE IF NOT EXISTS sales_source_comparisons (
 tenant_id text NOT NULL,
 comparison_id uuid NOT NULL DEFAULT gen_random_uuid(),
 onec_snapshot_id uuid NOT NULL,
 bitrix_snapshot_id uuid NOT NULL,
 policy_version text NOT NULL,
 result_json jsonb NOT NULL CHECK(jsonb_typeof(result_json)='object'),
 actor_ref text NOT NULL CHECK(length(actor_ref)>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,comparison_id),
 UNIQUE(tenant_id,onec_snapshot_id,bitrix_snapshot_id,policy_version),
 FOREIGN KEY(tenant_id,onec_snapshot_id) REFERENCES sales_source_snapshots(tenant_id,snapshot_id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,bitrix_snapshot_id) REFERENCES sales_source_snapshots(tenant_id,snapshot_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS sales_source_assessments (
 tenant_id text NOT NULL,
 assessment_id uuid NOT NULL DEFAULT gen_random_uuid(),
 comparison_id uuid NOT NULL,
 assessment_key text NOT NULL CHECK(length(assessment_key) BETWEEN 1 AND 160),
 actor_ref text NOT NULL CHECK(length(actor_ref)>0),
 assessment text NOT NULL CHECK(assessment IN ('requires_verification','acceptable_difference','investigate_mapping')),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 10 AND 1000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,assessment_id),
 UNIQUE(tenant_id,comparison_id,assessment_key),
 FOREIGN KEY(tenant_id,comparison_id) REFERENCES sales_source_comparisons(tenant_id,comparison_id) ON DELETE RESTRICT
);
-- In the application, import snapshots, comparisons, and assessments are insert-only.
-- Deny DELETE/UPDATE on these tables for app role in production; service currently staging only.
CREATE OR REPLACE FUNCTION sales_snapshot_reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'source evidence is append-only'; END $$;
DROP TRIGGER IF EXISTS sales_source_snapshots_immutable ON sales_source_snapshots;
CREATE TRIGGER sales_source_snapshots_immutable BEFORE UPDATE OR DELETE ON sales_source_snapshots
 FOR EACH ROW EXECUTE FUNCTION sales_snapshot_reject_change();
DROP TRIGGER IF EXISTS sales_source_records_immutable ON sales_source_records;
CREATE TRIGGER sales_source_records_immutable BEFORE UPDATE OR DELETE ON sales_source_records
 FOR EACH ROW EXECUTE FUNCTION sales_snapshot_reject_change();
DROP TRIGGER IF EXISTS sales_source_comparisons_immutable ON sales_source_comparisons;
CREATE TRIGGER sales_source_comparisons_immutable BEFORE UPDATE OR DELETE ON sales_source_comparisons
 FOR EACH ROW EXECUTE FUNCTION sales_snapshot_reject_change();
DROP TRIGGER IF EXISTS sales_source_assessments_immutable ON sales_source_assessments;
CREATE TRIGGER sales_source_assessments_immutable BEFORE UPDATE OR DELETE ON sales_source_assessments
 FOR EACH ROW EXECUTE FUNCTION sales_snapshot_reject_change();
