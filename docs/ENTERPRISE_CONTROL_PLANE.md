# Enterprise control plane — v0.4

v0.4 turns the v0.3 tamper-evident ledger into a deployable control-plane architecture.

## Write path

```text
business action
  ↓
required audit append
  ↓
transactional / atomic ledger store
  ↓
checkpoint scheduler
  ↓
signed segment + Merkle root
  ↓
optional RFC3161 timestamp
  ↓
AES-256-GCM client-side archive encryption
  ↓
WORM target A ─┐
WORM target B ─┼─ archive quorum
WORM target N ─┘
```

The business action fails closed if the required ledger write fails. WORM anchoring is asynchronous and governed by a maximum-anchor-age SLO; a stale or failed anchor raises a control-plane alert rather than making every transaction synchronously depend on object storage.

## Control surfaces added in v0.4

- atomic append API and a PostgreSQL store profile;
- Merkle-rooted ledger segments and inclusion proofs;
- HSM/KMS checkpoint signer interface;
- AWS KMS implementation;
- PKCS#11 hardware-HSM implementation;
- KMS-backed HMAC subject pseudonymisation;
- AES-256-GCM client-side archive encryption with KMS data keys;
- S3 Object Lock WORM archive adapter with COMPLIANCE mode verification;
- archive quorum across independent targets;
- RFC3161 timestamp client via OpenSSL;
- key registry and explicit key lifecycle;
- four-eyes / two-person control for destructive security actions;
- time-bounded break-glass grants;
- control-health monitoring for chain, checkpoint, WORM and key age;
- recovery verifier;
- Terraform for the AWS managed-HSM profile;
- optional Terraform skeleton for dedicated AWS CloudHSM.

## Trust boundaries

Application writers should be unable to:

1. mutate historical ledger rows;
2. delete immutable WORM versions;
3. export private signing material;
4. self-approve key destruction, legal-hold release or break-glass access;
5. shorten a locked WORM retention period;
6. administer the database schema and application writer role from the same runtime identity.
