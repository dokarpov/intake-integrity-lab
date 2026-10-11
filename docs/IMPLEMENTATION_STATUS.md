# Implementation status · v0.6

## Implemented and covered by local automated tests

- canonical sales envelope and optional dedup modes;
- async compliance ledger and integrity verification;
- OIDC/JWKS bearer verification + tenant/RBAC service boundary;
- required audit orchestration;
- team review queue, bulk assignment, leases and audited decisions;
- DSR lifecycle with pseudonymous subject reference;
- policy diff/approval/publish workflow;
- 1C mapping, idempotency, durable outbox and credential stripping;
- external server-side identity resolver adapter;
- WORM/KMS/HSM reference adapters and crypto/integrity controls;
- role-oriented operator console.

## Live test harness implemented, not executed in this packaging environment

- PostgreSQL live integration;
- AWS Object Lock + KMS live integration;
- 1C sandbox live write contract.

Those tests require real external infrastructure and intentionally skip without it.
