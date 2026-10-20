import test from 'node:test';
import assert from 'node:assert/strict';
import {compareSourceRows,normalizeSnapshotRows} from '../src/sales-integrity/source-comparison.js';
const record=(sourceRecordId,sharedKey,overrides={})=>({
 sourceRecordId,sharedKey,company:'Studio North',
 counterpartyType:'OOO',contactRef:'contact-9',ownerRef:'owner-1',originalStatus:'Active',...overrides
});
test('mapped fields agree; different system-native statuses remain untouched and not compared',()=>{
 const r=compareSourceRows([record('1C-1','shared-1')],[record('B-1','shared-1',{originalStatus:'Won'})]);
 assert.equal(r.counts.comparedPairs,1);
 assert.equal(r.observations.length,0);
 assert.equal(r.policyVersion,'cross-source-v1');
});
test('detects legally meaningful company type change and exact field values without selecting authority',()=>{
 const r=compareSourceRows([record('1C-1','shared-1')],[record('B-1','shared-1',{counterpartyType:'IP',contactRef:'contact-7'})]);
 assert.deepEqual(r.observations.map(x=>x.field),['counterpartyType','contactRef']);
 assert.equal(r.observations[0].value1c,'OOO');
 assert.equal(r.observations[0].valueBitrix24,'IP');
 assert.equal(r.counts.fieldDifferences,2);
});
test('duplicate shared keys on one source remain ambiguous and are not chosen automatically',()=>{
 const r=compareSourceRows([record('1C-1','key')],[record('B-1','key'),record('B-2','key')]);
 assert.equal(r.counts.comparedPairs,0);
 assert.equal(r.observations[0].code,'ambiguous_shared_key');
 assert.deepEqual(r.observations[0].valueBitrix24,['B-1','B-2']);
});
test('unmatched and unmapped are explicit findings, never fuzzy name-match',()=>{
 const r=compareSourceRows([record('1C-1','key-one'),record('1C-2',null)],[record('B-1','key-two'),record('B-2',null)]);
 assert.equal(r.counts.unpairedRecords,2);assert.equal(r.counts.unmappedRecords,2);
 assert.equal(r.counts.comparedPairs,0);
 assert(r.observations.some(x=>x.code==='missing_in_1c'));
 assert(r.observations.some(x=>x.code==='missing_in_bitrix24'));
});
test('different versions with incomplete fields are uncertainty, not false positive equality',()=>{
 const r=compareSourceRows([record('1C-1','shared')],[record('B-1','shared',{contactRef:null})]);
 assert.equal(r.counts.missingFieldEvidence,1);
 assert.equal(r.observations[0].code,'field_not_comparable');
});
test('duplicate record IDs, empty input, oversize batches and invalid field types are rejected',()=>{
 assert.throws(()=>normalizeSnapshotRows([]),/snapshot_requires/);
 assert.throws(()=>normalizeSnapshotRows(Array.from({length:101},(_,i)=>record(String(i),'a'))),/snapshot_requires/);
 assert.throws(()=>normalizeSnapshotRows([record('1','a'),record('1','b')]),/duplicate_source_record_id/);
 assert.throws(()=>normalizeSnapshotRows([record('1','a',{company:5})]),/invalid_company/);
});
