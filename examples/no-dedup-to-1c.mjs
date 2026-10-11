import { processSalesIntake, DEDUP_MODE } from '../src/pipeline.js';
import { DecisionHistory } from '../src/decision-history.js';
import { DeliveryLedger } from '../src/delivery-ledger.js';
import { buildOneCHttpServiceRequest } from '../src/integrations/one-c/http-service.js';

const history = new DecisionHistory();
const deliveries = new DeliveryLedger();

const result = processSalesIntake({
  primaryContact: { name: 'Taylor Reed', phone: '+34 600 111 222', email: 'taylor@example.test', company: 'Northwind' },
  source: { channel: 'website', campaign: 'spring-demo' },
  sales: { productCode: 'PRO', managerExternalId: 'mgr-42' },
  consents: { privacy: true, dataProcessing: true, marketing: false },
  notes: 'Asked for a demo next week.'
}, { dedupMode: DEDUP_MODE.OFF, history });

if (!result.deliverable) throw new Error('not_deliverable');
if (!deliveries.canDeliver(result.envelope.intakeId)) throw new Error('duplicate_delivery');

const request = buildOneCHttpServiceRequest(result.envelope, {
  baseUrl: 'https://1c.example.test/sales',
  path: '/hs/intake/v1/lead'
});

deliveries.record(result.envelope.intakeId, { target: '1c-http' });
console.log(JSON.stringify({ request, history: history.forIntake(result.envelope.intakeId) }, null, 2));
