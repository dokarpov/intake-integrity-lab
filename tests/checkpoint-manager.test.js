import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ComplianceLedger } from '../src/compliance/ledger.js';
import { CheckpointManager } from '../src/compliance/checkpoint-manager.js';
import { JsonlCheckpointStore } from '../src/compliance/storage/jsonl-checkpoint-store.js';
import { generateSigningKeyPair } from '../src/compliance/crypto.js';
import { ACTOR_TYPE, AUDIT_ACTION, LEGAL_BASIS, RESULT } from '../src/compliance/event-catalog.js';

const event = { actor: { type: ACTOR_TYPE.SYSTEM, id: 'app' }, action: AUDIT_ACTION.INTAKE_RECEIVED, result: RESULT.SUCCESS, purpose: { code: 'sales', version: '1' }, legalBasis: { basis: LEGAL_BASIS.CONTRACT }, object: { type: 'intake', ref: 'i' }, dataClasses: ['contact'], retention: { class: 'standard', expiresAt: '2027-10-02T00:00:00Z' } };

test('checkpoint manager persists non-overlapping signed seals', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cp-'));
  const ledger = new ComplianceLedger(); ledger.append(event);
  const keys = generateSigningKeyPair();
  const store = new JsonlCheckpointStore(join(dir, 'checkpoints.jsonl'));
  const manager = new CheckpointManager({ ledger, store, keyId: 'k1', privateKeyPem: keys.privateKeyPem, publicKeyPem: keys.publicKeyPem });
  const first = manager.seal();
  assert.equal(first.fromSequence, 1); assert.equal(first.toSequence, 1);
  ledger.append({ ...event, object: { type: 'intake', ref: 'i2' } });
  const second = manager.seal();
  assert.equal(second.fromSequence, 2); assert.equal(second.toSequence, 2);
  assert.deepEqual(manager.verifyAll().map(x => x.ok), [true, true]);
  rmSync(dir, { recursive: true, force: true });
});
