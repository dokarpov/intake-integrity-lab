# Intake Integrity — production delivery plan
**Baseline:** 22 October 2026 · **Status:** DRAFT / release NOT authorized · **Scope:** Intake SaaS, public Site and authenticated Lab.  
**Source of truth:** [independent audit #10](https://github.com/dokarpov/intake-integrity-lab/issues/10) + [original blockers #6](https://github.com/dokarpov/intake-integrity-lab/issues/6) + [approved cross-repo contract](CROSS_REPO_RELEASE_AUDIT_2026-10-18.md). Execution work is tracked in [#11–#23](https://github.com/dokarpov/intake-integrity-lab/issues); issues are titled by priority, and #23 is immediate containment.

## 0. Non-negotiable product contract
**Intake Integrity is not a CRM, social-listening tool, generic approval dashboard, or another compulsory daily inbox.** It guards an existing sales workflow:
`source enquiry → verify source/consent → link or flag identity candidates under an explicit evidence policy → automatically pass eligible clear case → human handles real uncertainty in the host flow → durable accountable decision → idempotent, reconcilable CRM/1C handoff → traceable status/recovery`.

- No automatic merge of customer identities; shared phone/email is not authoritative identity. No invented READY/HOLD, approval or owner-of-record.
- Default path requires **zero extra operator actions** where evidence legitimately permits automatic processing. Exception paths target **≤3 intentional actions**, not a mandatory second inbox.
- Human remains responsible for consequential uncertain decisions; the system shows exact source, policy, field values, versions, timestamps, consent and authority—not magic confidence.
- Site public walkthrough always fictional and anonymous; distinct same-origin secured application. Approved white responsive styling and clear mobile storytelling; no deceptive interactive mockups or unintended nested scrolling.
- First provider combination: **1C ↔ Bitrix24**, read-only discrepancies first. Write-enabled handoff **requires its own explicit permission, provider-supported contract and separate release decision**, not implicit in a CSV import.
- Do not accept identifiable customer data in shared-token synthetic staging or anonymous public site. No production deployment until all applicable gates below pass.

## Product slices (one architecture, two separate external promises)
1. **Read-only cross-source integrity:** authorized 1C and Bitrix24 sources → versioned snapshots → provenance/freshness/field authority → explainable mismatch → host-owned decision. This can be the first tightly scoped real-data pilot **only after G3 prerequisites**. No source modifications and no implication that intake/delivery automation is already live.
2. **Transactional incoming-enquiry guard:** authenticated source enquiry → safe identity/consent decision → automatic eligible handoff or minimal human exception → provider idempotency/reconciliation. This is the broader original product promise; **synthetic demonstration at G1 is not permission for real automated writes**. External write rollout requires G4.

The two slices share the canonical data, evidence, tenant-security and audit contracts but retain distinct provider capabilities, readiness evidence and customer-facing claims. Product leadership must explicitly choose which slice establishes the initial ICP/value before committing to external features.

## 1. Executable, dependency-ordered backlog
| Epic | Work | Depends on | Acceptance evidence |
| --- | --- | --- | --- |
| [#23](https://github.com/dokarpov/intake-integrity-lab/issues/23) | **Immediate containment**: synthetic-only staging and shared-token/data inventory, disable arbitrary personal-data uploads and rotate credentials | — | Synthetic demo survives; no unapproved customer-data ingress; token/access audit and safe remediation evidence |
| [#11](https://github.com/dokarpov/intake-integrity-lab/issues/11) | **Architecture reconciliation**: single canonical envelope, endpoints/tables/workers, migrations, staged PR #1 decision, old/new coexistence | — | One signed-off architecture decision; complete map of old/v2 routes; no lost review/delivery flow |
| [#12](https://github.com/dokarpov/intake-integrity-lab/issues/12) | **Flow integrity**: clear auto-delivery, durable pending envelope, bounded human exception, atomic audit/outbox/reconciliation | #11; #16, #15 contracts | Clear/ambiguous/denied/replay/crash/concurrency/provider-loss scenarios pass, no unsafe side effect |
| [#13](https://github.com/dokarpov/intake-integrity-lab/issues/13) | **Real identity lifecycle**: IdP, login, invites, joining, role changes, sessions, MFA, recovery, BFF | #11; #14 | Multi-user/provider live sandbox E2E; issuer+subject collision fixed; revoke immediate |
| [#14](https://github.com/dokarpov/intake-integrity-lab/issues/14) | **Tenant isolation**: all old/new tables, workers, logs/objects, strict DB roles, migration | #11, #13 design | No-context and A→B negative DB/API/worker/object tests under real restricted credentials |
| [#15](https://github.com/dokarpov/intake-integrity-lab/issues/15) | **1C & Bitrix24 source connectors**: least privilege, configuration matrix, incremental read, revoke, safe cursor/retry | #13, #14, #16 contract | Real authorized provider sandbox + version-specific read-only end-to-end provenance; no writeback |
| [#16](https://github.com/dokarpov/intake-integrity-lab/issues/16) | **Evidence and consent contract**: source authority, versioning, freshness, identity collisions, human decision | #11; source design | Exact-field explainability, negative trust tests and no automatic fabricated business decision |
| [#17](https://github.com/dokarpov/intake-integrity-lab/issues/17) | **Unified UX**: public story, signup, first source, first finding, inline exception, recovery | #11, #13, #15, #16 | Real mobile/desktop E2E, keyboard/a11y + task research; zero fake controls/inner scrolling |
| [#18](https://github.com/dokarpov/intake-integrity-lab/issues/18) | **EU privacy lifecycle**: DPA, data map, retention, erasure/export, evidence, legal hold, offboarding | #11, #14 | Legal/signoff and tested DSR, tenant deletion, backups/logs and policies before real data |
| [#19](https://github.com/dokarpov/intake-integrity-lab/issues/19) | **Release proof**: CI exact SHA, branch protections, staging parity, prod-like restricted roles, migration rollback, supply chain | Starts with #11; release gate all P0 | Independent security review, provider and negative E2E, rollback drill, explicit GO |
| [#20](https://github.com/dokarpov/intake-integrity-lab/issues/20) | **Operations & recoverability**: monitored sync/outbox, alerts, SLOs, rate limits, restore, incident handling | #12, #15, #14 | Failure injection and recovery game day, on-call runbook and verified isolation |
| [#21](https://github.com/dokarpov/intake-integrity-lab/issues/21) | **Permissioned measured pilot**: baseline, activation, trust, FP, reviewer load, adoption | G3 security, UX, read-only connectors | 3–5 suitable design partners and documented go/no-go evidence; no unsupported ROI claims |
| [#22](https://github.com/dokarpov/intake-integrity-lab/issues/22) | **Commercial readiness**: value units, trial, entitlement, pricing, billing, support, cancellation | #21 results | Validated unit economics and end-to-end support/billing/cancellation tests |

### Work packages must be genuinely shippable
Each PR/issue must specify: business scenario, untrusted inputs/threats, state transitions, idempotency guarantees, records written, provider privileges, success + failure UX, telemetry, database and browser negative tests, privacy/operational impact, rollback and *known unsupported scope*. No pass based only on mocked tests.

### Existing PR disposition
- App **#2 → #4 → #5 → #7 → #8 → #9**: stack is a **prototype foundation**, NOT independently shippable phases. Rebase/reconcile against #11 architecture decision; do not merge a partially secured branch into a production-deploying main.
- App **#1**: independent evidence-policy module remains unmerged and outside the stack. Evaluate controlled reuse, not silently discard nor expand product to unrelated orders/manufacturing.
- Site **#1** is testing UX; site **#2** strengthens browser-required publication but is NOT on main. Explicitly promote tested workflow before claiming it protects production.
- GitHub green means *this commit’s configured jobs passed*. It is not IdP/provider/customer data readiness.

## 2. Release gates and acceptable customer data

| Gate | Allowed activity | Must be demonstrably true | Not allowed |
| --- | --- | --- | --- |
| **G0 — Product contract** | Research, doc/architecture and synthetic testing | #23 staging containment + #11 architecture + acceptance scenario matrix + current-path inventory; issue and PR ownership | Source/real customer data, live release |
| **G1 — Synthetic vertical slice** | Real Postgres/HTTP/worker E2E with fictional providers | Clear + ambiguous + denied + replay + unknown-ack + recovery integrated; approved story UI; no internal leaks | Real customer imports, source writes |
| **G2 — Security-complete sandbox** | Signed external IdP sandbox and restricted DB tests | #13, #14; sessions/revocation, RLS **all** tenant surfaces, account lifecycle, quotas, crypto, negative E2E; #18 policies drafted | Shared-token customer onboarding; production |
| **G3 — Permissioned read-only pilot** | Small real provider/test customer dataset **only** in a separate secured tenancy after approval | G1+G2, #15 authorized real read-only 1C/Bitrix mappings, #16 verified evidence, DPA/retention and erasure, #17 operator UX, monitoring/support and explicit pilot signoff | Any source writeback/automatic merge, unapproved claims of value |
| **G4 — Controlled write-enabled pilot** | Limited approved handoff only to compatible supported providers | Verified receiver idempotency or authoritative reconciliation; ownership/consent; #12, #20 outage tests; permissions/revoke/switch and audit; explicit change authorization | Blind retries or inferred human decision |
| **G5 — Production general availability** | Public commercial offer with protected prod | #19 exact SHA and change control, security review, backup/restore, incident runbooks, monitoring, support and pricing/billing #22, real pilot value #21, rollback decision | Unreviewed auto-publish or unresolved P0/P1-critical issues |

**Critical distinction:** a read-only paid design-partner pilot and a write-enabled production rollout are separate go/no-go decisions.

## 3. Mandatory acceptance matrix (not limited to happy-path)
**Business:** brand-new customer; known safe returner; shared email/phone; changed owner; B2B buyer/billing contact/representative; manual host override; old consent; rejected consent; no identity proof; stale source, conflicting upstream truths, partial source history, duplicate source key with changed payload; out-of-order webhook; reimport/delete/recreate.

**Delivery & operations:** replay/concurrency; crash between decision/outbox/receipt; remote success but ACK lost; provider returns timeout/403/429/5xx; token revoked while sync is running; queue lease expiry; provider lookup says unknown; safe reconciliation; backups and key rotation; source becomes temporarily unavailable.

**Security/privacy:** anonymous/no token; invalid signature, expired token/session, old role, disabled membership, suspended workspace; invite theft/replay; two issuers same subject; tenant A→B read/write/export/worker/object URL; no tenant context; SQL injection and log error leaks; cookie/CSRF/XSS; retention/deletion and export; least-privileged support access.

**Interface:** anonymous demo with no API/network PII, onboarding cold start and reconnect, no source selected, duplicate organization, permissions missing, background sync progress, first meaningful finding, clear uncertainty/explanation, host action, confirmation and recovery, mobile viewports 320–1440, screen reader and reduced motion.

Every line of the matrix must link to a runnable test or an explicitly recorded external observation. Test failures and skipped provider environments are never reported as full release proof.

## 4. Engineering workflow / decision governance
1. Contain shared staging per #23, then start with a G0 single-architecture and acceptance decision. Use a pilot scenario trace (one source event and one explicit decision) as executable reference.
2. Short vertical slices: *schema + API + UI/host handoff + provider contract + observability + failure tests* together. No more database-only phases described as complete onboarding.
3. Each PR is a draft with dependencies, risk review, exact commit CI, adversarial cases, browser visual checks where UI changes, a rollback plan and feature flag; use synthetic data and a restricted role. Preserve design lock; get explicit approval for design changes.
4. Review compatibility across both repos and the deployment pipeline. Do not promote a site PR merely because its CI passed independently of the app.
5. Keep a decision log recording unknown business authority, supported 1C editions, consent/legal model, IdP/session host, payment provider, operational responsibility and explicit feature exclusions; no engineer may invent answers.
6. At every gate collect security, product and operational evidence and have an independent GO/NO-GO decision. **Never assume timing or user value from tests.**

## 5. Decisions to be made before claiming full specification
- **First pilot use case:** which 1C configuration/edition and Bitrix24 object types/portal licenses are supported? No universal adapter claim until compatibility matrix evidence.
- **Authority and risk:** which source wins *which specific field*, what qualifies as safe auto-delivery, which actions the host permits and what approval/consent is required?
- **Identity and tenancy:** which IdP/provider and issuer-qualified account model; which app domain/host; invitation and privileged role policy.
- **Data/legal:** where data may be stored, controller vs processor, subprocessor approval, retention and deletion policy, support role, DPA.
- **Operational model:** who owns alerts, source revocation, reconciliation decisions, incidents, restoration, customer support?
- **Economics/ICP:** record volume, deployment model (cloud/on-prem for 1C), value metrics and price thresholds; verify with pilot, not guessing.

### Release status
As of 2026-10-22, **G0 is not approved**; open draft PRs contain credible tested foundations but no complete customer SaaS. Previous green CI remains valid for the checked code, not a customer launch. No hosted staging or production data/schemas are modified by this planning document.
