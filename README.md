# Intake Integrity Lab

**A safer first record for sales systems.**

A working control plane for incoming enquiries, identity uncertainty, consent, human review, accountable decisions and reliable delivery to CRM / 1C.

[![CI](https://github.com/dokarpov/intake-integrity-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/dokarpov/intake-integrity-lab/actions/workflows/ci.yml) · [Product validation](docs/PRODUCT_VALIDATION.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md)

> **Engineering prototype · v0.6.2.** This repository demonstrates executable controls. It does **not** claim production customer deployments, commercial traction, regulatory certification or real-world performance metrics.

## Start with the product decision

[The real problem that led to this decision](https://www.linkedin.com/posts/dokarpov_who-else-has-got-a-new-phone-number-and-immediately-activity-7509342496011767810-qi04) · [Guided synthetic review scenario](https://dokarpov.github.io/intake-integrity-site/preview/) · [Public concept](https://dokarpov.github.io/intake-integrity-site/) · [Validation questions](docs/PRODUCT_VALIDATION.md)

**Problem:** a shared phone number or incomplete identifier can represent several customers. A confidently wrong match can contaminate CRM ownership, contracts or later records.

**Decision:** allow eligible clear records to proceed; hold ambiguous assignments for a reviewer with a reason and source context. Keep delivery idempotent and actions traceable separately from probabilistic identity matching.

**What the engineering tests establish:** executable validation, service controls, review state and safe delivery behavior under defined fixtures. **What they do not establish:** live CRM/1C connectivity for customers, operator time savings, customer adoption or legal certification.

## Why this exists

The first record often travels farther than anyone expects. A mistaken person, role or consent signal can affect CRM ownership, contracts, billing and access long after the form has been submitted.

Intake Integrity treats **the moment of acceptance** as a decision boundary rather than assuming every new record is true.

**The principle:** when a system cannot establish what is safe, it should preserve context, make uncertainty explicit, and route a decision to the right owner.

## The journey

```text
  Web / Sales / Partner / Office
                │
       Authenticated intake
                │
     Validation + consent gate
                │
    Identity resolution (optional)
           ┌────┴────┐
        confident  uncertain
           │         │
           │      Human review
           │         │
           └────┬────┘
       Canonical sales envelope
                │
        Durable delivery outbox ──────► CRM / 1C
                │
       Verifiable decision ledger
                │
       Signed / encrypted segments
                │
           Audit export
```

**Matching is optional. Safety is not.** Run with `dedupMode: "off"` and retain validation, role separation, consent checks, idempotency, review routing and evidence.

## What is implemented

| Layer | What it does |
| --- | --- |
| Intake | Canonical B2B/B2C envelope, explicit roles, server-side validation and consent checks |
| Identity | Optional `off / local / external` resolver; browser decisions are not trusted |
| Human review | Review queue with ownership, priority, assignments, claim leases and resolution reasons |
| Delivery | Durable outbox, retry/backoff, dead-letter handling and idempotency independent of semantic matching |
| Access | OIDC/JWKS verification, tenant isolation, multi-role RBAC and API safeguards |
| Governance | Policy versions, independent approvals for high-risk changes, DSR workflow and legal hold |
| Evidence | Append-only ledger, signed checkpoints, Merkle-rooted segments, encryption and export verification |
| Integrations | HTTP-service / OData boundaries for 1C and CRM delivery |

See [product-validation notes](docs/PRODUCT_VALIDATION.md) for the difference between an implemented control and deployment-dependent evidence.

## Demonstrated evidence

| Check | Reported status in v0.6.2 |
| --- | --- |
| Local unit/service tests | **76 / 76 passing** |
| PostgreSQL integration | Passing with real PostgreSQL in GitHub CI |
| Operator Chromium smoke | Passing at 320, 390, 768 and 1440px in CI |
| AWS Object Lock / KMS | Live integration suite; requires real sandbox resources |
| 1C delivery | Live integration suite; requires real sandbox endpoint |
| Production customer deployment | **Not claimed** |
| Compliance certification | **Not claimed** |

The synthetic UI examples and test fixtures are examples, not customer outcomes.

## Try it

Requirements: **Node.js 20+**.

```bash
git clone https://github.com/dokarpov/intake-integrity-lab.git
cd intake-integrity-lab
npm test
npm run service
```

Open **http://127.0.0.1:8787/console** for the local operator console.

The memory-backed development mode is for exploration. Production setup requires organization-approved policy values, PostgreSQL, OIDC credentials, provider configuration and operational controls. Begin with [the sample service configuration](config/service.example.json).

### Integration checks

```bash
npm run test:integration:postgres
npm run test:integration:aws
npm run test:integration:one-c
```

Live tests do real work in their configured sandboxes. Read [live integration tests](docs/LIVE_INTEGRATION_TESTS.md) before enabling them.

## What to evaluate

1. Can an ambiguous identity be reviewed without creating an incorrect downstream record?
2. Can a retry be accepted without delivering the same business action twice?
3. Can a human later explain who decided, under which policy, and with what evidence?
4. Can a team configure and operate the controls without needing to understand the cryptography?

These are design and implementation questions. Whether they solve a customer's operational pain at an acceptable cost still requires independent validation.

## Scope and limitations

- No source-client specifications, customer screenshots, production records or proprietary test inputs are included.
- The project is **not** a certified compliance product. Deployers remain responsible for their legal basis, retention policy, operations and access controls.
- KMS/HSM, immutable storage and 1C integrations depend on separately configured environments; including an adapter does not mean the service is connected.
- Performance, customer value and sales traction have not been validated by the repository alone.

## Project map

[Service](service/) · [Core sources](src/) · [Schemas](schemas/) · [Examples](examples/) · [Tests](tests/) · [Architecture and validation](docs/) · [Infrastructure](infra/) · [Security](SECURITY.md)

### Related work

[Decision Systems](https://github.com/dokarpov/decision-systems) — who decides next?  
[Policy Kit](https://github.com/dokarpov/policy-kit) — may an automated action execute, need approval, or be blocked?

---

**Built by Daria Karpova** · Product Systems & AI · clean-room generalized implementation.  
Open-source under the [MIT License](LICENSE).
