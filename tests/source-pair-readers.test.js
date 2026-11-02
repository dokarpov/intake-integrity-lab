import test from 'node:test';
import assert from 'node:assert/strict';
import {bitrixCompanyPages,onecOdataPages,providerJson,approvedOrigin}
 from '../src/sales-integrity/provider-readers.js';
import {AwsSourceConnectionVault} from '../src/sales-integrity/source-sync-vault.js';
import {ReadOnlySourceSyncWorker} from '../src/sales-integrity/source-pair-sync.js';

const bitrixMapping={source:'bitrix24',version:'mapping-pilot-v1',idField:'ID',
 nameField:'TITLE',sharedKeyField:'UF_CRM_EXTERNAL_ID',ownerRefField:'ASSIGNED_BY_ID',
 statusField:'COMPANY_TYPE'};
const onecMapping={source:'1c',version:'mapping-pilot-v1',idField:'Ref_Key',
 nameField:'Description',sharedKeyField:'ExternalAccountKey'};
const bConfig={origin:'https://pilot.bitrix24.com/',allowHosts:['pilot.bitrix24.com'],
 accessToken:'private-bitrix-token'};
const cConfig={origin:'https://erp.example.com/',allowHosts:['erp.example.com'],
 entity:'Catalog_Counterparties',username:'readonly',password:'private-1c-password'};
const response=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers});
const consume=async iterable=>{const results=[];for await(const item of iterable)results.push(item);return results};
test('HTTPS provider destinations are fixed by trusted allowlists, never browser URLs',()=>{
 assert.equal(approvedOrigin('https://pilot.bitrix24.com/',['pilot.bitrix24.com']),
  'https://pilot.bitrix24.com');
 for(const bad of ['http://pilot.bitrix24.com/','https://127.0.0.1/',
  'https://10.0.0.1/','https://localhost/','https://pilot.bitrix24.com:8443/',
  'https://someone:pass@pilot.bitrix24.com/','https://pilot.bitrix24.com/x',
  'https://evil.example/']){
  assert.throws(()=>approvedOrigin(bad,['pilot.bitrix24.com']),
   /provider_origin_not_approved/,bad);
 }
});
test('Bitrix24 read-only traversal checks pagination, tokens and mapped provenance',async()=>{
 const calls=[];
 const page=(start)=>start===0?
   {result:Array.from({length:50},(_,i)=>({ID:String(i+1),TITLE:'Company '+i,
     UF_CRM_EXTERNAL_ID:'KEY-'+i,ASSIGNED_BY_ID:'1'})),next:50,total:51}:
   {result:[{ID:'51',TITLE:'Last',UF_CRM_EXTERNAL_ID:'KEY-50'}],total:51};
 const pages=await consume(bitrixCompanyPages({connection:bConfig,mapping:bitrixMapping,
  fetchFn:async(url,init)=>{
   calls.push({url,init});return response(page(init.body.includes('"start":50')?50:0));
  }}));
 assert.equal(pages.length,3);
 assert.equal(pages[0].rows.length,50);
 assert.equal(pages[1].rows[0].sourceRecordId,'51');
 assert.equal(pages[2].complete,true);
 assert.equal(pages[2].total,51);
 assert.equal(pages[0].rows[0].sharedKey,'KEY-0');
 assert.equal(pages[0].rows[0].counterpartyType,null);
 assert(calls.every(x=>x.init.method==='POST'));
 assert(calls.every(x=>x.url.endsWith('/rest/crm.company.list.json')));
 assert(calls.every(x=>!x.url.includes('private-bitrix-token')));
 assert(calls.every(x=>x.init.headers.authorization==='Bearer private-bitrix-token'));
});
test('Bitrix24 pagination repeats, incomplete totals and missing mandatory source fields fail closed',async()=>{
 for(const data of [{result:[{ID:'1',TITLE:'A'}],next:0,total:50},
  {result:[{ID:'1',TITLE:'A'}],total:3},
  {result:[{ID:'1'}],total:1}]){
  await assert.rejects(()=>consume(bitrixCompanyPages({connection:bConfig,
   mapping:bitrixMapping,fetchFn:async()=>response(data)})),
   /bitrix_pagination_loop|bitrix_inconsistent_full_scan|provider_required_mapping_missing/);
 }
});
test('1C OData3 GET traversal limits entity path and credentials to approved origin',async()=>{
 const requests=[];
 const data={d:{results:[{Ref_Key:'1',Description:'ООО Эксперимент',
  ExternalAccountKey:'EX-1'}]}};
 const pages=await consume(onecOdataPages({connection:cConfig,mapping:onecMapping,
  fetchFn:async(url,init)=>{requests.push({url,init});return response(data)}}));
 assert.equal(pages[0].rows[0].company,'ООО Эксперимент');
 assert.equal(pages[1].complete,true);
 assert.equal(pages[1].total,1);
 assert.equal(requests.length,1);
 const u=new URL(requests[0].url);
 assert.equal(u.pathname,'/odata/standard.odata/Catalog_Counterparties');
 assert.equal(u.searchParams.get('$top'),'100');
 assert.equal(requests[0].init.method,'GET');
 assert.match(requests[0].init.headers.authorization,/^Basic /);
 assert(!requests[0].url.includes('readonly'));
 assert(!requests[0].url.includes('private-1c-password'));
 await assert.rejects(()=>consume(onecOdataPages({connection:{...cConfig,entity:'../../Admin'},
  mapping:onecMapping,fetchFn:async()=>{throw Error('must not call')}})),
  /onec_entity_not_approved/);
});
test('Provider 401, 403, failed JSON and 429 retries never leak response text or tokens',async()=>{
 for(const [status,expected] of [[401,'provider_authentication_expired'],
  [403,'provider_permission_denied']]){
  await assert.rejects(()=>providerJson({url:'https://example.com',fetchFn:async()=>
   response({error:'sensitive-token-123'},status)}),new RegExp(expected));
 }
 let calls=0,sleeps=0;
 const success=await providerJson({url:'https://example.com',sleep:async()=>sleeps++,
  fetchFn:async()=>++calls===1?response({},429,{'retry-after':'0'}):response({result:[]})});
 assert.deepEqual(success,{result:[]});
 assert.equal(calls,2);assert.equal(sleeps,1);
 await assert.rejects(()=>providerJson({url:'https://example.com',
  fetchFn:async()=>response({},429),sleep:async()=>{}}),/provider_rate_limited/);
});
const vaultConfig=tenantId=>({tenantId,permissionGranted:true,
 purpose:'read_only_discrepancy_evidence',revoked:false,
 grantId:'11111111-1111-4111-8111-111111111111',mappingVersion:'mapping-pilot-v1',
 expiresAt:'2099-01-01T00:00:00Z',sources:{
 '1c':{connection:cConfig,mapping:onecMapping},
 bitrix24:{connection:bConfig,mapping:bitrixMapping}
}});
test('Tenant secret vault rejects expired/revoked/foreign grants and has fixed server-owned secret paths',async()=>{
 const tenant='22222222-2222-4222-8222-222222222222';let ids=[];
 const get=()=>new AwsSourceConnectionVault({client:{send:async command=>{
  ids.push(command.SecretId);return {SecretString:JSON.stringify(vaultConfig(tenant))};
 }},commandCtor:class{constructor(x){Object.assign(this,x)}}});
 assert.equal((await get().getApproved(tenant)).tenantId,tenant);
 assert.deepEqual(ids,['intake-integrity/source-sync/'+tenant+'/read-only-pair']);
 await assert.rejects(()=>get().getApproved('../other'),/source_vault_tenant_invalid/);
 const revoked=new AwsSourceConnectionVault({client:{send:async()=>({
  SecretString:JSON.stringify({...vaultConfig(tenant),permissionGranted:false})
 })},commandCtor:class{constructor(x){Object.assign(this,x)}}});
 await assert.rejects(()=>revoked.getApproved(tenant),/source_sync_grant_revoked/);
});
test('Worker checks vault on every page and aborts without publication after revocation',async()=>{
 const events=[];const tenant='22222222-2222-4222-8222-222222222222';
 let grants=0;
 const store={
  claim:async()=>({runId:'33333333-3333-4333-8333-333333333333',mappingVersion:'mapping-pilot-v1'}),
  stagePage:async x=>{events.push({stage:x.source});return{accepted:x.rows.length}},
  completeSource:async x=>events.push({complete:x.source}),
  publish:async()=>{events.push({publish:true})},
  fail:async x=>events.push({failed:x.error.code})
 };
 const vault={getApproved:async()=>{grants++;return {...vaultConfig(tenant),
  permissionGranted:grants<2}}};
 const reader=async(url,init)=>{
  if(url.includes('/rest/'))return response({result:[],total:0});
  return response({value:[{Ref_Key:'1',Description:'Pilot',
   ExternalAccountKey:'key'}]});
 };
 const w=new ReadOnlySourceSyncWorker({store,vault,fetchFn:reader});
 const result=await w.processOne({tenantId:tenant,workerId:'worker'});
 assert.equal(result.status,'failed');
 assert.equal(result.failureCode,'source_sync_grant_revoked');
 assert.equal(events.some(x=>x.publish),false);
 assert.equal(events.some(x=>x.failed==='source_sync_grant_revoked'),true);
});
