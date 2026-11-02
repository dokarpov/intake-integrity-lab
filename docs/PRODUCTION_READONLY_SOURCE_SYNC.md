# P0 production read-only source sync: release contract and operator runbook

**Status: testing implementation, NOT customer-ready or deployed.**
**GitHub:** [PR #30](https://github.com/dokarpov/intake-integrity-lab/pull/30)
**Backlog:** [#15](https://github.com/dokarpov/intake-integrity-lab/issues/15), #14, #16, #17, #19; broader #11 and #12 remain in scope.

## Intended customer outcome

A permitted user signs into their existing verified workspace, connects **authorized** 1C and Bitrix24 sources through a server-side connector setup, requests an evidence scan, watches bounded progress, and sees a complete-pair read-only discrepancy report in the authenticated product. Source records, versions and statuses are never rewritten. Ambiguous identities and missing keys are observations, **not** automatable merge or status decisions. Eventually the same evidence layer supports incoming-enquiry review and approved CRM handoff as a distinct release gate.

## Implemented data flow

```
Verified OIDC member [owner/admin/integration_admin]
  -> POST /api/integrity/sources/sync (202: queued run)
  -> tenant RLS queue (independent API-only DB role)
  -> tenant-pinned one-shot worker (independent worker DB role)
  -> AWS Secrets Manager approved, revocable, expiring tenant grant
  -> HTTPS allowlisted 1C standard OData 3 catalog GET
  -> HTTPS allowlisted Bitrix24 crm.company.list POST (read-only REST method)
  -> bounded pages + source identity + mapping version + page proof
  -> PostgreSQL tenant-RLS staging
  -> complete both sources, or retain prior published report unchanged
  -> one atomic database transaction: two immutable snapshots,
     source records, full SQL findings, published report + counts
  -> GET /api/integrity/sources/report/latest
  -> GET /api/integrity/sources/report/findings?runId=...&limit=50&offset=...
```

A previous complete report remains visible if a future job fails, times out, loses permission, detects duplicates, cannot verify page completion, or is interrupted. A job aborted after a lease expires is marked failed on the next claim, not blindly resumed; a new explicitly authorized run can be queued. Failed staging data remains subject to an independent privacy retention/DSR policy rather than unsafely auto-deleted.

### Contract and limitations of the first provider adapters

| Source | Read contract | Mapping/compatibility | Known limitations |
| --- | --- | --- | --- |
| **Bitrix24 Cloud CRM** | OAuth bearer from server secret; only `crm.company.list`, server-side field selection, 50-record pages via `start/next`; 401/403, 429/503 handled | Exact unique company `ID`, `TITLE`; shared join key requires explicit approved `UF_CRM_*` or other field; recorded native field/version where available | OAuth *installation, token refresh, webhook replay/delta* and plan-specific sandbox verification still missing; mapping every CRM entity not supported |
| **1C Enterprise 8.3 OData v3** | HTTPS-only standard `/odata/standard.odata/Catalog_*`; Basic credentials resolved in vault, GET only; `$top/$skip/$orderby/$select` | Customer must prove the actual 1C edition, published catalog entity and fields; `Ref_Key`, `Description` and external key are examples, not universal values | OData publication, supported configuration/role/version, on-prem egress gateway and signed provider contract tests still missing; no general 1C API promise |

Provider documentation: [Bitrix list method](https://apidocs.bitrix24.com/api-reference/crm/companies/crm-company-list.html), [Bitrix paging](https://apidocs.bitrix24.com/settings/how-to-call-rest-api/list-methods-pecularities.html), [1C Fresh standard OData](https://www.1cfresh.com/articles/data_odata).

**Explicit authority mapping is mandatory.** Never assume a 1C business entity type is equivalent to a Bitrix `COMPANY_TYPE`; optional fields default to unknown when they lack an approved common reference. A shared phone/email or similar company name must never manufacture a join key. Every received record must have a stable provider ID and readable name; missing required records fail the run rather than silently disappearing.

### Evidence integrity and scale

- Original preexisting v1 demo was limited to 100 records. Migration 011 permits 0–1,000,000 source records **per provider** for the new pipeline. Beyond the limit, fail explicitly; never truncate or mark successful.
- Every staged page has a content digest and sequential page index; provider duplicate record IDs fail by unique constraint, then the full run fails. The source-pair transaction commits two immutable snapshots and their findings or commits none.
- The new SQL comparison avoids loading 1,000,000 records into one JavaScript array; findings are persisted and fetched in pages of up to 50. This is a **code limit**, not verified throughput. Load, backup, retention and large dataset performance tests are still required before commercial capacity claims.
- Evidence contains only observations: `field_difference`, `field_not_comparable`, `missing_in_1c`, `missing_in_bitrix24`, `unmapped_source_record`, and `ambiguous_shared_key`.
- Publication currently labels each provider scan `best_effort_full_scan`. It is **not** a cross-provider transactional instant; records can change during export. Until verified consistent snapshots, semantic version reconciliation, full source deletion history and incremental watermarks exist, findings cannot be presented as up-to-the-millisecond truth.

### Security and operational setup required

1. Apply migrations 005, 007, 011, and issuer-bound workspace/auth migrations 006, 009, 010 with **a distinct migrator**, after backup/rollback and a checksum-based migration plan. The current `scripts/migrate-staging.mjs` only manages 001–005; do **not** apply production SQL through that staging runner.
2. Create a **non-owner, non-superuser, non-BYPASSRLS** API role with `SELECT, INSERT` on `sales_source_sync_runs`, `SELECT` on `sales_source_sync_findings`, no other source-table privileges and no DML on snapshots/staging. Set `SOURCE_SYNC_API_DATABASE_URL` (not equal to `DATABASE_URL`).
3. Create a distinct restricted worker role: `SELECT` on runs/staging/pages/findings/snapshots/records; `UPDATE` only on runs; `INSERT` only on staging/pages/findings/snapshots/records; no `DELETE`; set `SOURCE_SYNC_WORKER_DATABASE_URL`. Both roles must pass `assertSourceSyncDbRole` and verified tenant `SET LOCAL intake.tenant_id` checks on every transaction.
4. Configure AWS Secrets Manager IAM to read **only** the intended tenant secret `intake-integrity/source-sync/<tenant UUID>/read-only-pair`; encrypted at rest with managed KMS; no secret values in SQL, GitHub, app logs or browser. Secret payload must match the tenant, grant ID, purpose, expiry, approved mapping versions and both source origins/allowHosts. Audit secrets access and rotation.
5. Deny outbound egress except approved remote hosts and DNS/IP ranges at the **network layer**; hostname checking in Node does not fully prevent DNS rebinding. Require customer-approved HTTPS egress to their private 1C network via a managed gateway; **never** expose on-prem credentials via browser upload or arbitrary tunnel URL.
6. Configure a verified production IdP and real user membership. `SOURCE_SYNC_ENABLED=true` is intentionally rejected in staging/dev and if directory membership, vault or isolated API DB role are missing.
7. Pin `SOURCE_SYNC_TENANT_ID` per worker workload using infrastructure-owned configuration; scheduler or host control plane invokes `npm run worker:source-sync` on a safe cadence. No browser-selected worker tenant. Implement monitoring/alerts, backoff, quota, job lifecycle and data retention prior to multi-tenant scale.
8. Confirm tenant-specific GDPR lawful basis, DPA, external provider consent, exact data fields, cross-system comparison purpose, residency, data retention, DSR, security audit and provider grant revocation. No production/customer data may be uploaded or synced without approval.

### Acceptance and failure matrix

- Confirmed by disposable CI: validated provider routes and non-write methods, 51+ Bitrix rows, provider HTTP failures/rate limits, 1C OData mapping, no arbitrary host or URLs, vault grant failure, stale pages, atomic pair publication exceeding 100 rows, empty sources, duplicate provider IDs, concurrent enqueue, wrong worker lease, cross-tenant RLS and missing tenant context, API permission/redaction controls, latest report and paged SQL findings, and exact SHA browser/API/DB checks.
- To verify before real deployment: actual 1C customer configuration and role matrix, Bitrix portal OAuth authorization/refresh, HTTPS/DNS egress tests, independent provider sandbox replay/429/deletion cases, two-real-user login/revoke, real concurrent worker crash/restore, DSR deletion procedure, large load/latency tests, backup restore, an operator-readable authenticated UI including empty/loading/retry/expired state, incident runbooks, privacy/security approval and a signed release/rollback decision.

**Never claim:** source connectors have been installed at a customer, onboarding works end to end, provider data is authoritative, the first read-only pilot is complete, or production is deployed. All source writes and identity merges remain out of this read-only gate; the full transactional enquiry+recovery product remains required under #12.
