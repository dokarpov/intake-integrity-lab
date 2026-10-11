import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComplianceLedger } from '../src/compliance/ledger.js';
import { JsonlLedgerStore } from '../src/compliance/storage/jsonl-store.js';
import { buildAuditBundle, signAuditBundle, writeAuditBundle } from '../src/compliance/audit-bundle.js';
import { generateSigningKeyPair } from '../src/compliance/crypto.js';

const [ledgerPath, outputDir] = process.argv.slice(2);
if (!ledgerPath || !outputDir) {
  console.error('Usage: node scripts/export-audit-bundle.mjs <events.jsonl> <output-dir>');
  process.exit(2);
}
const ledger = new ComplianceLedger({ store: new JsonlLedgerStore(resolve(ledgerPath)) });
const processingActivity = JSON.parse(readFileSync(new URL('../config/processing-activity.example.json', import.meta.url), 'utf8'));
const policySnapshot = JSON.parse(readFileSync(new URL('../config/compliance-policy.example.json', import.meta.url), 'utf8'));
const keys = generateSigningKeyPair();
const bundle = signAuditBundle(buildAuditBundle({ ledger, processingActivity, policySnapshot }), { keyId: 'ephemeral-export-key', privateKeyPem: keys.privateKeyPem });
writeAuditBundle(bundle, resolve(outputDir));
console.log(JSON.stringify({ outputDir: resolve(outputDir), publicKeyPem: keys.publicKeyPem, note: 'Demo uses an ephemeral export key. Production should use KMS/HSM.' }, null, 2));
