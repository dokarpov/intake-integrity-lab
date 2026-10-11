# Operator UX architecture

## Roles

**Sales user** should only see intake/customer workflow and actionable validation. They should not configure dedup mode, WORM, retention or KMS.

**Reviewer** sees ambiguous identity evidence, conflicting fields, review SLA and an explicit decision with mandatory reason.

**Auditor / DPO** sees searchable audit evidence, object/subject scope, proof state and controlled export.

**Security / compliance admin** sees key health, immutable archive, checkpoint age, retention/legal holds and privileged approvals.

## Design rules

1. Show operational state before implementation detail.
2. Do not use raw JSON as the primary UI.
3. Make `pending / sealed / failed / review-required` visually distinct.
4. Keep PII masked in review lists; disclose only the minimum required in the selected case.
5. Every risky action needs consequence text, scope, actor and reason.
6. Technical proof (hashes, sequence, checkpoint ID) lives one layer deeper in the event drawer.
7. Configuration belongs in Integrations/Controls, not the sales intake surface.
8. The UI must reveal uncertainty rather than collapse it into one confidence number.
