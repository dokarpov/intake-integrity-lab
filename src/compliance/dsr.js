import { AUDIT_ACTION, DATA_CLASS, RESULT } from './event-catalog.js';

export function recordDsrRequest(ledger, { requestId, subjectRef, actor, requestType, purpose, legalBasis, intakeId }) {
  if (!requestId || !requestType) throw new Error('dsr_request_fields_required');
  return ledger.append({
    intakeId,
    subjectRef,
    actor,
    action: AUDIT_ACTION.DSR_REQUESTED,
    result: RESULT.PENDING,
    reasonCode: requestType,
    purpose,
    legalBasis,
    object: { type: 'dsr_request', ref: requestId },
    dataClasses: [DATA_CLASS.AUDIT_METADATA],
    metadata: { requestType }
  });
}

export function recordDsrCompletion(ledger, { requestId, subjectRef, actor, requestType, purpose, legalBasis, outcome = 'completed', intakeId }) {
  return ledger.append({
    intakeId,
    subjectRef,
    actor,
    action: AUDIT_ACTION.DSR_COMPLETED,
    result: RESULT.SUCCESS,
    reasonCode: outcome,
    purpose,
    legalBasis,
    object: { type: 'dsr_request', ref: requestId },
    dataClasses: [DATA_CLASS.AUDIT_METADATA],
    metadata: { requestType }
  });
}

export function recordErasure(ledger, { erasureId, subjectRef, actor, purpose, legalBasis, dataStoreRefs = [], intakeId }) {
  return ledger.append({
    intakeId,
    subjectRef,
    actor,
    action: AUDIT_ACTION.DATA_ERASURE_COMPLETED,
    result: RESULT.SUCCESS,
    reasonCode: 'erasure_completed_in_source_stores',
    purpose,
    legalBasis,
    object: { type: 'erasure_operation', ref: erasureId },
    dataClasses: [DATA_CLASS.AUDIT_METADATA],
    evidenceRefs: dataStoreRefs,
    metadata: { sourceStoreCount: dataStoreRefs.length }
  });
}
