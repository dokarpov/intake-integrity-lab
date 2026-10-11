# Operating model

A compliance ledger needs ownership, not only code.

| Role | Owns | Must not silently own |
| --- | --- | --- |
| Product / process owner | which business actions are material enough to audit; reason codes; workflow semantics | legal basis decisions alone |
| Privacy / DPO | purpose, legal-basis decision, subject-rights policy, retention/privacy review | application deployment/security operations |
| Security | key custody, immutable storage, access controls, monitoring, incident response | business meaning of events |
| Application engineering | correct event generation, fail-closed behavior, correlation IDs, integration receipts | ability to rewrite sealed history |
| Auditor / assurance | read/export under approved scope, verification of bundles/checkpoints | production write privileges |
| 1C / CRM integration owner | local field/object mapping and receiver receipts | changing canonical audit semantics per integration |

## Separation of duties

For meaningful tamper resistance, no single application administrator should control all of:

1. business event generation;
2. ledger file/database mutation;
3. checkpoint private signing key;
4. immutable archive deletion policy;
5. audit export approval.

The reference repository cannot enforce this organisational split by itself; it makes the boundaries explicit so production infrastructure can.
