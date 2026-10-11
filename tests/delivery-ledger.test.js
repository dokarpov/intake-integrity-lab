import test from 'node:test';
import assert from 'node:assert/strict';
import { DeliveryLedger } from '../src/delivery-ledger.js';

test('delivery ledger blocks exact replay without pretending to be customer dedup', () => {
  const ledger = new DeliveryLedger();
  assert.equal(ledger.canDeliver('i-1'), true);
  ledger.record('i-1', { target: '1c' });
  assert.equal(ledger.canDeliver('i-1'), false);
  assert.throws(() => ledger.record('i-1'), /duplicate_delivery_blocked/);
  assert.equal(ledger.canDeliver('i-2'), true);
});
