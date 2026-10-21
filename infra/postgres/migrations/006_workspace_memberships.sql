-- 006: OIDC-subject-to-workspace authorization registry.
-- Apply with a migration role, never using the application runtime identity.
-- Membership changes are administrative and deliberately NOT exposed via API.
CREATE TABLE IF NOT EXISTS intake_workspaces (
 tenant_id text PRIMARY KEY CHECK (length(trim(tenant_id)) BETWEEN 1 AND 160),
 display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 200),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS intake_workspace_memberships (
 tenant_id text NOT NULL REFERENCES intake_workspaces(tenant_id) ON DELETE RESTRICT,
 subject_id text NOT NULL CHECK (length(trim(subject_id)) BETWEEN 1 AND 255),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
 roles text[] NOT NULL CHECK (
   cardinality(roles) BETWEEN 1 AND 8 AND
   roles <@ ARRAY['sales','reviewer','review_manager','auditor','dpo',
                  'security_admin','policy_admin','integration_admin']::text[]
 ),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (tenant_id,subject_id)
);
CREATE INDEX IF NOT EXISTS intake_workspace_memberships_subject_idx
 ON intake_workspace_memberships(subject_id,tenant_id);

-- Deployment requirement: runtime DB role must have SELECT only on these two
-- tables. Grant membership writes only to a separate audited provisioning role.
-- Authentication is not an account registration, invitation, recovery or MFA
-- implementation. Customer data must remain blocked until full tenancy/RLS,
-- provider verification, incident, retention and deletion gates are complete.
