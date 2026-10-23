# RFC — one canonical Intake Integrity runtime (G0 proposal)
**Date:** 2026-10-23 · **Status:** PROPOSED, NOT APPROVED · **Related:** [#11](https://github.com/dokarpov/intake-integrity-lab/issues/11), [#12](https://github.com/dokarpov/intake-integrity-lab/issues/12), [#14](https://github.com/dokarpov/intake-integrity-lab/issues/14), [production delivery plan PR #24](https://github.com/dokarpov/intake-integrity-lab/pull/24).

**Proposed choice:** use the transactional integrity-v2 PostgreSQL entity graph as the *target storage spine*, after adapting the richer canonical sales envelope, legal/consent validation, team reviewer UX, delivery semantics, governance and immutable ledger integration from the legacy code. This is not a blanket migration or a claim that v2 is customer-complete. The old code remains a compatibility/reference implementation until a verified cutover. The read-only 1C↔Bitrix24 discrepancy slice and the transactional enquiry slice share identity/consent/provenance/tenant evidence contracts but have **different external release gates**.

## Why a single implementation is required
The current system has three different product/data realities:
1. **Legacy API**: `POST /api/intakes`, `/api/reviews/:id/resolve` and `/api/deliveries` call `processSalesIntakeAudited` with a universal sales envelope, compliance ledger, review queue and optional 1C outbox. **Defect:** resolving legacy review does not enqueue delivery; the review only saves an intake ID and minimal source context, not a recoverable canonical envelope. Intake/audit/outbox changes are not one PostgreSQL transaction. 
2. **Opt-in v2 API**: `/api/integrity/intakes`, `.../decisions` and `.../deliveries` use `PostgresSalesIntegrity`; one tenant-scoped transaction controls intake, matches, decision and outbox. **Defects:** creates `received` even when zero candidates (no safe automatic delivery); raw consent/evidence reference strings are NOT verified; no full canonical B2B parties/role/consent envelope; v2 CRM worker is a contract, not an installed production connector.
3. **Read-only source comparison**: `/api/integrity/sources/*` stores browser-submitted source snapshots and assessments; comparison uses explicit shared keys and limited field comparisons, **not** a verified 1C/Bitrix OAuth sync, a real source authority policy, or a production data import. The public site separately has a browser-only simulation.

**Other live ingress:** `functions/intake-staging.mjs` serves a Neon Function independently of `service/server.mjs`. Any shared-staging data gate must cover **both**, and a worker has its own process. This RFC's PR introduces fail-closed staging gate in both; it does not modify already deployed Neon/Railway environments.

## Ownership matrix (contract to implement in #12–#20)

| Responsibility | Current owner | Target decision / disposition |
| --- | --- | --- |
| Source authenticity and event identity | Legacy HTTP form + source names; v2 caller `sourceEventKey` | Signed webhook/OAuth or authorized read-only adapter, tenant/source-scoped idempotency key, replay protection; no browser self-attestation |
| Canonical business record | `src/sales-envelope.js` + `src/model.js` | Preserve B2B/B2C party roles, fields, consent/legal state and original source field authority; add immutable evidence references and version to v2 record |
| Source snapshots + provenance | `PostgresSourceComparison` / 005–007 | Keep read-only snapshots; add authenticated upstream origin, mapping version, staleness/watermark, source authority, delete and explicit unknown |
| Identity candidate lookup | Legacy local/external matcher; v2 HMAC person identifiers | Preserve multiple candidate possibilities and external matcher option; no shared-email auto-merge; identity not inferred solely from hash equality |
| Consent and purpose | Legacy validation/envelope + v2 consent string | Verify consent **or separately reviewed lawful permission** server-side and bind it to action/destination/purpose/time; no raw reference = proof |
| Intake + durable pending envelope | `sales_incoming_enquiries` (context only); legacy ephemeral object | Introduce versioned durable canonical envelope, tenant/idempotency constraints, source digest and explicit retention lifecycle |
| Decision | Legacy `sales_review_items`; v2 `sales_intake_decisions` | Single bounded review decision, authenticated role and reason, authoritative evidence, atomic state transition; never silently resolve other work |
| Safe automatic path | Legacy `deliverable` check; v2 has no auto-resolution | Only after independent authority/evidence/consent checks. Eligibility is not simply `candidateCount===0`; no automatic person merge |
| CRM delivery | `sales_delivery_outbox` vs `sales_crm_outbox_v2` | One durable tenant-scoped outbox, idempotent operation key and worker; provider receipt/lookup and loss-of-ACK quarantine; source writeback off by default |
| Audit/retention/DSR | Legacy `compliance_ledger_events`, DSR and policy stores; v2 separate chains | Business transition and outbox + minimal audit **same DB transaction**; cryptographic WORM ledger is a separately acknowledged anchored projection (do not assert atomic remote WORM) |
| Auth/workspaces | OIDC directory PRs 4/8/9; legacy staging token | Signed verified IdP issuer+subject, invite lifecycle, DB-based role assignment and revocation, MFA/session, restricted PostgreSQL identities |
| App experience | Legacy console, v2 test demos, static Site | One same-origin authenticated operator interaction with contextual review, not an additional salesperson inbox; distinct fictional public story |
| Storage/runtime/worker | `TenantRuntimeRegistry` legacy plus integrity-v2 classes plus Neon staging | Controlled adapter boundary; one canonical decision & state machine; no privileged customer database connection or unscoped worker |

## Proposed domain boundaries
**Observation** is not authorization. Use these independently typed objects (exact JSON schema and persistence migration still to be designed):
- **SourceFact**: `tenant/source/recordId/version/observedAt/collectedAt/field/value/authorityPolicyVersion/connectorGrantRef` with explicit freshness.
- **EnquiryEnvelope**: stable tenant/source/event key, validated party roles, purpose, consent/legal evidence and cryptographic payload digest; no browser-supplied tenant/actor authority.
- **IdentityCandidate**: multiple retained possibilities, reasons and verifier coverage; zero candidates ≠ permission to automatically create.
- **DecisionEvidence**: verifier-issued reference bound to tenant, intake, action, actor, policy version, digest, expiry/revocation and consent scope; not untrusted JSON booleans.
- **ReviewDecision**: `resolve/link/create/discard` constrained by evidence and actor; one irreversible write + explicit correction workflow.
- **DeliveryOperation**: stable tenant/intake/destination action key and lease, provider receipt or `needs_reconciliation`; never blind resend when outcome is uncertain.
- **AuditEvent**: canonical business event emitted in same PG transaction, async external integrity anchoring with separate SLO.

The optional [draft PR #1 evidence-policy evaluator](https://github.com/dokarpov/intake-integrity-lab/pull/1) remains a **read-only evaluator**. Its source authority/attestation checks are a candidate reusable module; personalized manufacturing examples are NOT an extra production-market commitment. Integrate after comparing with the current source-comparison policy; retain exact provenances and no fabricated business statuses.

## Migration / no-data-loss approach
1. **G0 freeze/inventory:** map all routes, schemas, tenant IDs, outbox workers and source grants. Verify shared staging has no live/customer records; quarantine suspect records through approved privacy process. Prohibit new real inputs. No production deployment.
2. **Record schema/contract:** design canonical envelope, explicit transitions, provenance and versioned authority/consent rules; record ADR and source-supported exceptions. Source-specific 1C configuration and Bitrix object list are not yet decided.
3. **Shadow synthetic compatibility:** use disposable restricted-role Postgres; run identical fictional events through legacy and target. Compare acceptance, review evidence and delivery intent. **No parallel actual CRM writes** or shadow use of real customer data.
4. **Close functionality gaps** in one vertical slice: canonical envelope persisted; source trust; clear-case permitted auto path; ambiguity; safe human decision; atomic audit/outbox; idempotency + provider reconciliation; all tenant-safe FK and RLS.
5. **Cross-repo UX:** authenticated same-origin operator UI consumes canonical API, with no browser-side elevated secrets. Public Site stays standalone fictional.
6. **Cutover with compatibility controls:** feature flag per dedicated synthetic tenant; no implicit migration of live data; existing legacy references mapped using versioned, reversible export/import, audit/consent reconciliation, rollback evidence, and human signoff.
7. **Remove/deprecate old writers** only after independent release review and verified backup. Do not mark #11 done merely because this RFC exists.

## Acceptance proof (all mandatory before G1 is approved)
- Clear *verified* enquiry with no conflicting identity: **automated eligible destination intent**, without unsafe identity creation or extra human clicks.
- Shared phone/email and two different parties: two candidates retained, no silent merge and no unwanted handoff.
- Missing/expired/withdrawn contact permission: no outbound delivery; reason and authority explicit.
- Approved reviewer resolution: exactly one durable decision/audit/outbox intent under concurrency; lost provider acknowledgment requires lookup/reconciliation.
- Duplicate source event with altered payload: conflict, not stale success. Retried identical event: stable state/operation key.
- Unverified source record, stale snapshot or incomplete 1C mapping: unknown finding, not asserted truth or fabricated CRM status.
- Multi-tenant A/B mixed SQL, sessions, workers, storage, migrations and object URLs: rejected in every layer, with real restricted PG roles.
- OIDC trusted identity and active membership required for customer runtime; revoked or suspended user denied.
- CI actual deployment-like browser journey (not only local dev headers), 320px through desktop, accessibility and source/failure/recovery cases.
- Read-only 1C↔Bitrix pilot and later write-enabled handoff require **separate** evidence and go/no-go; pilot data must not enter synthetic staging.

## Open product decisions (must not be invented during implementation)
Supported 1C product/version and infrastructure, Bitrix24 portal plan/objects, source of authority *per field*, exact legal permission by action, provider write and idempotency contract, real IdP/SSO, credential and key custody, hosting/data locality and disaster recovery, exception placement in customer's existing workflow, desired pilot slice and measured success threshold.

**Status:** This is a planning/traceability artefact attached to a testing PR. No merging, deployment, production customer records or authorization to write to external business systems. 
