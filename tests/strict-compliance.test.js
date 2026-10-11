import test from 'node:test';
import assert from 'node:assert/strict';
import { ComplianceLedger } from '../src/compliance/ledger.js';
import { ACTOR_TYPE, AUDIT_ACTION, LEGAL_BASIS, RESULT } from '../src/compliance/event-catalog.js';

const base = { actor: { type: ACTOR_TYPE.SERVICE, id: 'api' }, action: AUDIT_ACTION.INTAKE_RECEIVED, result: RESULT.SUCCESS, purpose: { code: 'sales', version: '1' }, object: { type: 'intake', ref: 'i' }, dataClasses: ['contact'] };

test('strict mode rejects undetermined legal basis', () => {
  const ledger = new ComplianceLedger({ strict: true, defaultRetention: { class: 'standard' } });
  assert.throws(() => ledger.append({ ...base, legalBasis: { basis: LEGAL_BASIS.TO_BE_DETERMINED } }), /strict_mode_legal_basis_undetermined/);
});

test('strict mode requires retention classification for personal-data events', () => {
  const ledger = new ComplianceLedger({ strict: true });
  assert.throws(() => ledger.append({ ...base, legalBasis: { basis: LEGAL_BASIS.CONTRACT } }), /strict_mode_retention_required/);
});

test('strict mode accepts configured purpose, basis and retention', () => {
  const ledger = new ComplianceLedger({ strict: true, defaultRetention: { class: 'contractual', expiresAt: '2031-10-02T00:00:00Z' } });
  const event = ledger.append({ ...base, legalBasis: { basis: LEGAL_BASIS.CONTRACT, reference: 'terms-v3' } });
  assert.equal(event.retention.class, 'contractual');
  assert.equal(ledger.verifyIntegrity().ok, true);
});
