# DSR, policy governance and high-volume review UX

## Review queue

Large-team workflow is not just a list of ambiguous records.

The backend supports:

- queue + priority;
- SLA due time;
- explicit assignee;
- bulk assignment;
- reviewer claim with a lease to reduce double work;
- conflict-aware resolve;
- mandatory decision reason;
- audit events for assignment, claim and final override.

The list view shows references and operational metadata. Raw PII is intentionally not required for queue triage.

## DSR workspace

A DSR case stores a pseudonymous subject reference, request type, due time, owner, evidence references and lifecycle history.

Lifecycle:

```text
requested
  → identity_check
  → collecting
  → legal_review (when needed)
  → ready
  → completed
```

Reject/cancel branches are explicit and terminal. The original email/phone used to locate the subject is pseudonymised immediately by the service and is not copied into the DSR case record.

## Policy changes

A policy proposal contains:

- policy ID;
- from/to versions;
- structured field-level diff;
- reason;
- risk level;
- canonical payload digest;
- independent approvals;
- publish actor/time.

High-risk change => 2 independent approvers. The proposer cannot self-approve. Sensitive/credential-like values are rejected from the diff payload.

The UI shows the diff before the approval controls instead of asking an approver to inspect JSON.
