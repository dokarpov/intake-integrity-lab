-- 008: Core sales integrity row-level security (staged migration only).
-- Migrate after 003 with a privileged migration role; no automatic deployment.
-- This is defense in depth in addition to authenticated API membership.
-- Runtime/worker SQL must derive a tenant from verified identity or server-owned
-- job metadata and set_config('intake.tenant_id', tenant, true) inside each
-- transaction. Do not use a privileged owner, superuser or BYPASSRLS role.
-- Missing context evaluates to NULL and denies SELECT/INSERT/UPDATE/DELETE.
-- Credential, session, role ownership and RLS checks remain release gates.
-- Legacy 001/002 stores, auxiliary sandbox CRM and blob storage are out of
-- scope: these must ALSO be isolated before accepting real customer data.
ALTER TABLE sales_identity_people ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_identity_people_tenant_scope ON sales_identity_people;
CREATE POLICY sales_identity_people_tenant_scope ON sales_identity_people
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('intake.tenant_id', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('intake.tenant_id', true), ''));

ALTER TABLE sales_person_identifiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_person_identifiers_tenant_scope ON sales_person_identifiers;
CREATE POLICY sales_person_identifiers_tenant_scope ON sales_person_identifiers
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('intake.tenant_id', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('intake.tenant_id', true), ''));

ALTER TABLE sales_incoming_enquiries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_incoming_enquiries_tenant_scope ON sales_incoming_enquiries;
CREATE POLICY sales_incoming_enquiries_tenant_scope ON sales_incoming_enquiries
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('intake.tenant_id', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('intake.tenant_id', true), ''));

ALTER TABLE sales_intake_candidates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_intake_candidates_tenant_scope ON sales_intake_candidates;
CREATE POLICY sales_intake_candidates_tenant_scope ON sales_intake_candidates
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('intake.tenant_id', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('intake.tenant_id', true), ''));

ALTER TABLE sales_person_relationships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_person_relationships_tenant_scope ON sales_person_relationships;
CREATE POLICY sales_person_relationships_tenant_scope ON sales_person_relationships
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('intake.tenant_id', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('intake.tenant_id', true), ''));

ALTER TABLE sales_intake_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_intake_decisions_tenant_scope ON sales_intake_decisions;
CREATE POLICY sales_intake_decisions_tenant_scope ON sales_intake_decisions
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('intake.tenant_id', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('intake.tenant_id', true), ''));

ALTER TABLE sales_intake_audit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_intake_audit_events_tenant_scope ON sales_intake_audit_events;
CREATE POLICY sales_intake_audit_events_tenant_scope ON sales_intake_audit_events
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('intake.tenant_id', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('intake.tenant_id', true), ''));

ALTER TABLE sales_crm_outbox_v2 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_crm_outbox_v2_tenant_scope ON sales_crm_outbox_v2;
CREATE POLICY sales_crm_outbox_v2_tenant_scope ON sales_crm_outbox_v2
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('intake.tenant_id', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('intake.tenant_id', true), ''));

ALTER TABLE sales_crm_outbox_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_crm_outbox_events_tenant_scope ON sales_crm_outbox_events;
CREATE POLICY sales_crm_outbox_events_tenant_scope ON sales_crm_outbox_events
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('intake.tenant_id', true), ''))
  WITH CHECK (tenant_id = NULLIF(current_setting('intake.tenant_id', true), ''));

-- Grant SELECT and specific INSERT/UPDATE only to separate runtime roles after
-- examining all application operations. No DELETE on append-only event tables.
-- The application connection MUST NOT own these tables or carry BYPASSRLS.
