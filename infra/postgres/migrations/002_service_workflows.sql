CREATE TABLE IF NOT EXISTS sales_review_items (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  intake_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('open','assigned','in_progress','resolved')),
  reason text NOT NULL,
  candidate_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  queue text NOT NULL DEFAULT 'identity',
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  sla_due_at timestamptz NOT NULL,
  assigned_to text,
  assigned_at timestamptz,
  claimed_by text,
  lease_until timestamptz,
  resolved_at timestamptz,
  resolution jsonb,
  version bigint NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS sales_review_active_idx ON sales_review_items(tenant_id,status,sla_due_at) WHERE status <> 'resolved';
CREATE INDEX IF NOT EXISTS sales_review_assignee_idx ON sales_review_items(tenant_id,assigned_to,status,sla_due_at);

CREATE TABLE IF NOT EXISTS dsr_cases (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  subject_ref text NOT NULL,
  request_type text NOT NULL,
  status text NOT NULL,
  requested_by text NOT NULL,
  owner text,
  requested_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  last_updated_at timestamptz NOT NULL,
  case_json jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS dsr_cases_due_idx ON dsr_cases(tenant_id,status,due_at);
CREATE INDEX IF NOT EXISTS dsr_cases_subject_idx ON dsr_cases(tenant_id,subject_ref);

CREATE TABLE IF NOT EXISTS compliance_policy_changes (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  policy_id text NOT NULL,
  from_version text,
  to_version text NOT NULL,
  payload_digest text NOT NULL,
  status text NOT NULL,
  requested_by text NOT NULL,
  created_at timestamptz NOT NULL,
  published_at timestamptz,
  change_json jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS policy_changes_status_idx ON compliance_policy_changes(tenant_id,status,created_at DESC);
