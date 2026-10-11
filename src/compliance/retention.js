import { AUDIT_ACTION, DATA_CLASS, RESULT } from './event-catalog.js';

export function recordRetentionAssignment(ledger, { objectRef, actor, purpose, legalBasis, retentionClass, expiresAt, policyRef, intakeId, subjectRef }) {
  return ledger.append({
    intakeId,
    subjectRef,
    actor,
    action: AUDIT_ACTION.RETENTION_ASSIGNED,
    result: RESULT.SUCCESS,
    reasonCode: 'retention_policy_applied',
    purpose,
    legalBasis,
    object: { type: 'business_record', ref: objectRef },
    dataClasses: [DATA_CLASS.AUDIT_METADATA],
    retention: { class: retentionClass, expiresAt },
    policyRefs: policyRef ? [policyRef] : []
  });
}

export function recordLegalHold(ledger, { objectRef, actor, purpose, legalBasis, holdId, placed = true, intakeId, subjectRef }) {
  return ledger.append({
    intakeId,
    subjectRef,
    actor,
    action: placed ? AUDIT_ACTION.LEGAL_HOLD_PLACED : AUDIT_ACTION.LEGAL_HOLD_RELEASED,
    result: RESULT.SUCCESS,
    reasonCode: placed ? 'legal_hold_active' : 'legal_hold_released',
    purpose,
    legalBasis,
    object: { type: 'business_record', ref: objectRef },
    dataClasses: [DATA_CLASS.AUDIT_METADATA],
    metadata: { holdId }
  });
}
