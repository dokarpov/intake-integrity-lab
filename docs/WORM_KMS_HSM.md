# WORM, KMS and HSM deployment profiles

## Profile A — managed HSM-backed controls (recommended default)

- PostgreSQL append ledger for the live write path.
- AWS KMS asymmetric signing key (`ECC_NIST_P256`, `SIGN_VERIFY`) for checkpoints.
- AWS KMS HMAC key (`HMAC_256`) for pseudonymous subject references.
- AWS KMS symmetric key for envelope-encryption data keys.
- S3 Object Lock bucket with Versioning + `COMPLIANCE` default retention.
- Optional second WORM target for quorum.

AWS KMS operations execute inside AWS-managed physical HSMs. The application never receives the private asymmetric signing key or the HMAC key material.

## Profile B — dedicated physical HSM

Use the PKCS#11 signer with a dedicated HSM such as AWS CloudHSM or an on-premises PKCS#11 device. The application supplies only the PKCS#11 module path, crypto-user credential through a secret source, and a key label. Private signing key material remains inside the HSM.

`infra/aws/cloudhsm.tf.example` is deliberately opt-in because a dedicated HSM cluster has meaningful cost, network and operating requirements.

## WORM definition

The repository implements a WORM-capable archive adapter using S3 Object Lock. In COMPLIANCE mode, protected object versions cannot be deleted or overwritten before the retention date. The adapter verifies:

- Object Lock is enabled;
- bucket Versioning is enabled;
- a version ID is returned;
- SHA-256 checksum matches;
- the stored version has the requested retention mode/date.

For on-premises storage appliances exposing compatible S3 Object Lock semantics, the same adapter can be pointed at a custom endpoint. A physical tape/optical WORM device cannot be created by application code; it requires hardware/media provisioning. v0.4 therefore implements the verifiable handoff boundary and immutable-object controls rather than pretending a local file is physical WORM media.

## Sources used for the implementation

- AWS S3 Object Lock documentation: https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html
- AWS KMS Sign API: https://docs.aws.amazon.com/kms/latest/APIReference/API_Sign.html
- AWS KMS key-store / HSM model: https://docs.aws.amazon.com/kms/latest/developerguide/key-store-overview.html
- AWS CloudHSM PKCS#11: https://docs.aws.amazon.com/cloudhsm/latest/userguide/pkcs11-library.html
