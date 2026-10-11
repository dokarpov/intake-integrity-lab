CREATE TABLE IF NOT EXISTS compliance_ledger_events (
  ledger_id text NOT NULL,
  tenant_id text NOT NULL,
  sequence bigint NOT NULL,
  event_id text NOT NULL,
  event_hash text NOT NULL,
  intake_id text,
  subject_ref text,
  event_action text NOT NULL,
  event_result text NOT NULL,
  event_json jsonb NOT NULL,
  inserted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ledger_id, sequence),
  UNIQUE (ledger_id, event_id),
  UNIQUE (ledger_id, event_hash)
);

CREATE INDEX IF NOT EXISTS compliance_ledger_intake_idx ON compliance_ledger_events(ledger_id, intake_id, sequence) WHERE intake_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS compliance_ledger_subject_idx ON compliance_ledger_events(ledger_id, subject_ref, sequence) WHERE subject_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS compliance_ledger_action_idx ON compliance_ledger_events(ledger_id, event_action, sequence);

CREATE OR REPLACE FUNCTION reject_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'compliance ledger rows are append-only';
END $$;

DROP TRIGGER IF EXISTS compliance_ledger_no_update ON compliance_ledger_events;
CREATE TRIGGER compliance_ledger_no_update BEFORE UPDATE OR DELETE ON compliance_ledger_events
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

-- Production role boundary (run as schema owner, replacing role names to match deployment):
-- REVOKE ALL ON compliance_ledger_events FROM PUBLIC;
-- REVOKE UPDATE, DELETE, TRUNCATE ON compliance_ledger_events FROM ledger_writer;
-- GRANT SELECT, INSERT ON compliance_ledger_events TO ledger_writer;
-- GRANT SELECT ON compliance_ledger_events TO ledger_reader;
-- Do not give schema-owner or superuser credentials to the application runtime.
-- The DB is the live transactional ledger; WORM anchoring provides the stronger independent immutability boundary.

CREATE TABLE IF NOT EXISTS compliance_control_approvals (
  id text PRIMARY KEY,
  action text NOT NULL,
  requested_by text NOT NULL,
  reason text NOT NULL,
  payload_digest text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','approved','consumed','expired','cancelled')),
  approved_by text,
  approved_at timestamptz,
  consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS compliance_control_approvals_status_idx ON compliance_control_approvals(status, expires_at);

CREATE TABLE IF NOT EXISTS sales_delivery_outbox (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  intake_id text NOT NULL,
  destination text NOT NULL,
  request_json jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','in_flight','retry','succeeded','dead')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  dead_at timestamptz,
  last_error text,
  status_code integer,
  external_record_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, intake_id, destination)
);
CREATE INDEX IF NOT EXISTS sales_delivery_outbox_due_idx ON sales_delivery_outbox(status,next_attempt_at) WHERE status IN ('pending','retry');
