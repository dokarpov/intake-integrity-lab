# Standards / guidance mapping

This document records the engineering references used to shape v0.4. It is not a statement that the repository satisfies every control in these frameworks.

## GDPR / Regulation (EU) 2016/679

Relevant design themes:

- accountability and documented processing;
- Article 30 records of processing activities: purpose, data-subject/data categories, recipients/transfers, retention and security-measure description;
- Article 32 security of processing: pseudonymisation/encryption as appropriate, confidentiality/integrity/availability/resilience and regular testing/evaluation.

The included processing-activity snapshot is supporting evidence, not a replacement for the organisation's full RoPA.

## NIST SP 800-53 Rev. 5 — Audit and Accountability (AU)

Relevant design themes:

- define audit events;
- include sufficient audit-record content;
- protect audit information;
- manage audit storage and retention;
- minimise personally identifiable information in audit records where it is not required.

## OWASP Logging Cheat Sheet

Relevant design themes:

- distinguish application/audit/security logs by purpose;
- record sensitive business actions such as data changes, exports and legal opt-ins;
- avoid logging secrets and unnecessary PII;
- protect log integrity and audit access to logs;
- use secure transport and central/immutable storage where appropriate;
- define retention and disposal rather than keeping logs indefinitely.


## v0.4 infrastructure notes

The enterprise profile additionally maps implementation controls to provider capabilities: WORM/object-lock retention, HSM/KMS-backed signing and MAC operations, independent cryptographic checkpoints, separation of duties, recovery evidence and control-plane logging. Provider capability is not a substitute for organisational control design or an external audit.
