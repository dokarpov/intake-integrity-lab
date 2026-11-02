# Acorde — engineering brand and compatibility

**Acorde** is the product brand formerly called **Intake Integrity**. Acorde is an identity and enquiry checkpoint for sales/CRM data: validate intake, route uncertain identity decisions, preserve evidence and deliver idempotently to configured systems. It is not a replacement CRM.

## Scope of this update

- Public-facing titles, documentation, demos, and package display name use **Acorde**.
- Node package manifest name is `acorde-lab`. Internal source paths and public URL paths remain unchanged.
- The GitHub repository still lives at https://github.com/dokarpov/intake-integrity-lab and the public demo at https://dokarpov.github.io/intake-integrity-site/ until separate GitHub-level rename/deployment verification.
- Runtime service identifier `intake-integrity`, OIDC audience `intake-integrity-api`, browser localStorage keys, database/migration names, config schemas, delivery/idempotency keys and API paths are intentionally unchanged to avoid breaking clients, credentials, persisted data and prior tests.
- This brand-only release does not certify production readiness or validate real CRM/1C connections.

## Subsequent migration checklist

1. Verify downstream clients and deployed secrets before changing any OIDC audience or wire identifier.
2. Update GitHub repository slugs/settings (not available to the source-code connector), custom-domain/DNS settings if used, and Pages routing. Retain compatibility with existing links and inspect deployment output before switching any URLs.
3. Run unit tests, PostgreSQL and operator smoke CI, plus site UI checks before accepting production deployment.
4. Confirm legal and trademark clearance for Acorde before external commercial launch.
