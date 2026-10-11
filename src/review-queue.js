import { makeId } from './util.js';

export class ReviewQueue {
  constructor({ now = () => new Date().toISOString() } = {}) {
    this.now = now;
    this.items = new Map();
  }

  enqueue({ intakeId, reason, candidateRefs = [], context = {} }) {
    const id = makeId('review');
    const item = {
      id,
      intakeId,
      status: 'open',
      reason,
      candidateRefs: [...candidateRefs],
      context: { ...context },
      createdAt: this.now(),
      resolvedAt: null,
      resolution: null
    };
    this.items.set(id, item);
    return structuredClone(item);
  }

  list({ status = 'open' } = {}) {
    return [...this.items.values()]
      .filter(item => !status || item.status === status)
      .map(item => structuredClone(item));
  }

  resolve(id, { actor, decision, targetRef, note }) {
    const item = this.items.get(id);
    if (!item) throw new Error('review_item_not_found');
    if (item.status !== 'open') throw new Error('review_item_already_resolved');
    item.status = 'resolved';
    item.resolvedAt = this.now();
    item.resolution = { actor, decision, targetRef, note };
    return structuredClone(item);
  }
}
