# Authentication, authorization and tenancy

## Production mode

`NODE_ENV=production` refuses to run with development auth. Configure an OIDC issuer, API audience and JWKS URI in `SERVICE_CONFIG_FILE`.

Supported token signature algorithms in the reference verifier:

- RS256
- ES256

Roles are mapped to permissions inside `src/service/auth/rbac.js`.

Core roles:

- `sales`
- `reviewer`
- `review_manager`
- `auditor`
- `dpo`
- `security_admin`
- `policy_admin`
- `integration_admin`

The console hides actions the authenticated principal cannot perform, but the server remains authoritative.

## Development mode

Development auth is only accepted from loopback and requires `x-dev-user`, `x-dev-tenant`, and `x-dev-roles`. This exists for the local portfolio/demo environment only.

## Subject pseudonymisation

The service pseudonymises a contact identifier before writing subject references to DSR/audit workflow state.

Preferred production provider: AWS KMS HMAC (`AWS_KMS_HMAC_KEY_ID`). A locally-held HMAC secret is supported as a deployment fallback, but should be supplied through a secret-management boundary rather than committed configuration.
