import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PostgresSourcePairSync,ReadOnlySourceSyncWorker} from '../../src/sales-integrity/source-pair-sync.js';

const tenant=()=>'sync_'+randomUUID().replaceAll('-','');
const row=(id,sharedKey,company='Example Studio',type='OOO')=>({
 sourceRecordId:id,sharedKey,company,counterpartyType:type,contactRef:'owner-1',
 ownerRef:'mapped-owner',originalStatus:'provider-native',
 upstreamVersion:'upstream-rev-1',observedAt:'2026-11-02T10:00:00.000Z'
});
const m=file=>readFileSync(new URL('../../infra/postgres/migrations/'+file,import.meta.url),'utf8');
test('LIVE PostgreSQL >100-row paired source sync, atomic publication, review findings and A/B isolation',
 {skip:!process.env.TEST_DATABASE_URL},async t=>{
 const {Pool}=await import('pg');
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:12});
 const sync=new PostgresSourcePairSync({pool});
 try{
  await pool.query(m('005_source_comparison.sql'));
  await pool.query(m('011_source_pair_sync.sql'));
  await t.test('a 130-record provider scan publishes a pair only after both complete',async()=>{
   const a=tenant(),b=tenant();
   const queue=await sync.enqueue({tenantId:a,actorRef:'signed-in-admin',
    mappingVersion:'mapping-pilot-v1'});
   assert.equal(queue.status,'queued');
   assert.equal((await sync.enqueue({tenantId:a,actorRef:'signed-in-admin',
    mappingVersion:'mapping-pilot-v1'})).replayed,true);
   const claimed=await sync.claim({tenantId:a,workerId:'worker-a'});
   assert.equal(claimed.runId,queue.runId);
   const rows=Array.from({length:130},(_,i)=>row('one-'+i,'key-'+i));
   await sync.stagePage({tenantId:a,runId:queue.runId,workerId:'worker-a',
    source:'1c',pageIndex:0,rows:rows.slice(0,100)});
   await sync.stagePage({tenantId:a,runId:queue.runId,workerId:'worker-a',
    source:'1c',pageIndex:1,rows:rows.slice(100)});
   await sync.completeSource({tenantId:a,runId:queue.runId,workerId:'worker-a',
    source:'1c',expectedCount:130});
   assert.equal(await sync.latestReport({tenantId:a}),null);
   assert.equal(await sync.latestReport({tenantId:b}),null);
   await assert.rejects(()=>sync.publish({tenantId:a,runId:queue.runId,
    workerId:'worker-a'}),/sync_pair_not_fully_verified/);
   await sync.stagePage({tenantId:a,runId:queue.runId,workerId:'worker-a',
    source:'bitrix24',pageIndex:0,
    rows:[row('bit-0','key-0','Example Studio','IP'),row('bit-1','key-1')]});
   await sync.completeSource({tenantId:a,runId:queue.runId,workerId:'worker-a',
    source:'bitrix24',expectedCount:2});
   const released=await sync.publish({tenantId:a,runId:queue.runId,workerId:'worker-a'});
   assert.equal(released.status,'published');
   assert.equal(released.counts.onecRecords,130);
   assert.equal(released.counts.bitrix24Records,2);
   assert.equal(released.counts.field_difference,1);
   assert.equal(released.counts.missing_in_bitrix24,128);
   const report=await sync.latestReport({tenantId:a});
   assert.equal(report.runId,queue.runId);
   assert.equal(report.collectionQuality,'best_effort_full_scan');
   const first=await sync.findings({tenantId:a,runId:queue.runId,limit:50});
   assert.equal(first.items.length,50);
   assert.equal(first.more,true);
   assert.equal('shared_key' in first.items[0],false);
   const detail=await sync.findings({tenantId:a,runId:queue.runId,includeValues:true});
   assert.equal(detail.items.some(x=>x.code==='field_difference'&&x.value_1c==='OOO'&&
    x.value_bitrix24==='IP'),true);
   const second=await sync.findings({tenantId:a,runId:queue.runId,offset:100,limit:50});
   assert.equal(second.items.length,29);
   assert.equal((await sync.status({tenantId:a,runId:queue.runId})).status,'published');
   assert.equal(await sync.latestReport({tenantId:b}),null);
   await assert.rejects(()=>sync.findings({tenantId:b,runId:queue.runId}),
    /sync_published_report_not_found/);
   const snapshot=await pool.query('SELECT source,record_count FROM sales_source_snapshots WHERE tenant_id=$1',[a]);
   assert.deepEqual(snapshot.rows.map(x=>x.record_count).sort((x,y)=>x-y),[2,130]);
   await assert.rejects(()=>sync.stagePage({tenantId:a,runId:queue.runId,
    workerId:'worker-a',source:'1c',pageIndex:2,rows:[]}),/sync_lease_or_owner_invalid/);
  });
  await t.test('invalid and duplicate source pages cannot create published evidence',async()=>{
   const a=tenant();
   const q=await sync.enqueue({tenantId:a,actorRef:'admin',mappingVersion:'mapping-pilot-v1'});
   await sync.claim({tenantId:a,workerId:'worker'});
   await sync.stagePage({tenantId:a,runId:q.runId,workerId:'worker',
    source:'1c',pageIndex:0,rows:[row('same','k')]});
   await assert.rejects(()=>sync.stagePage({tenantId:a,runId:q.runId,
    workerId:'worker',source:'1c',pageIndex:1,rows:[row('same','different')]}),
    e=>e.code==='23505');
   const state=await sync.status({tenantId:a,runId:q.runId});
   assert.equal(state.progress.oneC,1);
   const failed=await sync.fail({tenantId:a,runId:q.runId,workerId:'worker',
    error:new Error('SQL password=customer-secret')});
   assert.equal(failed.failureCode,'source_sync_unavailable');
   assert.equal((await sync.status({tenantId:a,runId:q.runId})).status,'failed');
   assert.equal(await sync.latestReport({tenantId:a}),null);
   await assert.rejects(()=>sync.stagePage({tenantId:a,runId:q.runId,
    workerId:'worker',source:'1c',pageIndex:1,rows:[]}),/sync_lease_or_owner_invalid/);
  });
  await t.test('zero-record scan still publishes accurate empty evidence rather than a fake mismatch',async()=>{
   const a=tenant();
   const q=await sync.enqueue({tenantId:a,actorRef:'admin',mappingVersion:'mapping-pilot-v1'});
   await sync.claim({tenantId:a,workerId:'worker'});
   for(const source of ['1c','bitrix24']){
    await sync.stagePage({tenantId:a,runId:q.runId,workerId:'worker',
      source,pageIndex:0,rows:[]});
    await sync.completeSource({tenantId:a,runId:q.runId,workerId:'worker',
      source,expectedCount:0});
   }
   const result=await sync.publish({tenantId:a,runId:q.runId,workerId:'worker'});
   assert.equal(result.counts.findings,0);
   assert.equal(result.counts.onecRecords,0);
   assert.equal((await sync.findings({tenantId:a,runId:q.runId})).items.length,0);
  });
  await t.test('two queued requests for one tenant serialize, and staging ownership is enforced',async()=>{
   const a=tenant();
   const requests=await Promise.all(Array.from({length:5},()=>sync.enqueue({
    tenantId:a,actorRef:'admin',mappingVersion:'mapping-pilot-v1'})));
   assert.equal(new Set(requests.map(x=>x.runId)).size,1);
   const workerId='worker-1';
   const claimed=await sync.claim({tenantId:a,workerId});
   assert(claimed?.runId);
   assert.equal(await sync.claim({tenantId:a,workerId:'worker-2'}),null);
   await assert.rejects(()=>sync.stagePage({tenantId:a,runId:claimed.runId,
    workerId:'worker-2',source:'1c',pageIndex:0,rows:[row('x','y')]}),
    /sync_lease_or_owner_invalid/);
  });
  await t.test('durable worker reads BOTH real provider protocols and publishes only after success',async()=>{
   const a=tenant();
   const q=await sync.enqueue({tenantId:a,actorRef:'authorized-integrator',
    mappingVersion:'mapping-pilot-v1'});
   const cfg={permissionGranted:true,grantId:'11111111-1111-4111-8111-111111111111',
    mappingVersion:'mapping-pilot-v1',
    sources:{
     '1c':{connection:{origin:'https://erp.example.com/',allowHosts:['erp.example.com'],
      entity:'Catalog_Counterparties',username:'readonly',password:'fictional-secret'},
      mapping:{source:'1c',version:'mapping-pilot-v1',idField:'Ref_Key',
       nameField:'Description',sharedKeyField:'ExternalAccountKey'}},
     bitrix24:{connection:{origin:'https://pilot.bitrix24.com/',
      allowHosts:['pilot.bitrix24.com'],accessToken:'fictional-token'},
      mapping:{source:'bitrix24',version:'mapping-pilot-v1',idField:'ID',
       nameField:'TITLE',sharedKeyField:'UF_CRM_EXTERNAL_ID'}}
    }};
   const requests=[];
   const vault={getApproved:async()=>cfg};
   const runner=new ReadOnlySourceSyncWorker({store:sync,vault,fetchFn:async(url,options)=>{
    requests.push({url,method:options.method});
    if(url.includes('Catalog_Counterparties'))
     return new Response(JSON.stringify({value:[{
      Ref_Key:'1',Description:'Example Studio',ExternalAccountKey:'shared'}]}));
    if(url.includes('crm.company.list'))
     return new Response(JSON.stringify({result:[{
      ID:'3',TITLE:'Different Studio',UF_CRM_EXTERNAL_ID:'shared'}],total:1}));
    throw Error('Unexpected endpoint');
   }});
   const finished=await runner.processOne({tenantId:a,workerId:'worker-end-to-end'});
   assert.equal(finished.status,'published');
   assert.equal(finished.counts.field_difference,1);
   const report=await sync.latestReport({tenantId:a});
   assert.equal(report.counts.onecRecords,1);
   assert.equal(report.counts.bitrix24Records,1);
   assert.equal(requests.length,2);
   assert(requests.every(x=>x.method==='GET'||x.method==='POST'));
   assert(requests.every(x=>!x.url.includes('fictional-token')));
  });
  await t.test('second provider rejection cannot publish the first provider alone',async()=>{
   const a=tenant();
   await sync.enqueue({tenantId:a,actorRef:'authorized-integrator',
    mappingVersion:'mapping-pilot-v1'});
   const cfg={permissionGranted:true,grantId:'11111111-1111-4111-8111-111111111111',
    mappingVersion:'mapping-pilot-v1',sources:{
     '1c':{connection:{origin:'https://erp.example.com/',allowHosts:['erp.example.com'],
      entity:'Catalog_Counterparties',username:'readonly',password:'fictional-secret'},
      mapping:{source:'1c',version:'mapping-pilot-v1',idField:'Ref_Key',
       nameField:'Description',sharedKeyField:'ExternalAccountKey'}},
     bitrix24:{connection:{origin:'https://pilot.bitrix24.com/',
      allowHosts:['pilot.bitrix24.com'],accessToken:'fictional-token'},
      mapping:{source:'bitrix24',version:'mapping-pilot-v1',idField:'ID',
       nameField:'TITLE',sharedKeyField:'UF_CRM_EXTERNAL_ID'}}
    }};
   const runner=new ReadOnlySourceSyncWorker({store:sync,vault:{getApproved:async()=>cfg},
    fetchFn:async url=>url.includes('Catalog_')?
     new Response(JSON.stringify({value:[{Ref_Key:'1',Description:'Source A',
      ExternalAccountKey:'key'}]})):
     new Response(JSON.stringify({error:'ACCESS_DENIED'}),{status:403})});
   const result=await runner.processOne({tenantId:a,workerId:'worker-failure'});
   assert.equal(result.status,'failed');
   assert.equal(result.failureCode,'provider_permission_denied');
   assert.equal(await sync.latestReport({tenantId:a}),null);
  });
 }finally{await pool.end()}
});
