import test from 'node:test';
import assert from 'node:assert/strict';
import candidates from '../fixtures/candidates.json' with { type: 'json' };
import scenarios from '../fixtures/scenarios.json' with { type: 'json' };
import { IntakeSession, STATE } from '../src/intake-machine.js';

test('mandatory legal gate blocks identity check', () => {
  const session = new IntakeSession();
  const input = structuredClone(scenarios[0].input);
  input.consents.privacy = false;
  const result = session.check(input, candidates);
  assert.equal(result.ok, false);
  assert.equal(session.state, STATE.START);
});

test('marketing consent remains optional', () => {
  const session = new IntakeSession();
  const input = structuredClone(scenarios[0].input);
  input.consents.marketing = false;
  const result = session.check(input, candidates);
  assert.equal(result.ok, true);
});

test('multiple candidate choice requires explicit selection', () => {
  const session = new IntakeSession();
  const input = scenarios.find(x => x.id === 'multiple-family-records').input;
  session.check(input, candidates);
  assert.equal(session.state, STATE.CHOICE);
  assert.equal(session.canContinue(), false);
  session.chooseNew();
  assert.equal(session.canContinue(), true);
});

test('identity conflict is routed to manual review and cannot self-complete', () => {
  const session = new IntakeSession();
  const input = scenarios.find(x => x.id === 'one-parent-different-learner').input;
  session.check(input, candidates);
  assert.equal(session.state, STATE.REVIEW);
  assert.equal(session.canContinue(), false);
  assert.throws(() => session.chooseNew(), /new_case_choice_not_allowed/);
});

test('completion clears local personal data', () => {
  const session = new IntakeSession();
  const input = scenarios.find(x => x.id === 'one-consistent-match').input;
  session.check(input, candidates);
  session.complete();
  assert.equal(session.state, STATE.COMPLETE);
  assert.equal(session.local.input, null);
  assert.equal(session.local.result, null);
  assert.equal(session.local.selectedCandidateId, null);
});

test('error route cannot continue or create a record', () => {
  const session = new IntakeSession();
  const input = scenarios.find(x => x.id === 'no-match').input;
  session.check(input, candidates, { backendAvailable: false });
  assert.equal(session.state, STATE.ERROR);
  assert.equal(session.canContinue(), false);
  assert.throws(() => session.complete(), /cannot_complete/);
});
