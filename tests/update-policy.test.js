import test from 'node:test';
import assert from 'node:assert/strict';
import { planRecordUpdate } from '../src/update-policy.js';

test('protected identity fields are not silently overwritten', () => {
  const existing = {
    learnerName: 'Sam Morgan',
    phone: '5550000101',
    notes: 'old'
  };
  const incoming = {
    learnerName: 'Taylor Morgan',
    phone: '5550009999',
    notes: 'new'
  };
  const plan = planRecordUpdate(existing, incoming);
  assert.equal(plan.safe.notes, 'new');
  assert.equal(plan.requiresReview, true);
  assert.deepEqual(Object.keys(plan.review).sort(), ['learnerName', 'phone']);
});
