# Known gaps after v0.6.1

> Product note: remaining items are **deployment and next-hardening**, not missing product concepts. The control-plane surface (intake, review, DSR, policy, audit, 1C delivery) is implemented and covered by local tests.


v0.6 closes the previous gaps around an authenticated service boundary, team-review/DSR/policy UX, and deployable live integration-test harnesses. The remaining gaps are deployment or next-hardening work.

## Requires a real deployment

- Configure the actual OIDC provider, MFA/session policy and IdP claim mapping.
- Run the API behind a production ingress/WAF with network-level rate limits and TLS policy.
- Apply organization-approved legal-basis, purpose, retention and DSR policy values.
- Deploy PostgreSQL roles so the app cannot own the schema or bypass the append-only trigger.
- Connect real WORM/KMS/HSM telemetry to `/api/controls/health`; the console intentionally reports it as missing otherwise.
- Run the AWS and 1C live suites with sandbox credentials; they were not executed in the build environment used to package this ZIP.
- Connect external SIEM/paging and perform backup/restore + disaster-recovery drills.

## Engineering hardening still worth doing

- OpenTelemetry traces/metrics for API, ledger append, WORM sealing and delivery-worker latency.
- A gateway/distributed rate limiter instead of relying only on the in-process reference limiter.
- Managed migration tooling and rollback/runbook discipline instead of raw bootstrap SQL.
- Dependency lockfile, SBOM, SAST/dependency/secret scanning and signed release provenance.
- Dedicated encrypted/TTL outbox payload storage if the chosen PostgreSQL threat model requires application-layer encryption for transient CRM payloads.
- Provider-specific OIDC authorization-code/BFF front-end login; the current console consumes the API session/token supplied by its host environment and uses loopback dev auth locally.
- Locale/i18n and accessibility testing with real sales/compliance users.
