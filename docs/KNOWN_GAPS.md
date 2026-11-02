# Acorde — backend release blockers (2026-11-02)

**Production claim: BLOCKED.** Public sites are synthetic demos, and the connected Railway account has no deployed Acorde backend.

## P0 review-to-CRM handoff
The service queues ambiguous identities but does not durably preserve the canonical customer envelope for downstream writes. A review can be marked resolved without a CRM write, which is unacceptable.

This testing patch fails closed: linking and creating CRM records return HTTP 409 (review_delivery_unavailable), and the case remains open. Explicit rejection remains an audited no-delivery action.

Full closure requires: encrypted retention-bound pending envelopes and consent evidence; tenant-scoped, transactional review resolution + ledger event + outbox commit; connector-side idempotency/replay and reconciliation; concurrency, failure injection and cross-tenant tests.

## P0 actual testing environment
Deploy an isolated PostgreSQL and configured OIDC authenticated service in staging; do not expose dev-header login. Connect a dedicated CRM/1C sandbox with explicit idempotent writes. Run full browser → API → DB → worker → receiver → reconciliation E2E including ambiguous, clear, consent denied, replay and failure cases.

## P1 operations
Independent database-role privileges, database restore drills, key management/retention, dependency lock/SBOM/secret scans, signed releases, visual and accessibility checks.

Unit and live PostgreSQL tests in GitHub CI do not establish deployed functionality; AWS and 1C live test suites are opt-in.
