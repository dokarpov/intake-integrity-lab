import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createApiHandler} from '../src/service/app.js';
import {Authenticator} from '../src/service/auth/authenticator.js';
import {TenantRuntimeRegistry} from '../src/service/runtime.js';
import {ServicePolicyRegistry} from '../src/service/policies.js';
const p=code=>({purpose:{code,version:'1'},legalBasis:{basis:'not_applicable',reference:'synthetic'},
 retention:{class:'short',policyVersion:'test'}});
const policies=new ServicePolicyRegistry({intake:p('intake'),review:p('review'),audit:p('audit'),
 dsr:p('dsr'),policy:p('policy'),controls:p('controls')});
const run='11111111-1111-4111-8111-111111111111';
async function withApp(runTest){
 const history=[];
 const sourceSyncStore={
  enqueue:async x=>{history.push({event:'queue',...x});return {runId:run,status:'queued'}},
  status:async x=>{history.push({event:'status',...x});return {runId:run,status:'queued'}},
  latestReport:async x=>{history.push({event:'report',...x});return{
   runId:run,completedAt:'2026-11-02T12:00:00Z',
   snapshots:{oneC:'a',bitrix24:'b'},collectionQuality:'best_effort_full_scan',
   counts:{findings:1},note:'Evidence only'}},
  findings:async x=>{history.push({event:'findings',...x});return{items:[
   x.includeValues?{code:'field_difference',value_1c:'sensitive-value'}:
    {code:'field_difference',field:'company'}],more:false}}
 };
 const vault={getApproved:async tenantId=>{
  history.push({event:'vault',tenantId});return {mappingVersion:'mapping-pilot-v1'}
 }};
 const handler=createApiHandler({
  authenticator:new Authenticator({mode:'dev'}),
  runtimes:new TenantRuntimeRegistry({mode:'memory',subjectHmacSecret:'example-only-key'}),
  policies,integrityStore:{},sourceComparisonStore:{
   latestComparison:async()=>null,importSnapshot:async()=>{throw Error('should_never_write')}
  },sourceSyncStore,sourceSyncVault:vault
 });
 const server=createServer(handler);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const call=(path,{method='GET',roles='integration_admin,reviewer',tenant='tenant-A',body}={})=>
 fetch('http://127.0.0.1:'+server.address().port+path,{
  method,headers:{'content-type':'application/json','x-dev-user':'authorized-operator',
   'x-dev-tenant':tenant,'x-dev-roles':roles},
  body:body?JSON.stringify(body):undefined});
 try{await runTest({history,call})}finally{await new Promise(r=>server.close(r))}
}
test('authenticated owner queues server-vault-backed sync, never client-supplied tenant, URLs or roles',async()=>{
 await withApp(async({history,call})=>{
  const response=await call('/api/integrity/sources/sync',{method:'POST',roles:'owner',
   tenant:'real-authenticated-tenant',body:{tenantId:'attacker',url:'http://localhost/admin',
    mappingVersion:'forged',credentials:'plaintext'}});
  assert.equal(response.status,202);
  assert.equal((await response.json()).status,'queued');
  assert.deepEqual(history.filter(x=>x.event==='queue'),[{
   event:'queue',tenantId:'real-authenticated-tenant',actorRef:'authorized-operator',
   mappingVersion:'mapping-pilot-v1'}]);
  assert.deepEqual(history.filter(x=>x.event==='vault'),[{
   event:'vault',tenantId:'real-authenticated-tenant'}]);
 });
});
test('non-admin role cannot initiate external provider access or read queue',async()=>{
 await withApp(async({history,call})=>{
  assert.equal((await call('/api/integrity/sources/sync',{method:'POST',roles:'reviewer'})).status,403);
  assert.equal((await call('/api/integrity/sources/sync/status?runId='+run,{roles:'reviewer'})).status,403);
  assert.equal(history.length,0);
 });
});
test('production provider mode rejects manual client snapshots and browser-driven comparison',async()=>{
 await withApp(async({call})=>{
  assert.equal((await call('/api/integrity/sources/snapshots',{
   method:'POST',roles:'integration_admin',body:{source:'1c',rows:[{company:'fake'}]}})).status,403);
  assert.equal((await call('/api/integrity/sources/compare',{
   method:'POST',roles:'reviewer'})).status,403);
 });
});
test('source report is tenant-scoped and raw values are masked without audit permission',async()=>{
 await withApp(async({history,call})=>{
  assert.equal((await call('/api/integrity/sources/report/latest',{roles:'reviewer',tenant:'B'})).status,200);
  let result=await call('/api/integrity/sources/report/findings?runId='+run,{roles:'reviewer',tenant:'B'});
  assert.equal(result.status,200);
  assert.doesNotMatch(JSON.stringify(await result.json()),/sensitive-value/);
  result=await call('/api/integrity/sources/report/findings?runId='+run+'&includeValues=true',{roles:'reviewer'});
  assert.equal(result.status,403);
  result=await call('/api/integrity/sources/report/findings?runId='+run+'&includeValues=true',{roles:'reviewer,auditor'});
  assert.equal(result.status,200);
  assert.match(JSON.stringify(await result.json()),/sensitive-value/);
  assert(history.filter(x=>x.event==='findings').every(x=>x.tenantId==='B'||x.tenantId==='tenant-A'));
 });
});
