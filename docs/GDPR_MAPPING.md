# EU / GDPR mapping

This is an engineering mapping, not legal advice and not a certification statement.

## Accountability and processing records

The project keeps a versioned `processing-activity` snapshot and purpose/legal-basis/policy references on events. This can support evidence around accountability and records of processing, but the audit ledger is **not itself a complete Article 30 RoPA**. The organisation still has to maintain controller/processor details, purposes, subject/data categories, recipients/transfers, erasure periods and security measures.

## Data minimisation and storage limitation

The ledger stores opaque references and cryptographic digests rather than copied CRM payloads. Retention is explicit and policy-versioned. Audit metadata can still be personal data, so audit retention requires its own justified policy; an immutable ledger is not a justification to keep records forever.

## Security of processing

Reference controls include pseudonymisation, cryptographic integrity checks, signed checkpoints, restricted audit access, access-event logging and regular verification tests. Production still needs encryption at rest, TLS, secrets/KMS, backup/recovery, time synchronisation, monitoring, immutable storage and incident-response procedures.

## DSR / erasure

The ledger supports `dsr.requested`, `dsr.completed`, `data.erasure_requested` and `data.erasure_completed` events. An erasure event records that source systems were erased; it does not copy the erased personal data into the ledger. Whether a minimal audit record must/can be retained after an erasure request is a legal/policy decision and must not be hard-coded globally.
