import test from 'node:test';
import assert from 'node:assert/strict';
import { ComplianceLedger } from '../src/compliance/ledger.js';
import { ACTOR_TYPE, AUDIT_ACTION, LEGAL_BASIS, RESULT } from '../src/compliance/event-catalog.js';
import { buildAuditBundle, signAuditBundle, verifyAuditBundle } from '../src/compliance/audit-bundle.js';
import { createSignedCheckpoint } from '../src/compliance/checkpoint.js';
import { generateSigningKeyPair } from '../src/compliance/crypto.js';

const purpose = { code: 'sales_intake', version: '1' };
const legalBasis = { basis: LEGAL_BASIS.TO_BE_DETERMINED };
const actor = { type: ACTOR_TYPE.SYSTEM, id: 'app' };
function append(ledger) {
  ledger.append({ actor, action: AUDIT_ACTION.INTAKE_RECEIVED, result: RESULT.SUCCESS, purpose, legalBasis, object: { type: 'sales_intake', ref: 'i1' }, dataClasses: ['audit_metadata'] });
}

test('signed portable audit bundle verifies', () => {
  const ledger = new ComplianceLedger(); append(ledger);
  const checkpointKeys = generateSigningKeyPair();
  const cp = createSignedCheckpoint(ledger.events, { keyId: 'checkpoint-key', privateKeyPem: checkpointKeys.privateKeyPem });
  const bundleKeys = generateSigningKeyPair();
  const bundle = signAuditBundle(buildAuditBundle({ ledger, checkpoints: [cp], publicKeys: { 'checkpoint-key': checkpointKeys.publicKeyPem }, processingActivity: { a: 1 }, policySnapshot: { p: 1 } }), { keyId: 'bundle-key', privateKeyPem: bundleKeys.privateKeyPem });
  assert.equal(bundle.integrity.ok, true);
  assert.equal(bundle.manifest.checkpointResults[0].ok, true);
  assert.equal(verifyAuditBundle(bundle, bundleKeys.publicKeyPem), true);
  bundle.events[0].action = 'tampered';
  assert.equal(verifyAuditBundle(bundle, bundleKeys.publicKeyPem), false);
});
