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

## Optional pre-action evidence checks (testing only)

9. **No separate daily inbox for sales or production staff.** Present a concrete discrepancy at the existing CRM/1C/Shopify handoff. The current operator console is primarily for specialist reviewers/administrators, not a mandatory salesperson workflow.
10. Evaluation is not authorization. Do not introduce `READY`, `HOLD`, or other production statuses without the merchant's explicit existing-state mapping and integration permission.
11. Source-of-authority is field-specific and versioned. Compare order, approved artifact, approval event and proposed production asset; distinguish factual mismatches from missing/unverifiable claims.
12. Missing or conflicting evidence needs a **human-owned business decision** in the host system. Never auto-select an authoritative spelling or silently release work.
13. Approval cannot self-attest through JSON or a boolean in a form. Claims must be independently verified by a server-side trusted connector before the evidence can be treated as attested.
14. Keep rule findings scoped to what can actually be verified. Text agreement cannot prove fonts, placements, dimensions, artwork identity or manufacturing readiness.
15. Retain audit references to policy version, actor/role, evidence/asset revision, selected existing-system action, rationale and idempotency key; don't publish raw technical implementation notes in the user interface.
