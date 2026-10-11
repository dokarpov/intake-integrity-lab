# Changelog

## v0.6.1 — 2026-10-09

### Packaging / product
- Stronger top-of-README positioning for control-plane buyers (compliance, RevOps, platform)
- Explicit pairing with Decision Systems + Agentic Approval Lab
- CHANGELOG added; package.json version, author, keywords
- Status and public/evidence boundaries kept explicit

### Unchanged
- All service code, ledger, OIDC/RBAC, review/DSR/policy workflows, 1C outbox, live test harnesses
- Known gaps remain deployment/hardening work (see docs/KNOWN_GAPS.md)

## v0.6.0

- Bearer OIDC/JWKS API, multi-role RBAC, tenant isolation
- Async Postgres review queue, DSR workflow, policy-change dual approval
- Operator console work-centric UX
- 1C durable outbox with credential strip
- Live integration suites (Postgres, AWS Object Lock/KMS, 1C sandbox)

## v0.6.2 — 2026-10-09

### Product / system
- **Review routing policy** (`src/policy/review-routing.js`): classifies intake review items with Decision Systems semantics (decider, priority P0–P2, SLA hints, reason codes for identity / privacy / irreversible delivery)
- Unit tests for review routing
- Aligns control-plane review queue with the same “automate certainty / route ambiguity” product rule used in Decision + Approval labs
