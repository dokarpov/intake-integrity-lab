# v0.5 consolidation review

## Defects found in v0.4 and resolved here

| Area | v0.4 defect | v0.5 correction |
|---|---|---|
| audit write | sync and async ledger APIs coexisted in material orchestration | production orchestration is async and explicitly awaited |
| Postgres query | event JSON only, weak query ergonomics | indexed intake/subject/action projections + paged query API |
| SQL safety | configurable table name interpolated without validation | identifier validation |
| HSM | PKCS#11 sign existed without matching verify interface | sign + verify with DER/raw ECDSA conversion |
| legal hold | approval action was not bound to exact object/version | canonical payload digest binding |
| approvals | only in-memory reference | PostgreSQL durable approval store added |
| WORM retention | global hard-coded duration | explicit policy-derived retain-until / days required |
| WORM verification | retention checked, legal hold incompletely verified | retention, checksum and requested legal hold verified after write |
| archive recovery | KMS envelope lived only in application receipt | separate immutable recovery control object |
| KMS | no encryption context | context bound to ledger/segment/checkpoint |
| 1C delivery | UI implied retry policy without worker | durable outbox model with bounded exponential retry + dead state |
| UI | stale v0.2 form + raw JSON | role-oriented operator console |
| UI settings | dedup mode exposed as sales-form field | moved to admin integrations area |

## Still intentionally outside this repository

- a production identity provider / OIDC authentication server;
- organization-specific IAM policy deployment and approvals;
- actual 1C instance contract tests;
- paid cloud resources and physical HSM provisioning;
- SIEM backend / pager integration;
- formal regulatory certification.

Those are deployment integrations, not things a local demo should pretend to have.

### Delivery reliability

The repository now includes both an in-memory outbox (tests/examples) and a PostgreSQL outbox implementation using `FOR UPDATE SKIP LOCKED` for competing workers. Retry state is therefore durable and horizontally consumable rather than a UI-only promise.
