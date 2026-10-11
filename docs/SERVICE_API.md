# Authenticated service API

All `/api/*` endpoints require an authenticated principal. Health/readiness endpoints do not expose tenant data.

## Authentication

Production: OAuth/OIDC access token in `Authorization: Bearer <token>`.

The verifier checks:

- signature against configured JWKS;
- explicit algorithm allow-list;
- `kid` with refresh-on-miss for key rotation;
- issuer;
- audience;
- expiry / not-before;
- subject;
- configured tenant claim.

The API derives permissions from server-side role mappings. A caller cannot add permissions by sending a different role in the request body.

## Main endpoints

```text
GET  /api/me
POST /api/intakes

GET  /api/reviews
POST /api/reviews/:id/assign
POST /api/reviews/bulk-assign
POST /api/reviews/:id/claim
POST /api/reviews/:id/resolve

GET  /api/audit
POST /api/audit/export

GET  /api/dsr
POST /api/dsr
POST /api/dsr/:id/assign
POST /api/dsr/:id/transition

GET  /api/policy-changes
POST /api/policy-changes
POST /api/policy-changes/:id/approve
POST /api/policy-changes/:id/publish

GET  /api/controls/health
POST /api/controls/verify

GET  /api/integrations
POST /api/integrations/1c/probe
```

## Fail-closed boundaries

- Material intake actions use required audit writes.
- External identity mode requires a server-side resolver; caller-provided dedup verdicts are ignored.
- Review resolution requires an explicit decision and reason.
- High-risk policy changes require two independent approvers.
- DSR transitions must follow the defined lifecycle.
- Audit export is permission-gated and the export action is itself audited.

## Tenant isolation

The tenant is taken from a verified token claim. Tenant-specific runtime objects use a tenant-specific ledger ID. PostgreSQL workflow tables include `tenant_id` and query it on every read/update path.

## Rate / payload controls

The reference API uses an in-process sliding-window limiter and a 256 KiB JSON body limit. In a real deployment also enforce limits at the ingress/gateway layer.
