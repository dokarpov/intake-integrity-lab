# Intake Integrity Lab — product validation

This project treats intake as a control boundary, not a dedup feature. Validation therefore has two layers: technical integrity and operator usefulness.

## Technical evidence

Already covered in the repository:

- deterministic service/unit tests;
- real PostgreSQL integration in CI;
- append-only / integrity verification paths;
- durable outbox and delivery idempotency;
- human-review routing;
- browser smoke for the operator console.

Provider-bound AWS / 1C suites require real sandbox resources and are not treated as active unless those resources are configured.

## Operator evidence to collect in a real deployment

- share of intake resolved automatically vs routed to review;
- review age, assignment time and SLA breaches;
- reason distribution for REVIEW decisions;
- rate of attempted unsafe identity-critical updates;
- duplicate delivery prevented by idempotency;
- dead-letter / retry recovery time;
- operator time required per exception;
- audit/export requests successfully reconstructed from durable evidence.

## Product failure conditions

The system is not useful merely because the ledger is correct. A deployment should be reconsidered if:

- ambiguous cases are hidden rather than routed;
- reviewers cannot understand why a case reached them;
- review workload grows faster than automation removes safe work;
- idempotency requires receiver-side assumptions that are not implemented;
- audit evidence is technically present but operationally unusable.

## Compliance boundary

These measures can demonstrate control behavior and operational reliability. They do not constitute GDPR certification or legal compliance by themselves.
