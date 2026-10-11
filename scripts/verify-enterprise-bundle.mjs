#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const file=process.argv[2];
if(!file){console.error('usage: node scripts/verify-enterprise-bundle.mjs anchor-receipt.json');process.exit(2)}
const r=JSON.parse(readFileSync(file,'utf8'));const errors=[];
if(!r.checkpoint?.signature)errors.push('checkpoint_signature_missing');
if(!r.segmentSummary?.merkleRoot)errors.push('merkle_root_missing');
if(!r.archive?.quorumSatisfied)errors.push('immutable_archive_quorum_not_satisfied');
for(const x of r.archive?.receipts||[]){if(x.objectLockMode!=='COMPLIANCE'&&x.archiveKind!=='memory-worm-test')errors.push(`non_compliance_worm:${x.key}`);if(!x.checksumSHA256Base64)errors.push(`checksum_missing:${x.key}`)}
console.log(JSON.stringify({ok:errors.length===0,errors,receiptDigest:createHash('sha256').update(JSON.stringify(r)).digest('hex')},null,2));
process.exit(errors.length?1:0);
