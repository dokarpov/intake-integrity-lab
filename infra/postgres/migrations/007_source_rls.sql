-- 007: Opt-in PostgreSQL row-level isolation for source comparison evidence.
-- Apply ONLY after 005, using a separate migration role.
-- RLS applies to non-owner, non-BYPASSRLS application roles. Never run
-- SaaS requests as the table owner, superuser or a BYPASSRLS role.
-- Each application transaction MUST set LOCAL intake.tenant_id to the
-- already authenticated membership tenant before executing SQL.
-- Missing tenant context denies access. Do not apply to hosted staging
-- until its runtime/database roles and migrations have been verified.

ALTER TABLE sales_source_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS source_snapshot_tenant ON sales_source_snapshots;
CREATE POLICY source_snapshot_tenant ON sales_source_snapshots
 FOR ALL USING (tenant_id = NULLIF(current_setting('intake.tenant_id',true),''))
 WITH CHECK (tenant_id = NULLIF(current_setting('intake.tenant_id',true),''));

ALTER TABLE sales_source_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS source_record_tenant ON sales_source_records;
CREATE POLICY source_record_tenant ON sales_source_records
 FOR ALL USING (tenant_id = NULLIF(current_setting('intake.tenant_id',true),''))
 WITH CHECK (tenant_id = NULLIF(current_setting('intake.tenant_id',true),''));

ALTER TABLE sales_source_comparisons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS source_comparison_tenant ON sales_source_comparisons;
CREATE POLICY source_comparison_tenant ON sales_source_comparisons
 FOR ALL USING (tenant_id = NULLIF(current_setting('intake.tenant_id',true),''))
 WITH CHECK (tenant_id = NULLIF(current_setting('intake.tenant_id',true),''));

ALTER TABLE sales_source_assessments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS source_assessment_tenant ON sales_source_assessments;
CREATE POLICY source_assessment_tenant ON sales_source_assessments
 FOR ALL USING (tenant_id = NULLIF(current_setting('intake.tenant_id',true),''))
 WITH CHECK (tenant_id = NULLIF(current_setting('intake.tenant_id',true),''));

-- Provision an application role with USAGE on the schema and only the
-- required SELECT/INSERT rights. No UPDATE/DELETE, CREATE, ownership,
-- superuser or BYPASSRLS. Do not give runtime the migrator connection.
-- RLS for intake, CRM outbox and legacy tables is NOT addressed by 007.
