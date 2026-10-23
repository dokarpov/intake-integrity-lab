# Identity issuer migration — preproduction rollout runbook
**Scope:** PR #27, migration 010, verified workspace directory, bootstrap and production startup boundary. **Not approved for a live customer environment.**

## Why
OIDC `sub` is unique only within its signed `iss`. Prior workspace memberships were keyed by tenant + `sub`; the new key is `(tenant_id, issuer, subject_id)`. Migration 010 adds `issuer`, marks all issuer-unknown legacy memberships `urn:intake:legacy:unverified`, and rejects them at application authentication. It never binds email or client JWT tenant/role claims to customer account access.

## Read-only inventory before scheduling a change
1. Identify *the actual target cluster and migration owner*. Do not mistake the isolated Neon **synthetic-only** staging project for production. Verify DB, branch and role through out-of-band change controls.
2. Inventory `intake_workspaces`, `intake_workspace_memberships`, `intake_workspace_bootstraps`, any other references/foreign keys, duplicate subjects across issuers and business-impactful active accounts. Confirm whether migrations 006/009 exist before 010; they are absent from the legacy staging migration runner (001–005).
3. Record evidence that each existing membership issuer is **independently validated** by the IdP administrator. No automatic claim using matching email, identical `sub` or self-declared issuer. If issuer cannot be verified, the account remains unbound until a separate privileged re-provisioning action.
4. Separate service runtime `SELECT`-only role from provisioning/migrator roles; verify no table ownership, `BYPASSRLS`, superuser or membership DML grant for runtime. Verify the same origin/session/IdP signing configuration under preproduction.
5. Prepare a tested, time-bounded backup/restore and migration rollback/forward-repair protocol. The issuer migration is **access restrictive**, so recovery should reissue independent verified membership grants, not restore unsafe subject-only authorization.

## Preproduction exercise
1. Apply versioned migrations 006 → 009 → 010 using a separate migrator. Do not edit previously applied SQL/checksums. Do not use application, delivery worker or read-only API roles to execute DDL.
2. In a copy isolated from real users, verify legacy rows cannot authenticate and do not disappear; verify two issuers with the same subject can hold separately scoped grants.
3. Verify new OIDC-verified bootstrap stores the exact issuer and subject, subsequent registration is idempotent, disabled/suspended memberships remain denied, one user's JWT roles or forged workspace headers never elevate privilege, and stale sessions fail closed.
4. Run `assertProductionWorkspaceBoundary` using the **actual restricted app role**; it must fail for table owner/superuser, missing issuer/PK and roles with directory write grants.
5. Exercise existing real product user journey under nonprivileged credentials, including logout/revocation. The current demo's dev headers and staging shared token are **not** valid evidence.
6. Independent security review + signed GO/NO-GO before production DDL. Plan customer notification/maintenance if any existing membership will temporarily lose access.

## Rollout evidence
- Exact revision/SHA and checksummed migration; schema, roles, grants and dual-issuer tests.
- Pre-change active-membership count; after migration issuer-bound active vs unverified legacy counts.
- Validated IdP issuer, credential rotation, revocation and operator/admin separation.
- Owner of rollback/forward-repair and incident response; backup restore verified.
- Signed product, security/privacy, operations approvals and release gate.

## Critical non-claims
- This is **not** real IdP signup UI, invitations, account recovery, consent compliance or broad tenant isolation.
- The production startup preflight checks the workspace directory role and issuer schema. It does **not** certify other legacy/v2/source tables or CRM workers as tenant-isolated.
- No deployment or real-data processing is authorized by this runbook or CI alone.
