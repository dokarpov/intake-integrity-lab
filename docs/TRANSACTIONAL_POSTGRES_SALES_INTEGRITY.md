# Transactional PostgreSQL sales intake — testing architecture (003)

**Stage:** testing branch only; no deployment, schema change on production, or CRM credentials.
This is a backend transaction module, not a second daily inbox or an automatic merge engine.

## Data model / constraints

| Table | Purpose | Strong invariants |
| --- | --- | --- |
| sales_identity_people | Durable person identity | Composite tenant/person primary key |
| sales_person_identifiers | Email, phone or external evidence fingerprints | Tenant FK; nonunique shared fingerprints; one person's repeated evidence deduplicated |
| sales_incoming_enquiries | Idempotent intake and context | Unique tenant/source/event key; payload digest detects changed replay |
| sales_intake_candidates | Evidence-based possible matches | Tenant-scoped composite FKs; no automatic person merge |
| sales_intake_decisions | One human-owned irreversible resolution | Unique tenant/intake; actor, reason, evidence reference, policy version; append-only trigger |
| sales_person_relationships | Explicit person-to-person relations | Two independently existing people; actor and evidence; immutable; tenant-safe FKs |
| sales_intake_audit_events | Atomic business-event hash chain | Intake-locked sequence; append-only trigger; PII-minimal metadata |
| sales_crm_outbox_v2 | Durable controlled handoff | Unique tenant/intake/destination, unique operation key, isolated lease token |
| sales_crm_outbox_events | Claim, receipt and reconciliation audit | Append-only; ordered per locked outbox row |

Every new association uses composite tenant foreign keys. The same phone/email fingerprint may belong to **multiple people**; no uniqueness rule incorrectly merges people.

## Transaction boundaries

**Receive**: validate and normalize source fields -> HMAC identifier with tenant scope -> INSERT intake with unique event key -> source-key conflict compares canonical payload digest -> candidate lookup -> persist candidate list -> append audit entries -> COMMIT. Concurrent exact replay returns the original intake with no duplicate events. Conflicting replay fails.

**Human resolve**: SELECT incoming enquiry FOR UPDATE -> verify it has no previous decision -> check selected person is an actual stored candidate, or explicitly create a new person -> require evidence and applicable consent reference -> insert immutable decision -> update internal processing state -> append audit -> insert CRM outbox request + outbox event -> COMMIT. A failure rolls back **all** changes. No email-based auto-assignment.

**Relationship**: SELECT enquiry FOR UPDATE -> verify final decision involves one of the two people -> insert explicitly asserted relationship and event -> COMMIT. The linked people stay separate.

**CRM worker**: claim due outbox rows using FOR UPDATE SKIP LOCKED with a unique lease token; the database transaction commits **before** any external I/O. A sender must pass the stable \`operationKey\` to a provider that supports idempotency, or use provider lookup/reconciliation instead of blind retry. A confirmed provider receipt completes the outbox. An uncertain network result or expired lease goes to \`needs_reconciliation\` and cannot be reclaimed automatically. Only an independently verified lookup may record \`found\` or \`confirmed_absent\`. The latter allows a later retry under the same operation key.

**Important:** PostgreSQL cannot atomically commit a transaction with a remote CRM write. The outbox provides atomic *enqueue* and controlled *at-least-once* delivery; exactly-once effects require provider-side idempotency or reconciliation. Do not advertise distributed exactly-once delivery.

## Source and authorization boundaries

The reference class \`PostgresSalesIntegrity\` is deliberately **not** enabled in the existing service API or the production worker. Its \`actorId\`, \`consentEvidenceRef\`, \`identityEvidenceRef\` and \`sourceRef\` must come from independently authenticated adapters and access-control checks. A user-provided string alone cannot establish actual identity or lawful permission. Neither an identity evidence reference nor a consent reference is validated cryptographically by this class.

The HMAC secret MUST be deployment-specific and at least 32 random characters; hash rotation requires a fingerprint migration strategy. Context is stored in the DB as JSON and can contain personal data; do not use real customer payloads in testing. Deploy with encryption at rest, backups, row access permissions/tenant RLS or dedicated tenant roles, retention and erasure procedures. Never store an access token or CRM credential in the outbox. Role restrictions are documented at the migration; schema-owner/superuser roles must not be used by the app.

The transactional audit chain detects accidental or unprivileged tampering and is **not** an external WORM archive. Existing compliance-ledger sealing remains separate; do not claim these two ledgers are atomically the same transaction. For cross-system export use a separate idempotent projector.

## How to run

Apply \`infra/postgres/001_ledger.sql\`, \`infra/postgres/migrations/002_service_workflows.sql\`, and \`infra/postgres/migrations/003_sales_integrity.sql\` in order on a **disposable** PostgreSQL 16+ database using a migration role.

\`\`\`sh
TEST_DATABASE_URL='postgres://.../disposable_test_db' npm run test:integration:sales-integrity
\`\`\`

Integration tests exercise: tenant-bound FKs; shared identifiers; concurrent intake replay; payload conflict; rollback; competing human decisions; consent check; immutability; person relations; SKIP LOCKED workers; unknown acknowledgement; lease expiry; provider-confirmed absence; stable retry keys; and secret-bearing source-data rejection.

## Next gates before connecting real 1C/CRM

1. Build a source-authenticated API/1C adapter (no browser-selected business status, no additional salesperson inbox).
2. Verify actual permission to contact and identity evidence independently; do not trust arbitrary refs.
3. Integrate the existing provider-specific sender using its **real** idempotency/lookup semantics.
4. Add operational retention, encryption, scoped access policies and PII erasure procedures. Consider native Postgres row-level security where database roles can reliably enforce tenant context.
5. Run concurrency, fault injection, failover, duplicate transport and backup/restore tests using a real test provider.
6. Keep production off until the original Lab CI is green and the staging environment passes a complete intake -> decision -> CRM confirmation workflow.

No Shopify, production-file processor, social listening, or universal proofing interface is introduced here.
