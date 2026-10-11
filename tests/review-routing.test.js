import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyReview, PRIORITY } from '../src/policy/review-routing.js';

describe('review-routing policy', () => {
  it('routes identity ambiguity to person P0', () => {
    const r = classifyReview({ reason: 'possible duplicate identity', clear: false, consequential: true });
    assert.equal(r.decider, 'person');
    assert.equal(r.priority, PRIORITY.P0);
    assert.equal(r.reasonCode, 'identity_ambiguity');
  });

  it('routes clear low-consequence to system', () => {
    const r = classifyReview({
      reason: 'validated lead',
      clear: true,
      consequential: false,
      reversible: true,
      deliveryTarget: 'crm'
    });
    assert.equal(r.decider, 'system');
    assert.equal(r.priority, null);
  });

  it('routes irreversible CRM delivery under ambiguity to P0', () => {
    const r = classifyReview({
      reason: 'field mapping uncertain',
      clear: false,
      consequential: true,
      reversible: false,
      deliveryTarget: '1c'
    });
    assert.equal(r.decider, 'person');
    assert.equal(r.priority, PRIORITY.P0);
  });

  it('routes privacy gates to P0', () => {
    const r = classifyReview({ reason: 'missing consent legal basis', clear: false });
    assert.equal(r.priority, PRIORITY.P0);
    assert.equal(r.reasonCode, 'privacy_gate');
  });
});
