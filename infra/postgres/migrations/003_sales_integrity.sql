-- 003: tenant-scoped, transactional intake + identity evidence + CRM delivery.
-- Designed to COEXIST with legacy 001/002 tables. No destructive migrations.
-- PostgreSQL 16+. Apply using a privileged migrator, not an application worker.

CREATE TABLE IF NOT EXISTS sales_identity_people (
  tenant_id text NOT NULL CHECK (length(trim(tenant_id)) > 0),
  person_id uuid NOT NULL DEFAULT gen_random_uuid(),
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, person_id)
);

-- Deliberately NO UNIQUE constraint on fingerprint: families, reused addresses,
-- shared company inboxes and recycled numbers may identify multiple real people.
CREATE TABLE IF NOT EXISTS sales_person_identifiers (
  tenant_id text NOT NULL,
  identifier_id uuid NOT NULL DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('email','phone','external')),
  fingerprint char(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  source_ref text NOT NULL CHECK (length(trim(source_ref)) > 0),
  evidence_ref text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, identifier_id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES sales_identity_people(tenant_id,person_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, person_id, kind, fingerprint)
);
CREATE INDEX IF NOT EXISTS sales_person_identifier_lookup
  ON sales_person_identifiers(tenant_id, kind, fingerprint) INCLUDE (person_id);

CREATE TABLE IF NOT EXISTS sales_incoming_enquiries (
  tenant_id text NOT NULL,
  intake_id uuid NOT NULL DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (length(trim(source)) > 0),
  source_event_key text NOT NULL CHECK (length(trim(source_event_key)) BETWEEN 1 AND 200),
  payload_digest char(64) NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  contact_kind text NOT NULL CHECK (contact_kind IN ('email','phone','external')),
  contact_fingerprint char(64) NOT NULL CHECK (contact_fingerprint ~ '^[0-9a-f]{64}$'),
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 200),
  -- Minimal source context; avoid storing authentication tokens/secrets in JSON.
  context_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(context_json) = 'object'),
  consent_evidence_ref text,
  processing_state text NOT NULL DEFAULT 'received'
    CHECK (processing_state IN ('received','review_needed','resolved','discarded')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, intake_id),
  UNIQUE (tenant_id, source, source_event_key)
);
CREATE INDEX IF NOT EXISTS sales_incoming_enquiries_recent
  ON sales_incoming_enquiries(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sales_intake_candidates (
  tenant_id text NOT NULL,
  intake_id uuid NOT NULL,
  person_id uuid NOT NULL,
  match_reasons jsonb NOT NULL CHECK (jsonb_typeof(match_reasons) = 'array'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id,intake_id,person_id),
  FOREIGN KEY (tenant_id,intake_id) REFERENCES sales_incoming_enquiries(tenant_id,intake_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,person_id) REFERENCES sales_identity_people(tenant_id,person_id)
    ON DELETE RESTRICT
);

-- Relationships are explicit actor-confirmed assertions, NEVER inferred merges.
CREATE TABLE IF NOT EXISTS sales_person_relationships (
  tenant_id text NOT NULL,
  relation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  from_person_id uuid NOT NULL,
  to_person_id uuid NOT NULL,
  relation_type text NOT NULL CHECK (relation_type IN (
    'colleague','household','authorized_representative','same_organization','other'
  )),
  intake_id uuid NOT NULL,
  asserted_by text NOT NULL CHECK (length(trim(asserted_by)) > 0),
  evidence_ref text NOT NULL CHECK (length(trim(evidence_ref)) > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id,relation_id),
  UNIQUE (tenant_id, from_person_id, to_person_id, relation_type, intake_id),
  CHECK (from_person_id <> to_person_id),
  FOREIGN KEY (tenant_id,from_person_id) REFERENCES sales_identity_people(tenant_id,person_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,to_person_id) REFERENCES sales_identity_people(tenant_id,person_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,intake_id) REFERENCES sales_incoming_enquiries(tenant_id,intake_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS sales_person_relationships_from_idx
  ON sales_person_relationships(tenant_id,from_person_id,created_at DESC);
CREATE INDEX IF NOT EXISTS sales_person_relationships_to_idx
  ON sales_person_relationships(tenant_id,to_person_id,created_at DESC);

CREATE TABLE IF NOT EXISTS sales_intake_decisions (
  tenant_id text NOT NULL,
  decision_id uuid NOT NULL DEFAULT gen_random_uuid(),
  intake_id uuid NOT NULL,
  request_key text NOT NULL CHECK (length(trim(request_key)) > 0),
  request_digest char(64) NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  action text NOT NULL CHECK (action IN ('link_existing','create_new','discard')),
  person_id uuid,
  actor_id text NOT NULL CHECK (length(trim(actor_id)) > 0),
  reason text NOT NULL CHECK (length(trim(reason)) >= 8),
  identity_evidence_ref text NOT NULL CHECK (length(trim(identity_evidence_ref)) > 0),
  consent_evidence_ref text,
  policy_version text NOT NULL CHECK (length(trim(policy_version)) > 0),
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id,decision_id),
  UNIQUE (tenant_id,intake_id),
  UNIQUE (tenant_id,request_key),
  FOREIGN KEY (tenant_id,intake_id) REFERENCES sales_incoming_enquiries(tenant_id,intake_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,person_id) REFERENCES sales_identity_people(tenant_id,person_id)
    ON DELETE RESTRICT,
  CHECK ((action='discard' AND person_id IS NULL) OR
         (action IN ('link_existing','create_new') AND person_id IS NOT NULL))
);

-- Transactional audit for these workflows; metadata-only, not a copy of PII.
-- The separate compliance ledger/WORM exporter remains an additional control.
CREATE TABLE IF NOT EXISTS sales_intake_audit_events (
  tenant_id text NOT NULL,
  intake_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence >= 1),
  event_id uuid NOT NULL,
  previous_hash char(64),
  event_hash char(64) NOT NULL CHECK (event_hash ~ '^[0-9a-f]{64}$'),
  action text NOT NULL,
  actor_id text NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata_json)='object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,intake_id,sequence),
  UNIQUE (tenant_id,intake_id,event_id),
  FOREIGN KEY (tenant_id,intake_id) REFERENCES sales_incoming_enquiries(tenant_id,intake_id)
    ON DELETE RESTRICT,
  CHECK (previous_hash IS NULL OR previous_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS sales_crm_outbox_v2 (
  tenant_id text NOT NULL,
  outbox_id uuid NOT NULL DEFAULT gen_random_uuid(),
  intake_id uuid NOT NULL,
  destination text NOT NULL CHECK (length(trim(destination)) > 0),
  operation_key char(64) NOT NULL CHECK (operation_key ~ '^[0-9a-f]{64}$'),
  -- Credential-free request envelope; auth is injected only by worker.
  request_json jsonb NOT NULL CHECK (jsonb_typeof(request_json) = 'object'),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN
    ('pending','claimed','retry','needs_reconciliation','succeeded','dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_token uuid,
  leased_at timestamptz,
  lease_until timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  external_record_ref text,
  receipt_ref text,
  last_reason text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id,outbox_id),
  UNIQUE (tenant_id,intake_id,destination),
  UNIQUE (tenant_id,destination,operation_key),
  FOREIGN KEY (tenant_id,intake_id) REFERENCES sales_incoming_enquiries(tenant_id,intake_id)
    ON DELETE RESTRICT,
  CHECK ((state='claimed') = (lease_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS sales_crm_outbox_v2_due ON sales_crm_outbox_v2
  (next_attempt_at, created_at) WHERE state IN ('pending','retry');
CREATE INDEX IF NOT EXISTS sales_crm_outbox_v2_lease ON sales_crm_outbox_v2(lease_until)
  WHERE state = 'claimed';

CREATE TABLE IF NOT EXISTS sales_crm_outbox_events (
  tenant_id text NOT NULL,
  outbox_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  action text NOT NULL,
  actor_id text NOT NULL,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details_json)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id,outbox_id,sequence),
  FOREIGN KEY (tenant_id,outbox_id) REFERENCES sales_crm_outbox_v2(tenant_id,outbox_id)
    ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION reject_sales_integrity_history_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'sales integrity history is append-only';
END $$;
DROP TRIGGER IF EXISTS sales_integrity_no_modify_decision ON sales_intake_decisions;
CREATE TRIGGER sales_integrity_no_modify_decision BEFORE UPDATE OR DELETE ON sales_intake_decisions
  FOR EACH ROW EXECUTE FUNCTION reject_sales_integrity_history_mutation();
DROP TRIGGER IF EXISTS sales_integrity_no_modify_intake_event ON sales_intake_audit_events;
CREATE TRIGGER sales_integrity_no_modify_intake_event BEFORE UPDATE OR DELETE ON sales_intake_audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_sales_integrity_history_mutation();
DROP TRIGGER IF EXISTS sales_integrity_no_modify_outbox_event ON sales_crm_outbox_events;
CREATE TRIGGER sales_integrity_no_modify_outbox_event BEFORE UPDATE OR DELETE ON sales_crm_outbox_events
  FOR EACH ROW EXECUTE FUNCTION reject_sales_integrity_history_mutation();
DROP TRIGGER IF EXISTS sales_integrity_no_modify_relation ON sales_person_relationships;
CREATE TRIGGER sales_integrity_no_modify_relation BEFORE UPDATE OR DELETE ON sales_person_relationships
  FOR EACH ROW EXECUTE FUNCTION reject_sales_integrity_history_mutation();

-- Deployment boundary:
-- REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
-- Run app under a narrowly scoped role with SELECT/INSERT and only approved
-- UPDATE on mutable workflow tables; NEVER use schema-owner/superuser in runtime.
-- DB triggers protect accidental mutation, not against a privileged schema owner.
-- Provision encrypted disk/backups, access logs, retention/DSR processing and
-- provider-authenticated source adapters before accepting real personal data.
