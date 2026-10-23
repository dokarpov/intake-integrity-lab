-- 010: Bind workspace permissions to the verified OIDC (issuer, subject) pair.
--
-- Previously memberships were keyed by subject alone. OpenID Connect only
-- promises the subject is stable/unique *within* a specific issuer.
-- Existing issuer-unknown rows are deliberately NOT made valid for arbitrary
-- issuers. They must be re-provisioned using independently verified identity
-- evidence and a separate audited administration process.
-- DO NOT auto-claim legacy memberships using email, JWT roles or tenant claim.
-- Apply using the restricted maintenance/migration identity; not app runtime.
--
-- This additive migration does not delete workspaces or customer records.
-- It deliberately suspends access to legacy unbound memberships until their
-- issuer is explicitly re-verified.
ALTER TABLE intake_workspace_memberships
 ADD COLUMN IF NOT EXISTS issuer text;

UPDATE intake_workspace_memberships SET issuer='urn:intake:legacy:unverified'
 WHERE issuer IS NULL;

ALTER TABLE intake_workspace_memberships
 ALTER COLUMN issuer SET NOT NULL;

ALTER TABLE intake_workspace_memberships
 ADD CONSTRAINT workspace_membership_issuer_nonempty
 CHECK (length(trim(issuer)) BETWEEN 1 AND 300);

ALTER TABLE intake_workspace_memberships
 DROP CONSTRAINT intake_workspace_memberships_pkey;

ALTER TABLE intake_workspace_memberships
 ADD PRIMARY KEY (tenant_id,issuer,subject_id);

DROP INDEX IF EXISTS intake_workspace_memberships_subject_idx;
CREATE INDEX intake_workspace_memberships_identity_idx
 ON intake_workspace_memberships(issuer,subject_id,tenant_id);

COMMENT ON COLUMN intake_workspace_memberships.issuer IS
 'Verified OIDC iss claim; legacy issuer values deny authentication until independent re-provisioning';
