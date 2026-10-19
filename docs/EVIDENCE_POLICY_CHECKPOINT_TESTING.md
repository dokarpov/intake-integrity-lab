# Testing proposal: evidence checkpoint for consequential actions

**Status:** testing branch only. No production integration, no public-site claim, no merge.
**Scope:** an optional extension of the original Intake Integrity evidence, provenance, review and audit rules. It does **not** replace the sales identity/consent pipeline with Shopify, a generic approval dashboard, or social listening.

## Correct product boundary

Intake Integrity evaluates **whether available evidence supports an intended operation**. It does not manufacture business decisions, customer authorizations, statuses, proof approvals, or orders.

* Existing systems (1C, Shopify, proofing app, production software) remain systems of record.
* The merchant defines existing action names and states. **No auto-created READY/HOLD statuses.**
* Every finding cites a versioned rule and the compared source fields.
* "Fields match" is **not** equivalent to "authorized to manufacture."
* Insufficient, conflicting, stale, or unverified information yields an explanation requiring the designated owner, not an automatic rejection or approval.
* A person makes the business decision at the existing order/CRM/production handoff where work already happens, not in a second daily inbox.
* An integration can carry a separately authorized decision to the existing workflow; this testing evaluator never sends it.

## General contract

Input: named, source-bound evidence records + the proposed action + a versioned explicit policy + authenticated server-side verification references.

Output: ordered **observations**, unresolved rule IDs, and a signal that human judgement is appropriate. Business decision, workflow status and action execution remain unset.

A policy consists of ordered, unique rules using these types:

| Rule | What it observes | Limit |
|---|---|---|
| \`required\` | Presence of a configured value | Presence is not truth. |
| \`compare\` | Exact equality across two named source fields | Equality is not proof of authorization or authority. |
| \`attestation\` | Approval metadata with a separately verified server-side reference | No JSON flag or actor name can self-certify. |
| \`coverage\` | Which extraction aspects a configured verifier has independently confirmed | Text-only extraction cannot establish layout or artwork identity. |

Rules compare scalar values exactly, including case, whitespace, Unicode and type. No fuzzy matching or AI guess automatically resolves spelling.

**Trust boundary:** \`trustedEvidenceRefs\` must be created by an authenticated server adapter after independent verification; it cannot come from a merchant form or the public browser. It is intentionally separate from raw \`evidence\`. A signed approval must bind to the exact buyer/order/revision/artifact under a provider-specific contract. This module does not implement signature verification.

A declared \`attestation_present\` or \`coverage_declared\` observation describes metadata and trusted-reference matching under that server contract; it is **not** a cryptographic or legal certification. Never use it by itself as a permission-to-produce signal.

### Human accountability

A human resolution, if required, should be recorded **in the existing host workflow** with:
\`actorId\`, role, policy version, source authority, evidence reference/digest, the mismatched values, action selected from the **merchant's actual permitted actions**, reason, time, and an idempotency reference. Escalation/override rights must be separately configured. Do not implement a fallback "continue anyway" button with no trace.

No such order writes or overrides are implemented in this testing branch.

## Explicit example: personalized orders

Example policy: [\`examples/personalized-production-policy.mjs\`](../examples/personalized-production-policy.mjs).

Four independent records are needed where applicable:
1. **Order:** the original personalization and its revision.
2. **Approved proof:** exact proof ID/version, bound order, contents, fonts and placement.
3. **Approval event:** authorized actor, bound order/version/proof digest, verifier-provided evidence.
4. **Production asset:** which approved version it derives from, what will be made, and independently verified aspects of that extraction.

**SOFIA / SOPHIA / SOFIA:** the order and production text match, but the approved proof differs from both. Report the two exact differences; do not assume the customer or production team is correct.

Other counter-cases covered by tests:

| Case | Finding, not a business status |
|---|---|
| Order SOFIA; approval SOPHIA; asset SOFIA | Order/proof and proof/asset differ; ask authorized owner. |
| Order/proof SOFIA; asset SOPHIA | Asset diverges from approved proof. |
| Correct text, **old proof version** used in asset | Stale derivation even when visible text agrees. |
| Order updated after customer approved earlier revision | Approval cannot automatically cover the updated order. |
| Proof replaced after approval but filename unchanged | Proof digest differs from approval reference. |
| Approval or asset belongs to another order | Order binding conflict. |
| Same spelling but different font, placement or dimensions | Only aspects explicitly covered can be compared; no assumption of visual equivalence. |
| Unicode lookalikes, whitespace or letter case differ | Exact difference; no silent normalization. |
| Approval absent where policy requires one | Missing evidence, no inferred approval. |
| Apparent approval flag from unverified external source | Unverifiable; a source cannot self-attest. |
| Extracted text is verified but font/placement are not | Partial coverage, not complete artifact verification. |
| Production asset digest is missing | Insufficient fingerprint evidence. |
| External source unavailable | Missing evidence; no blind repeated write or guess. |
| Standard item with no proof requirement | Use a separately **approved** policy; do not hard-code personalized-order rules globally. |
| Same fields present and matching | No observed difference **within tested scope**, not production authorization. |
| Legitimate change after original order | Resolve which document is authoritative through existing workflow; do not choose earliest or latest by assumption. |

**Important:** checking a preview PDF and a machine-ready file requires provider-specific extraction and format-aware comparison. Vector art and text can be transformed; their bytes need not match. Image similarity, OCR, fonts, thread colors, machine settings and placement cannot be declared verified without reliable extraction and suitable tolerances **approved by the production owner**. No such extractor is provided here.

## Why the generic engine isn't a new CRM

The rule evaluator works on named evidence and can be reused for invoice-versus-approved-quote discrepancies or to *present* conflicting CRM attributes. It does not replace the original identity matcher, consent logic, review queue, outbox or 1C/CRM adapters.

The sales case still needs authoritative customer identity, source consent and idempotent delivery. Shared phone/email is not sufficient evidence of identity. A separate new daily queue is not part of the intended user journey.

The first integration should be an **in-place checkpoint at one consequential handoff**, without a new dashboard, order statuses or daily monitoring.

## Required validation before any merge

1. Obtain real, anonymized sample orders/proofs/production assets and map the exact fields and source of approval.
2. Learn the **merchant's existing states**, who can authorize a correction, and precisely which operation must be intercepted.
3. Test supported sources for stable ID/version/digest/approval data. Verify what the provider's API actually exposes.
4. Agree a field-by-field policy and tolerance rules with production staff; no generic "looks similar enough" criterion.
5. Use a server-side adapter with authenticated provenance; test missing data, forged claims, retries, order changes and conflicting versions.
6. Compare operator time and error frequency against the existing Shopify/1C flow. Measure false alarms and uncovered errors.
7. Require proof that the host system can display an actionable issue **without** requiring users to monitor another application.
8. Preserve the original Intake Integrity product and its tests; only consider separate commercialization after pilot evidence.

**Non-claims:** no Shopify connector, no machine connection, no file extraction, no live customer test, no willingness-to-pay validation, no permission-to-produce automation.
