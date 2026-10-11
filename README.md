# Intake Integrity Lab v0.6.2

[![test](https://github.com/dokarpov/intake-integrity-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/dokarpov/intake-integrity-lab/actions/workflows/ci.yml)

**A production-oriented intake integrity and compliance control plane for sales systems, CRM and 1C.**

Most sales systems assume the first record is already correct. This project treats intake as a control boundary: identity can be ambiguous, people can have different roles, retries can create duplicates, browser-side decisions cannot be trusted, and a material action should leave evidence that can later be verified.

```text
sales / web / office / partner intake
                  ↓
        authenticated API boundary
                  ↓
 validation · consent · tenant / RBAC
                  ↓
 optional identity resolution
       off · local · external
          ↙             ↘
      continue       human review
          ↓             ↓
       canonical sales envelope
                  ↓
        durable delivery outbox ───► CRM / 1C
                  │
                  └──► compliance ledger
                        ↓
            signed / encrypted segments
                        ↓
                WORM-ready archive
```

## Why this exists

A duplicate is not only a CRM hygiene problem. A wrong identity or role can propagate into contracts, billing, ownership, access and reporting. The goal is therefore broader than deduplication: **make intake safe even when dedup is absent, external, incomplete or uncertain.**

The system can run with `dedupMode: "off"`. You still get validation, consent gates, role separation, idempotent delivery, review routing and auditable decisions. Semantic identity resolution is an optional capability rather than a prerequisite.

## What is implemented

### Intake and review

- Canonical B2B/B2C sales envelope with explicit parties and roles.
- Server-side identity resolver boundary; the browser cannot submit its own match decision.
- `off / local / external` identity-resolution modes.
- Human review queue with assignment, bulk assignment, claim leases, priority and SLA fields.
- Safe update policy for identity-critical fields and explicit resolution reasons.
- Delivery idempotency separated from semantic deduplication.

### Authenticated service

- Bearer OIDC/JWKS verification (`RS256` / `ES256`).
- Issuer, audience and expiry checks with JWKS cache/rotation.
- Server-derived tenant and multi-role RBAC.
- Route-level rate limits, request-size limits, no-store responses and security headers.
- Development auth only on loopback; production refuses to start with dev auth enabled.

### Compliance control plane

- Append-only hash-chained ledger with atomic PostgreSQL append path.
- Signed checkpoints and Merkle-rooted segments.
- AWS KMS and PKCS#11/HSM signing adapters.
- AES-256-GCM envelope encryption with KMS data-key provider.
- HMAC/KMS pseudonymous subject references.
- Retention classes, legal hold, two-person control and break-glass grants.
- DSR workflow with owner, due date, pseudonymous subject reference and audited lifecycle.
- Versioned policy changes with digest-bound approvals; high-risk changes require independent approval.
- Audit bundle export and recovery/integrity verification.

### 1C / CRM delivery

- Custom HTTP-service adapter and OData mapping boundary.
- Durable outbox with retry/backoff and terminal dead-letter state.
- Runtime credentials are injected only at send time and stripped before persistence.
- Audited delivery attempt/result without copying raw credential-bearing payloads into the ledger.

## Evidence today

| Evidence | Status |
|---|---|
| Local service / operator control plane | implemented |
| Unit/service tests | **76/76 passing** |
| PostgreSQL integration in GitHub CI | **passing against a real PostgreSQL service** |
| Human review / assignment / SLA workflow | implemented |
| Durable outbox + idempotency boundary | implemented |
| AWS Object Lock / KMS live suite | available, runs only with real sandbox resources |
| 1C live suite | available, runs only with a real sandbox endpoint |
| Production customer deployment | **not claimed** |
| Compliance certification | **not claimed** |

This distinction is intentional: the repository proves product architecture and executable control behavior; it does not turn synthetic fixtures or optional provider adapters into customer outcomes.

## Operator UX

The included console is organized around work rather than cryptography:

**Overview → Review queue → DSR → Audit ledger → Policy changes → Controls → Integrations**

Operators see assignment, SLA, conflicting signals, next actions and proof status first. Hashes, checkpoint details and raw technical metadata remain available as secondary evidence rather than dominating the interface.

## Run locally

Node 20+ is enough for the memory-backed development mode.

```bash
npm test
npm run service
```

Open `http://127.0.0.1:8787/console`.

For production, copy `config/service.example.json`, replace every `REPLACE_*` policy/legal placeholder with organization-approved values, and configure PostgreSQL + OIDC. AWS/HSM dependencies are optional adapters.

## Tests

```bash
npm test
# 76 local tests in v0.6.2

npm run test:integration
# live suites skip unless real sandbox resources are configured
```

The live integration suites are intentionally not mocks:

- **PostgreSQL** — concurrent append, append-only trigger and persisted team-review workflow;
- **AWS** — real Object Lock object, KMS sign/verify and data-key recovery;
- **1C** — real sandbox POST with synthetic data and idempotency key.

See `docs/LIVE_INTEGRATION_TESTS.md` before enabling external tests because they create real sandbox state.

## What this repository proves

It demonstrates a working architecture for safe intake, human fallback, transactional auditability, policy governance and delivery control. It also demonstrates where product logic ends and deployment/organizational controls begin.

It does **not** claim:

- GDPR certification;
- that this code alone creates regulatory compliance;
- production customer metrics;
- that WORM/KMS/HSM adapters are active without real provider resources;
- that a synthetic test result is a business outcome.

## Public / evidence boundary

This is a **clean-room generalized build**. It contains no source client specifications, internal task IDs, proprietary customer screens, production records, source legal text or client metrics. Synthetic examples are labelled as such.

## Related projects

- [`decision-systems`](https://github.com/dokarpov/decision-systems) — who should decide the next step?
- [`policy-kit`](https://github.com/dokarpov/policy-kit) — may an agent/tool action execute automatically, require a human, or be blocked?

---

Built by **Daria Karpova** · Product Systems & AI · 0→1 · [dokarpov](https://github.com/dokarpov)
