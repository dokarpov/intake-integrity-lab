# Intake Integrity — cross-repository release audit (2026-10-18)

## Approved product contract
An identity and enquiry-integrity checkpoint for sales workflows, not a CRM or social-listening product. Incoming enquiry → validate source and consent → identify safe matches → automatically deliver eligible clear records → route genuine uncertainty to a human → record decision and evidence → idempotent CRM/1C delivery with retry and recovery.

## Inspected source
- `intake-integrity-lab`: `README.md`, `package.json`, `service/server.mjs`, `src/service/app.js`, `src/service/runtime.js`, `docs/PRODUCT_VALIDATION.md`.
- `intake-integrity-site`: `index.html`, `preview/index.html`, `mvp/index.html`, `mvp/engine.mjs`, `mvp/engine.test.mjs`, deployment workflow.

## Findings and evidence levels
| Area | Observed in source | Not yet established |
|---|---|---|
| Backend API | POST /api/intakes, GET /api/reviews, claim/assign/resolve, GET /api/audit | End-to-end authenticated browser → deployed API → real CRM |
| Decisioning | Lab supports off/local/external identity modes; uncertain routes to review | Production thresholds and real-world false-match rate |
| Consent | Lab envelope and policy validation documented | Provider-specific consent mapping and user study |
| Delivery | Outbox and 1C HTTP service request, configured only with provider credentials | Live CRM delivery, idempotent receiver acknowledgement and replay under outage |
| Recovery | Retry/dead-letter code documented in README | Recovery exercised against real provider sandbox |
| Website | White approved fonts, standalone synthetic operator experience | Fully unified backend-connected build |
| Site MVP | Local browser-only engine, simulated matching, review and audit | Actual authenticated CRM writes or persisted user accounts |
| Visual | Approved white direction; neutral app boundary added | Screenshot verification at 320/375/390/768/1440 px |

## Important integration boundary
GitHub Pages is static. It cannot safely hold CRM secrets or impersonate authenticated tenants. Do not connect the static public preview directly to production writes. The authenticated Lab service must be deployed separately with HTTPS, OIDC, PostgreSQL, tenant-scoped permissions, source authentication, provider credentials and a configured outbox worker. The public site should demonstrate synthetic cases; an authenticated operator app should use same-origin Lab APIs. Lab currently serves `demo/index.html` at `/console`.

## Simulated scenarios (not interviews)
The Site repository contains `mvp/scenarios-12.test.mjs` with 12 executable Node test cases covering: returning customer, shared identity, unknown buyer, replay, key collision, hold, missing evidence, verified link, wrong target, verified creation, repeated resolution, and CSV round-trip. These cover engine safety only; they are not browser E2E tests, backend tests or evidence of usability.

## Comparison with existing sales workflow
Baseline: salesperson receives an enquiry in inbox/CRM → searches contacts and opportunities → checks owner and earlier commitments → decides whether to create, link or hand off → manually follows up.
Target: enquiry enters automatically → safe cases delivered without extra operator steps → only uncertainty appears with source, identity evidence, consent, owner and suggested action → one accountable resolution → delivery status and recovery visible.
**Not measured:** time-on-task, clicks, missed handoffs, false-positive match rate, adoption, operator error rate. Do not claim improvement until measured against a real CRM baseline.

## Prioritized release blockers
- **P0** Authenticated same-origin operator frontend wired to Lab endpoints, without weakening RBAC/consent.
- **P0** Concrete CRM adapter contract and provider sandbox: idempotency, retry, reconciliation and failure injection.
- **P0** Preserve source consent and identity evidence through review and delivery; verify with integration tests.
- **P0** E2E browser suite against the actual running Lab service for clear, uncertain, duplicate, consent-denied, retry and failure paths.
- **P1** Operator UI: owner/history/evidence summary, one-action resolution, delivery status and recovery without unnecessary workspaces.
- **P1** 12 scenario browser matrix at mobile widths; screenshot diffs and keyboard/a11y checks.
- **P1** Real sales participant testing against their existing process (do not relabel simulations as interviews).
- **P2** Real customer usage and economics before expansion to more connectors.

## Verification status
Source inspected. New site scenario tests and app-boundary CSS committed separately. **No local or CI test execution, deployed API connectivity, visual screenshot comparison, or live CRM transaction has been independently verified during this audit.** Therefore neither repository is certified release-ready by this report.

## Follow-up implementation pass
- Lab added authenticated GET /api/deliveries?intakeId=... (permission: integration.read), with tenant-scoped memory/PostgreSQL lookups returning status metadata but not request bodies or credentials.
- Lab added simulated unit coverage for tenant isolation, retry and eventual delivery success.
- Lab operator console visual CSS moved toward the approved white direction, without changing the underlying role permissions.
- Site deploy now gates publication on the original engine tests and twelve additional simulated scenarios; main page links to the MVP.
- **Critical unresolved P0:** The review-resolution API currently marks a review resolved and appends audit evidence but does **not** enqueue a downstream delivery. The audited review queue stores intakeId and source context, not a durable canonical envelope for subsequent delivery. A correct fix needs a durable pending-intake store, atomic resolution/outbox transaction, and crash/replay tests. Do not claim review → CRM works.
- **Critical unresolved P0:** No configured live CRM/1C provider, OIDC deployment or HTTPS operator host verified; GitHub Pages remains a simulation.
- **Verification:** CI execution results have not been retrieved; source edits and test code are not equivalent to passed tests or a completed E2E run.
