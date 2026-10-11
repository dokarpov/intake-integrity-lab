import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSalesEnvelope } from '../src/sales-envelope.js';
import { buildOneCHttpServiceRequest } from '../src/integrations/one-c/http-service.js';
import { buildOneCODataCreateRequest } from '../src/integrations/one-c/odata.js';

const envelope = buildSalesEnvelope({
  primaryContact: { name: 'Taylor Reed', phone: '+34 600 111 222', email: 'TAYLOR@EXAMPLE.TEST' },
  source: { channel: 'website' },
  sales: { productCode: 'PRO' },
  consents: { privacy: true, dataProcessing: true }
}, { intakeId: 'intake-42', now: () => '2026-10-02T12:00:00.000Z' });

test('1C HTTP request carries canonical idempotency key', () => {
  const req = buildOneCHttpServiceRequest(envelope, { baseUrl: 'https://1c.example.test/base/', path: '/hs/intake' });
  assert.equal(req.url, 'https://1c.example.test/base/hs/intake');
  assert.equal(req.headers['x-idempotency-key'], 'intake-42');
  assert.equal(req.body.primaryContact.email, 'taylor@example.test');
});

test('1C field map decouples canonical envelope from configuration fields', () => {
  const req = buildOneCHttpServiceRequest(envelope, {
    baseUrl: 'https://1c.example.test', path: '/hs/intake',
    fieldMap: { LeadName: 'primaryContact.name', Phone: 'primaryContact.phone', Product: 'sales.productCode' }
  });
  assert.deepEqual(req.body, { LeadName: 'Taylor Reed', Phone: '34600111222', Product: 'PRO' });
});

test('OData create request uses configured entity set, never a hard-coded schema', () => {
  const req = buildOneCODataCreateRequest(envelope, {
    baseUrl: 'https://1c.example.test/base', entitySet: 'Catalog_CustomLeads',
    fieldMap: { Description: 'primaryContact.name', ExternalIntakeId: 'intakeId' }
  });
  assert.equal(req.url, 'https://1c.example.test/base/odata/standard.odata/Catalog_CustomLeads');
  assert.deepEqual(req.body, { Description: 'Taylor Reed', ExternalIntakeId: 'intake-42' });
});
