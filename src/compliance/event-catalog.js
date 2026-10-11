import { scanSensitiveMetadataValues } from './metadata-policy.js';

export const AUDIT_ACTION = Object.freeze({
  INTAKE_RECEIVED: 'intake.received',
  VALIDATION_BLOCKED: 'intake.validation_blocked',
  DECISION_MADE: 'decision.made',
  HUMAN_REVIEW_QUEUED: 'review.queued',
  REVIEW_ASSIGNED: 'review.assigned',
  REVIEW_CLAIMED: 'review.claimed',
  HUMAN_OVERRIDE: 'review.human_override',
  CONSENT_GRANTED: 'consent.granted',
  CONSENT_WITHDRAWN: 'consent.withdrawn',
  CONSENT_VERSION_SEEN: 'consent.document_seen',
  DATA_CREATED: 'data.created',
  DATA_UPDATED: 'data.updated',
  DATA_READ: 'data.read',
  DATA_EXPORTED: 'data.exported',
  DATA_ERASURE_REQUESTED: 'data.erasure_requested',
  DATA_ERASURE_COMPLETED: 'data.erasure_completed',
  DSR_REQUESTED: 'dsr.requested',
  DSR_TRANSITIONED: 'dsr.transitioned',
  DSR_COMPLETED: 'dsr.completed',
  DELIVERY_ATTEMPTED: 'integration.delivery_attempted',
  DELIVERY_SUCCEEDED: 'integration.delivery_succeeded',
  DELIVERY_FAILED: 'integration.delivery_failed',
  RETENTION_ASSIGNED: 'retention.assigned',
  RETENTION_EXPIRED: 'retention.expired',
  LEGAL_HOLD_PLACED: 'retention.legal_hold_placed',
  LEGAL_HOLD_RELEASED: 'retention.legal_hold_released',
  ACCESS_GRANTED: 'audit.access_granted',
  ACCESS_DENIED: 'audit.access_denied',
  AUDIT_EXPORTED: 'audit.bundle_exported',
  POLICY_CHANGE_PROPOSED: 'policy.change_proposed',
  POLICY_CHANGE_APPROVED: 'policy.change_approved',
  POLICY_CHANGED: 'policy.changed',
  KEY_ROTATED: 'crypto.key_rotated',
  CHECKPOINT_CREATED: 'ledger.checkpoint_created',
  INTEGRITY_FAILURE: 'ledger.integrity_failure',
  ARCHIVE_ANCHORED: 'ledger.archive_anchored',
  ARCHIVE_FAILED: 'ledger.archive_failed',
  TIMESTAMP_ISSUED: 'ledger.timestamp_issued',
  APPROVAL_REQUESTED: 'control.approval_requested',
  APPROVAL_GRANTED: 'control.approval_granted',
  APPROVAL_CONSUMED: 'control.approval_consumed',
  BREAK_GLASS_GRANTED: 'control.break_glass_granted',
  BREAK_GLASS_USED: 'control.break_glass_used',
  KEY_REVOKED: 'crypto.key_revoked',
  KEY_DESTROYED: 'crypto.key_destroyed',
  RECOVERY_VERIFIED: 'recovery.verified'
});

export const ACTOR_TYPE = Object.freeze({
  HUMAN: 'human',
  SYSTEM: 'system',
  SERVICE: 'service',
  EXTERNAL: 'external'
});

export const RESULT = Object.freeze({
  SUCCESS: 'success',
  BLOCKED: 'blocked',
  FAILURE: 'failure',
  PENDING: 'pending'
});

export const LEGAL_BASIS = Object.freeze({
  CONSENT: 'consent',
  CONTRACT: 'contract',
  LEGAL_OBLIGATION: 'legal_obligation',
  VITAL_INTERESTS: 'vital_interests',
  PUBLIC_TASK: 'public_task',
  LEGITIMATE_INTERESTS: 'legitimate_interests',
  NOT_APPLICABLE: 'not_applicable',
  TO_BE_DETERMINED: 'to_be_determined'
});

export const DATA_CLASS = Object.freeze({
  CONTACT: 'contact',
  IDENTITY: 'identity',
  SALES: 'sales',
  CONSENT: 'consent',
  CONTRACT: 'contract',
  PAYMENT: 'payment',
  BEHAVIORAL: 'behavioral',
  TECHNICAL: 'technical',
  AUDIT_METADATA: 'audit_metadata',
  SPECIAL_CATEGORY: 'special_category'
});

export const RETENTION_CLASS = Object.freeze({
  SHORT: 'short',
  STANDARD: 'standard',
  CONTRACTUAL: 'contractual',
  LEGAL: 'legal',
  SECURITY: 'security',
  LEGAL_HOLD: 'legal_hold'
});

const VALID_ACTIONS = new Set(Object.values(AUDIT_ACTION));
const VALID_ACTORS = new Set(Object.values(ACTOR_TYPE));
const VALID_RESULTS = new Set(Object.values(RESULT));
const VALID_BASES = new Set(Object.values(LEGAL_BASIS));

const PII_KEYS = new Set([
  'email', 'phone', 'telephone', 'mobile', 'name', 'fullname', 'firstname', 'lastname',
  'address', 'passport', 'ssn', 'taxid', 'birthdate', 'dateofbirth', 'cardnumber',
  'accountnumber', 'password', 'token', 'accesstoken', 'authorization', 'cookie'
]);

function scanForbiddenKeys(value, path = 'metadata') {
  if (!value || typeof value !== 'object') return [];
  const found = [];
  if (Array.isArray(value)) {
    value.forEach((item, i) => found.push(...scanForbiddenKeys(item, `${path}[${i}]`)));
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    const flat = key.toLowerCase().replace(/[_\-\s]/g, '');
    if (PII_KEYS.has(flat)) found.push(`${path}.${key}`);
    found.push(...scanForbiddenKeys(child, `${path}.${key}`));
  }
  return found;
}

export function validateAuditInput(input) {
  const errors = [];
  if (!VALID_ACTIONS.has(input.action)) errors.push('invalid_action');
  if (!input.actor || !VALID_ACTORS.has(input.actor.type) || !input.actor.id) errors.push('actor_required');
  if (!VALID_RESULTS.has(input.result)) errors.push('invalid_result');
  if (!input.purpose?.code || !input.purpose?.version) errors.push('purpose_version_required');
  if (!input.legalBasis?.basis || !VALID_BASES.has(input.legalBasis.basis)) errors.push('legal_basis_required');
  if (!input.object?.type || !input.object?.ref) errors.push('object_ref_required');
  if (input.action === AUDIT_ACTION.HUMAN_OVERRIDE && !input.reasonCode) errors.push('human_override_reason_required');
  if ([AUDIT_ACTION.CONSENT_GRANTED, AUDIT_ACTION.CONSENT_WITHDRAWN, AUDIT_ACTION.CONSENT_VERSION_SEEN].includes(input.action)) {
    if (!input.policyRefs?.length) errors.push('consent_policy_reference_required');
  }
  const forbidden = scanForbiddenKeys(input.metadata || {});
  if (forbidden.length) errors.push(`raw_sensitive_fields_forbidden:${forbidden.join('|')}`);
  const sensitiveValues = scanSensitiveMetadataValues(input.metadata || {});
  if (sensitiveValues.length) errors.push(`raw_sensitive_values_forbidden:${sensitiveValues.join('|')}`);
  return { ok: errors.length === 0, errors };
}
