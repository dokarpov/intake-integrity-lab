import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ComplianceLedger } from '../src/compliance/ledger.js';
import { JsonlLedgerStore } from '../src/compliance/storage/jsonl-store.js';
import { ACTOR_TYPE, AUDIT_ACTION, LEGAL_BASIS, RESULT } from '../src/compliance/event-catalog.js';

test('JSONL ledger survives process-style reopen and continues sequence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
  const path = join(dir, 'events.jsonl');
  const base = { actor: { type: ACTOR_TYPE.SYSTEM, id: 'app' }, action: AUDIT_ACTION.INTAKE_RECEIVED, result: RESULT.SUCCESS, purpose: { code: 'sales', version: '1' }, legalBasis: { basis: LEGAL_BASIS.TO_BE_DETERMINED }, object: { type: 'intake', ref: 'i' }, dataClasses: ['audit_metadata'] };
  const a = new ComplianceLedger({ store: new JsonlLedgerStore(path) }); a.append(base);
  const b = new ComplianceLedger({ store: new JsonlLedgerStore(path) }); b.append({ ...base, action: AUDIT_ACTION.DECISION_MADE, reasonCode: 'new' });
  assert.equal(b.events.length, 2);
  assert.equal(b.events[1].sequence, 2);
  assert.equal(b.verifyIntegrity().ok, true);
  rmSync(dir, { recursive: true, force: true });
});
