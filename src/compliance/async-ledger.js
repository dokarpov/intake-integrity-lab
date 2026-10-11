import { canonicalize } from './canonical-json.js';
import { newId, sha256 } from './crypto.js';
import { RESULT, validateAuditInput } from './event-catalog.js';

/**
 * Canonical production ledger API. All material operations are async, even for
 * in-memory stores, so application code cannot accidentally bypass a rejected
 * Postgres/WORM write by forgetting to await it.
 */
export class AsyncComplianceLedger {
  constructor({
    tenantId = 'default',
    processingActivity = 'sales-intake',
    store,
    now = () => new Date().toISOString(),
    ledgerId = 'sales-intake-ledger-v2',
    strict = true,
    defaultRetention = null
  } = {}) {
    if (!store?.atomicAppend || !store?.all) throw new Error('atomic_ledger_store_required');
    Object.assign(this, { tenantId, processingActivity, store, now, ledgerId, strict, defaultRetention });
  }

  _validate(input) {
    const candidate = { ...input, retention: input.retention || this.defaultRetention };
    const validation = validateAuditInput(candidate);
    if (this.strict && candidate.legalBasis?.basis === 'to_be_determined') validation.errors.push('strict_mode_legal_basis_undetermined');
    if (this.strict && (candidate.dataClasses || []).some(x => x !== 'audit_metadata') && !candidate.retention?.class) validation.errors.push('strict_mode_retention_required');
    if (validation.errors.length) throw new Error(`invalid_audit_event:${validation.errors.join(',')}`);
    return candidate;
  }

  async append(input) {
    input = this._validate(input);
    return this.store.atomicAppend(this.ledgerId, async ({ previous, sequence }) => {
      const recordedAt = this.now();
      const event = {
        schemaVersion: '2.1',
        hashAlgorithm: 'SHA-256',
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
      return event;
    });
  }

  async events(options) {
    return this.store.all(this.ledgerId, options);
  }

  async query(filters = {}) {
    if (this.store.query) return this.store.query(this.ledgerId, filters);
    const events = await this.events({ afterSequence: filters.afterSequence || 0, limit: Number.MAX_SAFE_INTEGER });
    const ref = typeof filters.subjectRef === 'string' ? filters.subjectRef : filters.subjectRef?.ref;
    return events
      .filter(e => !filters.intakeId || e.intakeId === filters.intakeId)
      .filter(e => !ref || (typeof e.subjectRef === 'string' ? e.subjectRef : e.subjectRef?.ref) === ref)
      .filter(e => !filters.action || e.action === filters.action)
      .filter(e => !filters.result || e.result === filters.result)
      .slice(0, filters.limit || 100);
  }

  async forIntake(intakeId, options = {}) { return this.query({ ...options, intakeId }); }
  async forSubject(subjectRef, options = {}) { return this.query({ ...options, subjectRef }); }

  async verifyIntegrity() {
    const events = await this.events();
    let previousHash = null;
    let expectedSequence = 1;
    const errors = [];
    const ids = new Set();
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
    return { ok: errors.length === 0, errors, eventCount: events.length, terminalEventHash: events.at(-1)?.eventHash || null };
  }
}
