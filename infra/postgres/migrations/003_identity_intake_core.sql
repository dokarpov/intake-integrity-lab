-- 003: transactional identity graph and intake decision records.
-- Apply AFTER 001_ledger.sql and migrations/002_service_workflows.sql.
-- Identifier tokens are keyed HMAC-SHA256 digests produced server-side; never store
-- unkeyed hashes, plaintext emails, phones, raw approval tokens or CRM credentials.
-- No automatic merges, business-state changes or external network calls here.
BEGIN;

CREATE TABLE IF NOT EXISTS sales_persons (
  tenant_id text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 120),
  id text NOT NULL,
  external_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS sales_persons_external_ref_idx
  ON sales_persons(tenant_id, external_ref) WHERE external_ref IS NOT NULL;

-- Identifiers are deliberately NOT UNIQUE by (tenant,kind,token):
-- a phone/email may belong to multiple people and does not prove a merge.
CREATE TABLE IF NOT EXISTS sales_person_identifiers (
  tenant_id text NOT NULL,
  person_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('email','phone')),
  identifier_token text NOT NULL CHECK (identifier_token ~ '^[0-9a-f]{64}$'),
  verified_by_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, person_id, kind, identifier_token),
  FOREIGN KEY (tenant_id, person_id) REFERENCES sales_persons(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS sales_person_identifiers_match_idx
  ON sales_person_identifiers(tenant_id,kind,identifier_token,person_id);

-- Links never collapse two separate person rows.
CREATE TABLE IF NOT EXISTS sales_person_relationships (
  tenant_id text NOT NULL,
  id text NOT NULL,
  person_id text NOT NULL,
  related_person_id text NOT NULL,
  relation text NOT NULL CHECK (relation IN
    ('representative','payer','colleague','household','other')),
  asserted_by text NOT NULL CHECK (length(asserted_by)>0),
  evidence_ref text NOT NULL CHECK (length(evidence_ref)>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  CHECK (person_id <> related_person_id),
  FOREIGN KEY (tenant_id,person_id) REFERENCES sales_persons(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,related_person_id) REFERENCES sales_persons(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS sales_person_relationships_source_idx
  ON sales_person_relationships(tenant_id,person_id,relation);
CREATE INDEX IF NOT EXISTS sales_person_relationships_related_idx
  ON sales_person_relationships(tenant_id,related_person_id);

-- Keep opaque references to the encrypted source payload, not the source PII.
-- A source event key is HMAC'd and unique per tenant+source: replay is deterministic.
CREATE TABLE IF NOT EXISTS sales_intakes (
  tenant_id text NOT NULL,
  id text NOT NULL,
  source text NOT NULL CHECK (length(source) BETWEEN 1 AND 100),
  source_ref text NOT NULL CHECK (length(source_ref) BETWEEN 1 AND 250),
  idempotency_token text NOT NULL CHECK (idempotency_token ~ '^[0-9a-f]{64}$'),
  request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  payload_ref text NOT NULL CHECK (length(payload_ref)>0),
  consent_evidence_ref text,
  state text NOT NULL CHECK (state IN ('needs_review','resolved','discarded')),
  person_id text,
  review_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,source,idempotency_token),
  FOREIGN KEY (tenant_id,person_id) REFERENCES sales_persons(tenant_id,id) ON DELETE RESTRICT,
  CHECK ((state='needs_review' AND person_id IS NULL AND resolved_at IS NULL)
      OR (state='resolved' AND person_id IS NOT NULL AND resolved_at IS NOT NULL)
      OR (state='discarded' AND person_id IS NULL AND resolved_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS sales_intakes_pending_idx
  ON sales_intakes(tenant_id,created_at) WHERE state='needs_review';
-- Existing service review items have globally unique IDs; add tenant-scoped FK.
ALTER TABLE sales_review_items
  ADD CONSTRAINT sales_review_items_tenant_id_uniq UNIQUE (tenant_id,id);
ALTER TABLE sales_intakes
  ADD CONSTRAINT sales_intakes_review_fk
  FOREIGN KEY (tenant_id,review_id) REFERENCES sales_review_items(tenant_id,id)
  DEFERRABLE INITIALLY DEFERRED;

-- Candidate links are observational: never an auto-verified identity assignment.
CREATE TABLE IF NOT EXISTS sales_intake_candidates (
  tenant_id text NOT NULL,
  intake_id text NOT NULL,
  person_id text NOT NULL,
  evidence_kind text NOT NULL CHECK (evidence_kind IN ('identifier_overlap')),
  evidence_count integer NOT NULL CHECK (evidence_count > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,intake_id,person_id),
  FOREIGN KEY (tenant_id,intake_id) REFERENCES sales_intakes(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,person_id) REFERENCES sales_persons(tenant_id,id) ON DELETE RESTRICT
);

-- Immutable history is inserted in the SAME DB transaction as intake/review/outbox.
CREATE TABLE IF NOT EXISTS sales_intake_events (
  tenant_id text NOT NULL,
  id text NOT NULL,
  intake_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN
    ('intake_received','candidate_evaluated','review_requested','person_linked',
     'person_created','intake_discarded','crm_delivery_queued')),
  actor_ref text NOT NULL CHECK (length(actor_ref)>0),
  policy_version text NOT NULL CHECK (length(policy_version)>0),
  detail_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail_json)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,intake_id) REFERENCES sales_intakes(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS sales_intake_events_timeline_idx
  ON sales_intake_events(tenant_id,intake_id,created_at,id);

CREATE TABLE IF NOT EXISTS sales_intake_decisions (
  tenant_id text NOT NULL,
  id text NOT NULL,
  intake_id text NOT NULL,
  actor_ref text NOT NULL CHECK (length(actor_ref)>0),
  action text NOT NULL CHECK (action IN ('link_existing','create_person','discard')),
  selected_person_id text,
  evidence_ref text NOT NULL CHECK (length(evidence_ref)>0),
  reason text NOT NULL CHECK (length(reason) BETWEEN 10 AND 1000),
  policy_version text NOT NULL CHECK (length(policy_version)>0),
  decision_token text NOT NULL CHECK (decision_token ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,intake_id),
  UNIQUE (tenant_id,decision_token),
  FOREIGN KEY (tenant_id,intake_id) REFERENCES sales_intakes(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,selected_person_id) REFERENCES sales_persons(tenant_id,id) ON DELETE RESTRICT,
  CHECK ((action='discard' AND selected_person_id IS NULL)
     OR (action IN ('link_existing','create_person') AND selected_person_id IS NOT NULL))
);

CREATE OR REPLACE FUNCTION sales_reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'intake decision history is append-only';
END $$;
DROP TRIGGER IF EXISTS sales_intake_events_immutable ON sales_intake_events;
CREATE TRIGGER sales_intake_events_immutable BEFORE UPDATE OR DELETE
  ON sales_intake_events FOR EACH ROW EXECUTE FUNCTION sales_reject_history_mutation();
DROP TRIGGER IF EXISTS sales_intake_decisions_immutable ON sales_intake_decisions;
CREATE TRIGGER sales_intake_decisions_immutable BEFORE UPDATE OR DELETE
  ON sales_intake_decisions FOR EACH ROW EXECUTE FUNCTION sales_reject_history_mutation();

-- Operational privileges: revoke UPDATE/DELETE/TRUNCATE on events and decisions
-- from the application role; do not run as schema owner or PostgreSQL superuser.
-- The existing signed/WORM compliance ledger is an additional, separately
-- anchored audit boundary. This DB trigger is NOT independently immutable.
COMMIT;
