import test from 'node:test';
import assert from 'node:assert/strict';
import candidates from '../fixtures/candidates.json' with { type: 'json' };
import scenarios from '../fixtures/scenarios.json' with { type: 'json' };
import { resolveIdentity } from '../src/matcher.js';
import { ROUTE } from '../src/model.js';

test('reference scenarios route as expected', () => {
  for (const scenario of scenarios) {
    const result = resolveIdentity(scenario.input, candidates);
    assert.equal(result.route, scenario.expectedRoute, scenario.id);
  }
});

test('backend failure never creates a new case', () => {
  const input = scenarios.find(x => x.id === 'no-match').input;
  const result = resolveIdentity(input, candidates, { backendAvailable: false });
  assert.equal(result.route, ROUTE.ERROR);
});

test('same phone with a different learner routes to review', () => {
  const input = {
    submitterName: 'Alex Morgan',
    phone: '5550000101',
    representativeName: 'Alex Morgan',
    learnerName: 'New Learner',
    city: 'Northport',
    consents: { privacy: true, dataProcessing: true, marketing: false }
  };
  const result = resolveIdentity(input, candidates);
  assert.equal(result.route, ROUTE.REVIEW);
});
