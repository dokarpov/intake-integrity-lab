-- 009: Workspace bootstrap for an independently verified OIDC identity.
-- Migration role only. Do not accept display names, tenant IDs or subject IDs
-- from a browser as trusted authentication or organization authorization.
ALTER TABLE intake_workspace_memberships
 DROP CONSTRAINT IF EXISTS intake_workspace_memberships_roles_check;
ALTER TABLE intake_workspace_memberships
 ADD CONSTRAINT intake_workspace_memberships_roles_check
 CHECK (
  cardinality(roles) BETWEEN 1 AND 8 AND
  roles <@ ARRAY['owner','admin','sales','reviewer','review_manager','auditor',
                 'dpo','security_admin','policy_admin','integration_admin']::text[]
 );

-- A verified issuer/subject can bootstrap a single initial organization.
-- Store a one-way subject reference; no email or upstream credentials here.
CREATE TABLE IF NOT EXISTS intake_workspace_bootstraps (
 subject_hash char(64) PRIMARY KEY CHECK(subject_hash ~ '^[0-9a-f]{64}$'),
 tenant_id text NOT NULL UNIQUE REFERENCES intake_workspaces(tenant_id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Runtime role: grant only INSERT/SELECT for bootstrap and workspace tables
-- to the isolated onboarding service. Other membership modifications require
-- an auditable privileged organization-management API (not included here).
-- Sign-in, verified email and future provider tenant claims are externally
-- provisioned; this migration does not imply an existing auth provider.
