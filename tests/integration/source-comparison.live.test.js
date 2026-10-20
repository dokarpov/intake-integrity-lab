import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PostgresSourceComparison} from '../../src/sales-integrity/source-comparison.js';
const enabled=Boolean(process.env.TEST_DATABASE_URL);
const tenant=()=>'snap_'+randomUUID().replaceAll('-','');
const records=(prefix='')=>[
 {sourceRecordId:prefix+'1',sharedKey:'account-11',company:'North',counterpartyType:'OOO',contactRef:'p1',ownerRef:'seller1',originalStatus:'Active'},
 {sourceRecordId:prefix+'2',sharedKey:'account-22',company:'South',counterpartyType:'OOO',contactRef:'p2',ownerRef:'seller2',originalStatus:'Active'}
];
test('LIVE PostgreSQL immutable source snapshots, comparisons, human assessments and tenant isolation',{skip:!enabled},async t=>{
 const {Pool}=await import('pg');const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:8});
 const engine=new PostgresSourceComparison({pool});const sql=readFileSync(new URL('../../infra/postgres/migrations/005_source_comparison.sql',import.meta.url),'utf8');
 try{
  await pool.query(sql);
  await t.test('two imports are persistent, tenant-scoped and deterministic',async()=>{
   const scope=tenant();
   const one=await engine.importSnapshot({tenantId:scope,source:'1c',importKey:'export-1',actorRef:'admin',
    rows:records('1C-')});
   const bitrix=await engine.importSnapshot({tenantId:scope,source:'bitrix24',importKey:'export-2',actorRef:'admin',
    rows:records('B-').map((x,i)=>i?x:{...x,counterpartyType:'IP'})});
   assert.equal(one.recordCount,2);assert.equal(bitrix.recordCount,2);
   const again=await engine.importSnapshot({tenantId:scope,source:'1c',importKey:'export-1',actorRef:'admin',
    rows:records('1C-').reverse()});
   assert.equal(again.replayed,true);assert.equal(again.snapshotId,one.snapshotId);
   await assert.rejects(()=>engine.importSnapshot({tenantId:scope,source:'1c',importKey:'export-1',
    actorRef:'admin',rows:records('1C-').map(x=>({...x,company:'Tampered'}))}),/source_import_key_conflict/);
   const compared=await engine.compareLatest({tenantId:scope,actorRef:'reviewer'});
   assert.equal(compared.counts.fieldDifferences,1);assert.equal(compared.observations[0].field,'counterpartyType');
   const replay=await engine.compareLatest({tenantId:scope,actorRef:'reviewer'});
   assert.equal(replay.comparisonId,compared.comparisonId);assert.equal(replay.replayed,true);
   assert.equal((await engine.latestComparison({tenantId:scope})).comparisonId,compared.comparisonId);
   assert.equal(await engine.latestComparison({tenantId:tenant()}),null);
   assert.deepEqual((await engine.latest({tenantId:tenant()})).sources,[]);
   const assessment={tenantId:scope,comparisonId:compared.comparisonId,assessmentKey:'review-1',
     actorRef:'human.review',assessment:'requires_verification',reason:'Confirm actual legal entity type before applying 1C mapping.'};
   const saved=await engine.assess(assessment);
   assert.equal(saved.replayed,false);
   assert.equal((await engine.assess(assessment)).replayed,true);
   assert.equal((await engine.assessments({tenantId:scope,comparisonId:compared.comparisonId})).length,1);
   await assert.rejects(()=>engine.assess({...assessment,reason:'Override with conflicting value'}),/assessment_key_conflict/);
   assert.deepEqual(await engine.assessments({tenantId:tenant(),comparisonId:compared.comparisonId}),[]);
   await assert.rejects(()=>pool.query('DELETE FROM sales_source_assessments WHERE tenant_id=$1',[scope]),/append-only/);
  });
  await t.test('missing source prevents comparison, and failed input leaves no snapshot',async()=>{
   const scope=tenant();
   await engine.importSnapshot({tenantId:scope,source:'1c',importKey:'v1',actorRef:'admin',rows:records('1C-')});
   await assert.rejects(()=>engine.compareLatest({tenantId:scope,actorRef:'reviewer'}),/both_source_snapshots_required/);
   await assert.rejects(()=>engine.importSnapshot({tenantId:scope,source:'bitrix24',importKey:'v2',actorRef:'admin',
    rows:[records()[0],records()[0]]}),/duplicate_source_record_id/);
   assert.equal((await engine.latest({tenantId:scope})).sources.length,1);
  });
  await t.test('competing retries write one snapshot and one immutable comparison',async()=>{
   const scope=tenant();
   const calls=await Promise.all(Array.from({length:7},()=>engine.importSnapshot({
    tenantId:scope,source:'1c',importKey:'simultaneous',actorRef:'admin',rows:records('1C-')
   })));
   assert.equal(new Set(calls.map(x=>x.snapshotId)).size,1);
   await engine.importSnapshot({tenantId:scope,source:'bitrix24',importKey:'v2',actorRef:'admin',rows:records('B-')});
   const reports=await Promise.all(Array.from({length:5},()=>engine.compareLatest({tenantId:scope,actorRef:'reviewer'})));
   assert.equal(new Set(reports.map(x=>x.comparisonId)).size,1);
  });
 }finally{await pool.end()}
});
