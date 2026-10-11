import test from 'node:test';
import assert from 'node:assert/strict';
import { ReviewQueue } from '../src/review-queue.js';
import { DecisionHistory } from '../src/decision-history.js';

const now = () => '2026-10-02T12:00:00.000Z';

test('review queue is explicit and one-shot resolvable', () => {
  const q = new ReviewQueue({ now });
  const item = q.enqueue({ intakeId: 'i-1', reason: 'identity_conflict', candidateRefs: ['c-1'] });
  assert.equal(q.list().length, 1);
  const resolved = q.resolve(item.id, { actor: 'sales-ops', decision: 'use_existing', targetRef: 'c-1' });
  assert.equal(resolved.status, 'resolved');
  assert.equal(q.list().length, 0);
  assert.throws(() => q.resolve(item.id, { actor: 'sales-ops', decision: 'new' }), /already_resolved/);
});

test('decision history is hash-linked and tamper-detectable', () => {
  const h = new DecisionHistory({ now });
  h.append({ intakeId: 'i-1', type: 'routing', decision: 'review', reason: 'conflict' });
  h.append({ intakeId: 'i-1', type: 'human', actor: 'ops', decision: 'use_existing', reason: 'verified' });
  assert.equal(h.verifyChain(), true);
  h.events[0] = { ...h.events[0], decision: 'new' };
  assert.equal(h.verifyChain(), false);
});
