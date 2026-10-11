/**
 * Deterministic in-memory implementation of the canonical atomic ledger store.
 * Production stores implement the same interface:
 *   atomicAppend(ledgerId, builder)
 *   all(ledgerId, options?)
 *   query(ledgerId, filters?)
 */
export class MemoryAtomicLedgerStore {
  constructor(events = []) {
    this.byLedger = new Map();
    this.tails = new Map();
    for (const event of events) {
      const id = event.ledgerId || 'default';
      const list = this.byLedger.get(id) || [];
      list.push(structuredClone(event));
      this.byLedger.set(id, list);
    }
  }

  _events(ledgerId) {
    if (!this.byLedger.has(ledgerId)) this.byLedger.set(ledgerId, []);
    return this.byLedger.get(ledgerId);
  }

  async atomicAppend(ledgerId, builder) {
    if (typeof ledgerId === 'function') {
      builder = ledgerId;
      ledgerId = 'default';
    }
    if (typeof builder !== 'function') throw new Error('atomic_append_builder_required');

    let release;
    const turn = new Promise(resolve => { release = resolve; });
    const previousTail = this.tails.get(ledgerId) || Promise.resolve();
    this.tails.set(ledgerId, turn);
    await previousTail;

    try {
      const events = this._events(ledgerId);
      const previous = events.at(-1) || null;
      const event = await builder({ previous: structuredClone(previous), sequence: previous ? previous.sequence + 1 : 1 });
      if (events.some(e => e.eventId === event.eventId)) throw new Error(`duplicate_event_id:${event.eventId}`);
      events.push(structuredClone(event));
      return structuredClone(event);
    } finally {
      release();
    }
  }

  async all(ledgerId = 'default', { afterSequence = 0, limit = Number.MAX_SAFE_INTEGER } = {}) {
    return this._events(ledgerId)
      .filter(e => e.sequence > afterSequence)
      .slice(0, limit)
      .map(x => structuredClone(x));
  }

  async query(ledgerId = 'default', { intakeId, subjectRef, action, result, afterSequence = 0, limit = 100 } = {}) {
    const ref = typeof subjectRef === 'string' ? subjectRef : subjectRef?.ref;
    return this._events(ledgerId)
      .filter(e => e.sequence > afterSequence)
      .filter(e => !intakeId || e.intakeId === intakeId)
      .filter(e => !ref || (typeof e.subjectRef === 'string' ? e.subjectRef : e.subjectRef?.ref) === ref)
      .filter(e => !action || e.action === action)
      .filter(e => !result || e.result === result)
      .slice(0, limit)
      .map(x => structuredClone(x));
  }
}
