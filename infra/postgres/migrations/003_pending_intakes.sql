-- Acorde staging foundation: encrypted pending identity-review envelopes.
-- Not yet wired into production API. Do not treat this as a complete review-to-CRM workflow.
CREATE TABLE IF NOT EXISTS sales_pending_intakes (
  tenant_id text NOT NULL,
  intake_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','consumed')),
  payload_json jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  consumed_at timestamptz,
  PRIMARY KEY(tenant_id,intake_id),
  CONSTRAINT sealed_payload_status CHECK (
    (status='pending' AND payload_json IS NOT NULL AND consumed_at IS NULL)
    OR (status='consumed' AND payload_json IS NULL AND consumed_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS sales_pending_intakes_expiry_idx ON sales_pending_intakes(tenant_id,expires_at);
-- A production deployment must grant only scoped SELECT/INSERT/UPDATE/DELETE privileges
-- to its runtime role, and execute expiry cleanup under an explicitly authorized operator.
