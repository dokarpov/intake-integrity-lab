#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { ComplianceLedger } from '../src/compliance/ledger.js';
import { MemoryLedgerStore } from '../src/compliance/storage/memory-store.js';

const file=process.argv[2];
if(!file){console.error('usage: node scripts/recovery-verify.mjs recovered-events.json');process.exit(2)}
const events=JSON.parse(readFileSync(file,'utf8'));
const ledger=new ComplianceLedger({store:new MemoryLedgerStore(events)});
const result=ledger.verifyIntegrity();
console.log(JSON.stringify({recoveryVerification:true,...result},null,2));
process.exit(result.ok?0:1);
