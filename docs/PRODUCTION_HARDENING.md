# Production hardening — residual checklist after v0.4

v0.4 implements the software and IaC boundary for the core controls, but a repository cannot prove the external environment has actually been deployed and operated correctly.

## Implemented in the repository

- S3 Object Lock adapter with Versioning/Object-Lock preflight and COMPLIANCE retention verification;
- legal hold + monotonic retention extension methods;
- AWS KMS asymmetric signer adapter;
- AWS KMS HMAC pseudonymiser;
- AWS KMS data-key provider + AES-256-GCM archive encryption;
- PKCS#11 HSM signer;
- PostgreSQL atomic append profile;
- hash chain, signed checkpoints, Merkle segments, archive quorum;
- two-person approval + break-glass model;
- RFC3161 timestamp client;
- control-health monitor and recovery verifier;
- Terraform for managed-HSM/WORM profile and CloudHSM skeleton.

## Still requires the deployment/operator

1. Apply Terraform in a controlled account and verify policies before production traffic.
2. Choose lawful retention periods; the example 2555 days is a placeholder, not legal advice.
3. Separate application, control-admin, KMS-admin and schema-owner identities.
4. Connect a real PostgreSQL HA/backup configuration and test restore.
5. Enable cloud control-plane audit logs (for example CloudTrail) and route alerts to a monitored SIEM/on-call channel.
6. Define checkpoint/anchor SLOs and alert ownership.
7. Configure RFC3161 TSA trust roots if external trusted time is required.
8. For dedicated HSM: initialise the CloudHSM/on-prem HSM, create crypto users, generate keys inside the HSM and protect credentials out of source control.
9. Validate any on-prem S3-compatible WORM appliance against its own compliance/retention guarantees; protocol compatibility alone does not prove regulatory suitability.
10. Run penetration tests including log injection, authorization bypass, archive-policy changes and key-rotation failure.
11. Run recovery drills and retain the evidence.
12. Review DSR/erasure behavior against actual legal obligations: immutable audit metadata may have a distinct retention basis from source business data.
13. Establish incident procedures for suspected key compromise, integrity failure, writer outage and WORM-anchor outage.
14. Validate time synchronization and drift monitoring on all writers.
15. Establish secure software-supply-chain controls, dependency scanning and release signing for the deployed service.
