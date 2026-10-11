import test from 'node:test';
import assert from 'node:assert/strict';
import { processSalesIntake, DEDUP_MODE } from '../src/pipeline.js';
import { ROUTE } from '../src/model.js';
import { ReviewQueue } from '../src/review-queue.js';
import { DecisionHistory } from '../src/decision-history.js';
import candidates from '../fixtures/candidates.json' with { type: 'json' };

function base() {
  return {
    primaryContact: { name: 'Taylor Reed', phone: '+34 600 111 222', email: 'taylor@example.test' },
    source: { channel: 'website' },
    consents: { privacy: true, dataProcessing: true, marketing: false }
  };
}

test('dedup off remains deliverable and does not require candidates', () => {
  const result = processSalesIntake(base(), { dedupMode: DEDUP_MODE.OFF });
  assert.equal(result.ok, true);
  assert.equal(result.resolution.route, ROUTE.NEW);
  assert.equal(result.resolution.reason, 'dedup_disabled');
  assert.equal(result.deliverable, true);
});

test('external dedup can route review without exposing matcher internals', () => {
  const queue = new ReviewQueue();
  const result = processSalesIntake(base(), {
    dedupMode: DEDUP_MODE.EXTERNAL,
    externalDecision: { route: ROUTE.REVIEW, reason: 'crm_ambiguous_match', candidates: [{ id: 'crm-1' }] },
    reviewQueue: queue
  });
  assert.equal(result.deliverable, false);
  assert.equal(queue.list().length, 1);
});

test('missing external decision fails closed', () => {
  const result = processSalesIntake(base(), { dedupMode: DEDUP_MODE.EXTERNAL });
  assert.equal(result.resolution.route, ROUTE.ERROR);
  assert.equal(result.deliverable, false);
});

test('local dedup can create review queue item and decision history', () => {
  const queue = new ReviewQueue();
  const history = new DecisionHistory({ now: () => '2026-10-02T12:00:00.000Z' });
  const input = base();
  input.primaryContact = { name: 'Alex Morgan', phone: '5550000101' };
  input.parties = [
    { role: 'authorized_representative', name: 'Alex Morgan' },
    { role: 'beneficiary', name: 'New Learner' }
  ];
  input.source.location = 'Northport';
  const result = processSalesIntake(input, { dedupMode: DEDUP_MODE.LOCAL, candidates, reviewQueue: queue, history });
  assert.equal(result.resolution.route, ROUTE.REVIEW);
  assert.equal(queue.list().length, 1);
  assert.equal(history.forIntake(result.envelope.intakeId).length, 2);
  assert.equal(history.verifyChain(), true);
});
