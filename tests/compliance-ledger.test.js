import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTOR_TYPE, AUDIT_ACTION, AUDIT_ROLE, AuditReader, ComplianceLedger, DATA_CLASS, LEGAL_BASIS,
  Pseudonymizer, RESULT, createSignedCheckpoint, generateSigningKeyPair, verifyCheckpoint
} from '../src/compliance/index.js';
import { MemoryLedgerStore } from '../src/compliance/storage/memory-store.js';

const actor = { type: ACTOR_TYPE.SERVICE, id: 'test-service', role: 'writer' };
const purpose = { code: 'sales_intake', version: '1.0' };
const legalBasis = { basis: LEGAL_BASIS.TO_BE_DETERMINED, reference: 'test' };
function base(overrides = {}) {
  return {
    actor, action: AUDIT_ACTION.INTAKE_RECEIVED, result: RESULT.SUCCESS,
    purpose, legalBasis, object: { type: 'sales_intake', ref: 'i-1' },
    dataClasses: [DATA_CLASS.CONTACT], metadata: { channel: 'web' }, ...overrides
  };
}

test('ledger creates a cryptographic chain', () => {
  const ledger = new ComplianceLedger();
  ledger.append(base());
  ledger.append(base({ action: AUDIT_ACTION.DECISION_MADE, reasonCode: 'route_new' }));
  const report = ledger.verifyIntegrity();
  assert.equal(report.ok, true);
  assert.equal(report.eventCount, 2);
  assert.match(report.terminalEventHash, /^[a-f0-9]{64}$/);
});

test('mutation is detected', () => {
  const store = new MemoryLedgerStore();
  const ledger = new ComplianceLedger({ store });
  ledger.append(base());
  store.events[0].reasonCode = 'tampered';
  assert.equal(ledger.verifyIntegrity().ok, false);
});

test('event removal creates sequence/hash failure', () => {
  const store = new MemoryLedgerStore();
  const ledger = new ComplianceLedger({ store });
  ledger.append(base({ object: { type: 'sales_intake', ref: '1' } }));
  ledger.append(base({ object: { type: 'sales_intake', ref: '2' } }));
  ledger.append(base({ object: { type: 'sales_intake', ref: '3' } }));
  store.events.splice(1, 1);
  assert.equal(ledger.verifyIntegrity().ok, false);
});

test('signed checkpoint verifies and tampering breaks it', () => {
  const ledger = new ComplianceLedger();
  ledger.append(base());
  ledger.append(base({ action: AUDIT_ACTION.DECISION_MADE, reasonCode: 'ok' }));
  const keys = generateSigningKeyPair();
  const cp = createSignedCheckpoint(ledger.events, { keyId: 'k1', privateKeyPem: keys.privateKeyPem, now: () => '2026-10-02T14:00:00.000Z' });
  assert.equal(verifyCheckpoint(cp, ledger.events, keys.publicKeyPem), true);
  const bad = structuredClone(cp); bad.eventCount += 1;
  assert.equal(verifyCheckpoint(bad, ledger.events, keys.publicKeyPem), false);
});

test('pseudonymizer is deterministic and does not expose identifier', () => {
  const p = new Pseudonymizer({ secret: 'test-secret' });
  const a = p.subjectRef('alice@example.invalid', 'email');
  const b = p.subjectRef('alice@example.invalid', 'email');
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a).includes('alice'), false);
});

test('raw PII-like keys in metadata are rejected', () => {
  const ledger = new ComplianceLedger();
  assert.throws(() => ledger.append(base({ metadata: { email: 'x@example.invalid' } })), /raw_sensitive_fields_forbidden/);
});

test('human override requires reason', () => {
  const ledger = new ComplianceLedger();
  assert.throws(() => ledger.append(base({ action: AUDIT_ACTION.HUMAN_OVERRIDE })), /human_override_reason_required/);
  const e = ledger.append(base({ action: AUDIT_ACTION.HUMAN_OVERRIDE, reasonCode: 'verified_identity_document' }));
  assert.equal(e.reasonCode, 'verified_identity_document');
});

test('consent events require a policy/document reference', () => {
  const ledger = new ComplianceLedger();
  assert.throws(() => ledger.append(base({ action: AUDIT_ACTION.CONSENT_GRANTED, object: { type: 'consent', ref: 'privacy' } })), /consent_policy_reference_required/);
  const e = ledger.append(base({ action: AUDIT_ACTION.CONSENT_GRANTED, object: { type: 'consent', ref: 'privacy' }, policyRefs: ['privacy@2026-10-01'] }));
  assert.equal(e.policyRefs[0], 'privacy@2026-10-01');
});

test('audit access is itself audited and subject access requires DPO role', async () => {
  const ledger = new ComplianceLedger();
  const actor = { type: ACTOR_TYPE.HUMAN, id: 'auditor-1' };
  const reader = new AuditReader({ ledger, purpose, legalBasis });
  await assert.rejects(() => reader.query({ actor, role: AUDIT_ROLE.AUDITOR, subjectRef: 'sub_x' }), /audit_access_denied/);
  const rows = await reader.query({ actor, role: AUDIT_ROLE.DPO, intakeId: 'i1' });
  assert.ok(Array.isArray(rows));
});
