import { canonicalize } from './canonical-json.js';
import { newId, sha256 } from './crypto.js';
import { AUDIT_ACTION, RESULT, validateAuditInput } from './event-catalog.js';
import { MemoryLedgerStore } from './storage/memory-store.js';

export class ComplianceLedger {
  constructor({
    tenantId = 'default',
    processingActivity = 'sales-intake',
    store = new MemoryLedgerStore(),
    now = () => new Date().toISOString(),
    ledgerId = 'sales-intake-ledger-v1',
    strict = false,
    defaultRetention = null
  } = {}) {
    this.tenantId = tenantId;
    this.processingActivity = processingActivity;
    this.store = store;
    this.now = now;
    this.ledgerId = ledgerId;
    this.strict = strict;
    this.defaultRetention = defaultRetention;
  }

  get events() {
    return this.store.all();
  }

  append(input) {
    const candidate = { ...input, retention: input.retention || this.defaultRetention };
    const validation = validateAuditInput(candidate);
    if (this.strict && candidate.legalBasis?.basis === 'to_be_determined') validation.errors.push('strict_mode_legal_basis_undetermined');
    if (this.strict && (candidate.dataClasses || []).some(x => x !== 'audit_metadata') && !candidate.retention?.class) validation.errors.push('strict_mode_retention_required');
    validation.ok = validation.errors.length === 0;
    if (!validation.ok) throw new Error(`invalid_audit_event:${validation.errors.join(',')}`);
    input = candidate;

    const existing = this.events;
    if (input.eventId && existing.some(e => e.eventId === input.eventId)) throw new Error(`duplicate_event_id:${input.eventId}`);
    const previous = existing.at(-1) || null;
    const sequence = previous ? previous.sequence + 1 : 1;
    const recordedAt = this.now();
    const event = {
      schemaVersion: '1.0',
      ledgerId: this.ledgerId,
      tenantId: this.tenantId,
      processingActivity: input.processingActivity || this.processingActivity,
      eventId: input.eventId || newId('evt'),
      sequence,
      occurredAt: input.occurredAt || recordedAt,
      recordedAt,
      correlationId: input.correlationId,
      intakeId: input.intakeId,
      subjectRef: input.subjectRef,
      actor: structuredClone(input.actor),
      action: input.action,
      result: input.result || RESULT.SUCCESS,
      reasonCode: input.reasonCode,
      purpose: structuredClone(input.purpose),
      legalBasis: structuredClone(input.legalBasis),
      object: structuredClone(input.object),
      dataClasses: [...new Set(input.dataClasses || [])].sort(),
      fieldsChanged: input.fieldsChanged ? [...new Set(input.fieldsChanged)].sort() : undefined,
      beforeDigest: input.beforeDigest,
      afterDigest: input.afterDigest,
      recipient: input.recipient ? structuredClone(input.recipient) : undefined,
      retention: input.retention ? structuredClone(input.retention) : undefined,
      policyRefs: input.policyRefs ? [...input.policyRefs].sort() : [],
      evidenceRefs: input.evidenceRefs ? [...input.evidenceRefs].sort() : [],
      metadata: input.metadata ? structuredClone(input.metadata) : {},
      previousEventHash: previous?.eventHash || null
    };
    event.eventHash = sha256(canonicalize(event));
    this.store.append(Object.freeze(event));
    return structuredClone(event);
  }

  forIntake(intakeId) {
    return this.events.filter(e => e.intakeId === intakeId);
  }

  forSubject(subjectRef) {
    const ref = typeof subjectRef === 'string' ? subjectRef : subjectRef?.ref;
    return this.events.filter(e => (typeof e.subjectRef === 'string' ? e.subjectRef : e.subjectRef?.ref) === ref);
  }

  verifyIntegrity() {
    const events = this.events;
    const errors = [];
    const ids = new Set();
    let previousHash = null;
    let expectedSequence = 1;

    for (const event of events) {
      if (event.sequence !== expectedSequence) errors.push(`sequence_gap_at:${expectedSequence}`);
      if (ids.has(event.eventId)) errors.push(`duplicate_event_id:${event.eventId}`);
      ids.add(event.eventId);
      if (event.previousEventHash !== previousHash) errors.push(`previous_hash_mismatch:${event.sequence}`);
      const { eventHash, ...unsigned } = event;
      if (sha256(canonicalize(unsigned)) !== eventHash) errors.push(`event_hash_mismatch:${event.sequence}`);
      previousHash = eventHash;
      expectedSequence += 1;
    }

    return {
      ok: errors.length === 0,
      errors,
      eventCount: events.length,
      terminalEventHash: events.at(-1)?.eventHash || null
    };
  }

  recordIntegrityFailure({ actor, purpose, legalBasis, reasonCode, object = { type: 'ledger', ref: this.ledgerId } }) {
    return this.append({
      actor,
      action: AUDIT_ACTION.INTEGRITY_FAILURE,
      result: RESULT.FAILURE,
      reasonCode,
      purpose,
      legalBasis,
      object,
      dataClasses: ['audit_metadata']
    });
  }
}
