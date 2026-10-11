import { ComplianceLedger } from './compliance/ledger.js';
import { ACTOR_TYPE, AUDIT_ACTION, LEGAL_BASIS, RESULT } from './compliance/event-catalog.js';

/**
 * Backwards-compatible facade for v0.2 callers.
 * New code should use ComplianceLedger directly.
 */
export class DecisionHistory {
  constructor({ now = () => new Date().toISOString(), ledger } = {}) {
    this.ledger = ledger || new ComplianceLedger({ now });
  }

  append({ intakeId, type, actor = 'system', decision, reason, payloadRef }) {
    return this.ledger.append({
      intakeId,
      actor: { type: ACTOR_TYPE.SYSTEM, id: String(actor) },
      action: type === 'routing' ? AUDIT_ACTION.DECISION_MADE : AUDIT_ACTION.DATA_UPDATED,
      result: decision === 'blocked' ? RESULT.BLOCKED : RESULT.SUCCESS,
      reasonCode: reason || type,
      purpose: { code: 'sales_intake_operation', version: '1.0' },
      legalBasis: { basis: LEGAL_BASIS.TO_BE_DETERMINED, reference: 'configure-before-production' },
      object: { type: 'sales_intake', ref: intakeId || 'unknown' },
      dataClasses: ['audit_metadata'],
      metadata: { legacyType: type, legacyDecision: decision, payloadDigestOnly: payloadRef !== undefined }
    });
  }

  forIntake(intakeId) { return this.ledger.forIntake(intakeId); }
  verifyChain() { return this.ledger.verifyIntegrity().ok; }
  get events() { return this.ledger.store?.events || this.ledger.events; }
}
