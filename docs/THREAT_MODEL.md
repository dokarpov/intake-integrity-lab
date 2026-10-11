# Threat model — v0.4

## Assets

- chronological audit evidence;
- checkpoint signing keys;
- subject-HMAC keys;
- archive encryption keys;
- retention/legal-hold policy;
- audit export privileges;
- 1C/CRM delivery evidence.

## Threats addressed by code + designed infrastructure

- event edited, removed or reordered after append;
- duplicate/replayed audit event IDs;
- concurrent writers generating the same sequence / previous hash;
- mutable application database rewritten after compromise;
- archive object overwrite/delete before retention expiry when a verified COMPLIANCE WORM target is used;
- application process obtaining private KMS/HSM signing or HMAC key material;
- copied raw PII/secrets in common metadata fields/values;
- silent human override;
- unauthorized audit read/export;
- single-person legal-hold release / destructive key operation;
- stale checkpoint or missing immutable anchor;
- disputed downstream delivery without request/response digests;
- archive confidentiality breach when client-side encryption is enabled;
- a verifier needing to trust a mutable application index for event inclusion (Merkle proof available).

## Threats reduced but not eliminated

- administrator compromise: separation of duties + two-person controls reduce blast radius, but an organisation can still misconfigure IAM/HSM roles;
- clock manipulation: RFC3161 can add external time evidence, but local occurredAt values can still originate from a compromised host;
- ransomware: WORM anchors preserve sealed evidence, but business-system availability needs separate resilience controls;
- malicious source data: the ledger proves what was recorded, not that the original human/system statement was true.

## Not solved by application code

- physical destruction or compromise of all independently administered infrastructure;
- collusion between all required administrators/approvers;
- incorrect legal basis/retention/purpose chosen by the organisation;
- untrustworthy external TSA or cloud provider;
- security of an on-prem HSM/WORM appliance that has not been independently evaluated;
- endpoint compromise before events reach the ledger;
- compromised CI/CD or dependency supply chain unless deployment adds those controls.
