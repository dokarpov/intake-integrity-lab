import { resolve } from 'node:path';
import { ComplianceLedger } from '../src/compliance/ledger.js';
import { JsonlLedgerStore } from '../src/compliance/storage/jsonl-store.js';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node scripts/verify-ledger.mjs <events.jsonl>');
  process.exit(2);
}
const ledger = new ComplianceLedger({ store: new JsonlLedgerStore(resolve(path)) });
const report = ledger.verifyIntegrity();
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
