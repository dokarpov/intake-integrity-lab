import { processSalesIntake } from '../pipeline.js';
import { AUDIT_ACTION, DATA_CLASS, RESULT } from './event-catalog.js';

export const AUDIT_MODE = Object.freeze({ REQUIRED: 'required', BEST_EFFORT: 'best_effort' });
async function write(ledger, mode, event) { try { return await ledger.append(event); } catch (error) { if (mode === AUDIT_MODE.REQUIRED) throw new Error(`required_audit_write_failed:${error.message}`); return { auditError: error.message }; } }

/** Canonical audited intake orchestration. Review persistence is async-safe. */
export async function processSalesIntakeAudited(rawInput, { ledger, auditMode = AUDIT_MODE.REQUIRED, auditContext, reviewQueue, ...pipelineOptions } = {}) {
  if (!ledger?.append) throw new Error('compliance_ledger_required');
  if (!auditContext?.actor || !auditContext?.purpose || !auditContext?.legalBasis) throw new Error('audit_context_actor_purpose_legal_basis_required');
  const result = processSalesIntake(rawInput, { ...pipelineOptions, reviewQueue: undefined });
  const envelope = result.envelope;
  const common = { intakeId: envelope.intakeId, subjectRef: auditContext.subjectRef, actor: auditContext.actor, purpose: auditContext.purpose, legalBasis: auditContext.legalBasis, object: { type: 'sales_intake', ref: envelope.intakeId }, policyRefs: auditContext.policyRefs || [], retention: auditContext.retention };
  await write(ledger, auditMode, { ...common, action: result.ok ? AUDIT_ACTION.INTAKE_RECEIVED : AUDIT_ACTION.VALIDATION_BLOCKED, result: result.ok ? RESULT.SUCCESS : RESULT.BLOCKED, reasonCode: result.ok ? 'canonical_intake_accepted' : result.validation.errors.join(','), dataClasses: [DATA_CLASS.CONTACT, DATA_CLASS.SALES, DATA_CLASS.CONSENT], metadata: { channel: envelope.source.channel } });
  if (!result.ok) return { ...result, auditReady: true };
  await write(ledger, auditMode, { ...common, action: AUDIT_ACTION.DECISION_MADE, result: result.deliverable ? RESULT.SUCCESS : (result.resolution.route === 'review' ? RESULT.PENDING : RESULT.BLOCKED), reasonCode: result.resolution.reason, dataClasses: [DATA_CLASS.AUDIT_METADATA], metadata: { route: result.resolution.route, dedupMode: result.dedupMode, candidateCount: result.resolution.candidates?.length || 0 } });
  let reviewItem=null;
  if (result.resolution.route === 'review' && reviewQueue?.enqueue) {
    reviewItem=await reviewQueue.enqueue({ intakeId: envelope.intakeId, reason: result.resolution.reason, candidateRefs: result.resolution.candidates.map(x => x.candidate?.id || x.id).filter(Boolean), context: { source: envelope.source.channel } });
    await write(ledger, auditMode, { ...common, action: AUDIT_ACTION.HUMAN_REVIEW_QUEUED, result: RESULT.PENDING, reasonCode: reviewItem.reason, object: { type: 'review_item', ref: reviewItem.id }, dataClasses: [DATA_CLASS.AUDIT_METADATA], metadata: { candidateCount: reviewItem.candidateRefs.length } });
  }
  return { ...result, reviewItem, auditReady: true };
}

export async function resolveReviewAudited(reviewQueue, reviewId, resolution, { ledger, auditMode = AUDIT_MODE.REQUIRED, auditContext, intakeId }) {
  if (!resolution?.actor || !resolution?.decision || !resolution?.note) throw new Error('review_resolution_actor_decision_note_required');
  const resolved = await reviewQueue.resolve(reviewId, resolution);
  await write(ledger, auditMode, { intakeId, subjectRef: auditContext.subjectRef, actor: auditContext.actor, action: AUDIT_ACTION.HUMAN_OVERRIDE, result: RESULT.SUCCESS, reasonCode: resolution.note, purpose: auditContext.purpose, legalBasis: auditContext.legalBasis, object: { type: 'review_item', ref: reviewId }, dataClasses: [DATA_CLASS.AUDIT_METADATA], policyRefs: auditContext.policyRefs || [], retention: auditContext.retention, metadata: { decision: resolution.decision, hasTargetRef: Boolean(resolution.targetRef) } });
  return resolved;
}
