# Security

## Security model

This repository is a reference implementation of a sales-intake integrity and compliance control plane. It is not a certification, legal opinion, or a claim that a deployment is compliant by virtue of using the code.

Production deployments are expected to provide their own identity provider, MFA/session policy, network controls, approved legal-basis/retention configuration, PostgreSQL role separation, KMS/HSM/WORM resources, monitoring, backup/restore procedures, and incident-response process.

## Secrets

Do not commit credentials, bearer tokens, private keys, 1C credentials, database passwords, raw production PII, or HSM PINs. Runtime secrets are injected through the deployment environment or the cloud/HSM provider. The durable delivery outbox deliberately strips secret-bearing HTTP headers before persistence.

## Audit evidence

The live ledger is append-only at the application/database layer. Cryptographic sealing and immutable retention are separate controls. A deployment should verify both: chain/checkpoint integrity and the independent WORM anchor. Audit access and privileged control actions should themselves be audited.

## Reporting a vulnerability

For a real deployment, replace this section with the owning organization's private security-reporting channel and response SLA before making the service public.
