import test from 'node:test';
import assert from 'node:assert/strict';
import { ComplianceLedger } from '../src/compliance/ledger.js';
import { ACTOR_TYPE, LEGAL_BASIS } from '../src/compliance/event-catalog.js';
import { recordDeliveryAttempt, recordDeliveryResult } from '../src/compliance/audited-delivery.js';

const ledger = () => new ComplianceLedger();
const actor = { type: ACTOR_TYPE.SERVICE, id: 'integration-worker' };
const purpose = { code: 'sales_intake', version: '1' };
const legalBasis = { basis: LEGAL_BASIS.TO_BE_DETERMINED };
const envelope = { intakeId: 'i1' };

test('1C delivery evidence stores digests, not request body', () => {
  const l = ledger();
  recordDeliveryAttempt(l, { envelope, request: { method: 'POST', url: 'https://1c.invalid/intake', body: { SecretField: 'do-not-copy' } }, actor, purpose, legalBasis });
  recordDeliveryResult(l, { envelope, actor, purpose, legalBasis, ok: true, statusCode: 201, externalRecordRef: 'opaque-1c-ref', responseBody: { id: 'opaque-1c-ref' } });
  const text = JSON.stringify(l.events);
  assert.equal(text.includes('do-not-copy'), false);
  assert.equal(l.events.length, 2);
  assert.equal(l.verifyIntegrity().ok, true);
});
