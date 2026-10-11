import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACTOR_TYPE,
  AUDIT_ACTION,
  ComplianceLedger,
  DATA_CLASS,
  JsonlLedgerStore,
  LEGAL_BASIS,
  Pseudonymizer,
  RESULT,
  createSignedCheckpoint,
  generateSigningKeyPair
} from '../src/compliance/index.js';

const dir = '.tmp-ledger-demo';
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const ledger = new ComplianceLedger({
  tenantId: 'demo-tenant',
  store: new JsonlLedgerStore(join(dir, 'events.jsonl'))
});
const subjects = new Pseudonymizer({ secret: 'demo-only-secret-never-use-in-production' });
const subjectRef = subjects.subjectRef('synthetic@example.invalid', 'email');
const actor = { type: ACTOR_TYPE.SERVICE, id: 'sales-intake-api', role: 'writer' };
const purpose = { code: 'sales_intake', version: '1.0' };
const legalBasis = { basis: LEGAL_BASIS.TO_BE_DETERMINED, reference: 'configure-with-privacy-owner' };

ledger.append({
  intakeId: 'intake-demo-1', subjectRef, actor,
  action: AUDIT_ACTION.INTAKE_RECEIVED, result: RESULT.SUCCESS,
  purpose, legalBasis,
  object: { type: 'sales_intake', ref: 'intake-demo-1' },
  dataClasses: [DATA_CLASS.CONTACT, DATA_CLASS.SALES],
  metadata: { channel: 'web' }
});
ledger.append({
  intakeId: 'intake-demo-1', subjectRef, actor,
  action: AUDIT_ACTION.DECISION_MADE, result: RESULT.SUCCESS,
  reasonCode: 'dedup_disabled', purpose, legalBasis,
  object: { type: 'sales_intake', ref: 'intake-demo-1' },
  dataClasses: [DATA_CLASS.AUDIT_METADATA],
  metadata: { route: 'new' }
});

const keys = generateSigningKeyPair();
const checkpoint = createSignedCheckpoint(ledger.events, { keyId: 'demo-signing-key-1', privateKeyPem: keys.privateKeyPem });
console.log(JSON.stringify({ integrity: ledger.verifyIntegrity(), checkpoint, publicKeyPem: keys.publicKeyPem }, null, 2));
