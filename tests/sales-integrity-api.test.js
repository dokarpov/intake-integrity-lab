import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createApiHandler} from '../src/service/app.js';
import {Authenticator} from '../src/service/auth/authenticator.js';
import {TenantRuntimeRegistry} from '../src/service/runtime.js';
import {ServicePolicyRegistry} from '../src/service/policies.js';

const policy=x=>({purpose:{code:x,version:'1'},legalBasis:{basis:'not_applicable',reference:'test'},retention:{class:'short',policyVersion:'test'}});
const policies=new ServicePolicyRegistry({intake:policy('intake'),review:policy('review'),audit:policy('audit'),
  dsr:policy('dsr'),policy:policy('policy'),controls:policy('controls')});
async function withApi({store=null,verifier=null}={},fn){
 const called=[];
 const fake=store||null;
 const api=createApiHandler({
  authenticator:new Authenticator({mode:'dev'}),
  runtimes:new TenantRuntimeRegistry({mode:'memory',subjectHmacSecret:'dev-test-secret'}),
  policies,integrityStore:fake,integrityEvidenceVerifier:verifier
 });
 const server=createServer(api);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const call=(path,{user='reviewer-A',roles='reviewer,sales,auditor',method='GET',body,tenant='tenant-a'}={})=>
  fetch(base+path,{method,headers:{'content-type':'application/json','x-dev-user':user,
    'x-dev-roles':roles,'x-dev-tenant':tenant},
    body:body===undefined?undefined:JSON.stringify(body)});
 try{await fn({call,called})}finally{await new Promise(resolve=>server.close(resolve))}
}
const makeStore=events=>({
 async receiveEnquiry(x){events.push({method:'receive',x});return {intakeId:'intake-1',replayed:false}},
 async candidates(x){events.push({method:'candidates',x});return [{personId:'p1'}]},
 async history(x){events.push({method:'history',x});return {events:[],integrityOk:true}},
 async decideEnquiry(x){events.push({method:'decide',x});return {decisionId:'d1'}}
});

test('v2 is disabled by default, original API remains unaffected',async()=>{
 await withApi({},async({call})=>{
  const r=await call('/api/integrity/intakes',{roles:'sales',method:'POST',body:{}});
  assert.equal(r.status,404);
  assert.equal((await call('/api/me')).status,200);
 });
});
test('new intake derives tenant/actor from authenticated principal, not submitted JSON',async()=>{
 const events=[];
 await withApi({store:makeStore(events)},async({call})=>{
  const r=await call('/api/integrity/intakes',{user:'sales-verified',roles:'sales',method:'POST',
   tenant:'tenant-authenticated',body:{tenantId:'malicious-other-tenant',actorId:'forged-user',
     source:'web',sourceEventKey:'event-17'}});
  assert.equal(r.status,201);
  assert.equal(events[0].x.tenantId,'tenant-authenticated');
  assert.equal(events[0].x.actorId,'sales-verified');
 });
});
test('reviewer cannot read audit; salesperson cannot inspect candidates without review permission',async()=>{
 const events=[];
 await withApi({store:makeStore(events)},async({call})=>{
  assert.equal((await call('/api/integrity/intakes/i1/candidates',{roles:'sales'})).status,403);
  assert.equal((await call('/api/integrity/intakes/i1/history',{roles:'reviewer'})).status,403);
  assert.equal((await call('/api/integrity/intakes/i1/candidates',{roles:'reviewer'})).status,200);
  assert.equal((await call('/api/integrity/intakes/i1/history',{roles:'auditor'})).status,200);
 });
 assert.deepEqual(events.filter(x=>x.method!=='receive').map(x=>x.x.tenantId),['tenant-a','tenant-a']);
});
test('missing independent evidence verifier prevents any decision from being written',async()=>{
 const events=[];
 await withApi({store:makeStore(events)},async({call})=>{
  const r=await call('/api/integrity/intakes/i1/decisions',{roles:'reviewer',method:'POST',
   body:{action:'link_existing',personId:'p1',identityEvidenceRef:'unverified'}})
  assert.equal(r.status,503);
 });
 assert.equal(events.filter(x=>x.method==='decide').length,0);
});
test('only verified evidence and a permitted reviewer may resolve; principal overrides forged actor',async()=>{
 const events=[],seen=[];
 const verifier={verifyDecision:async context=>{
  seen.push(context);
  return context.identityEvidenceRef==='verified-evidence-1';
 }};
 await withApi({store:makeStore(events),verifier},async({call})=>{
  const denied=await call('/api/integrity/intakes/i1/decisions',{roles:'reviewer',method:'POST',
   body:{identityEvidenceRef:'user-text',action:'link_existing',personId:'p1'}});
  assert.equal(denied.status,403);
  assert.equal(events.length,0);
  const wrongRole=await call('/api/integrity/intakes/i1/decisions',{roles:'sales',method:'POST',
   body:{identityEvidenceRef:'verified-evidence-1',action:'link_existing',personId:'p1'}});
  assert.equal(wrongRole.status,403);
  const done=await call('/api/integrity/intakes/i1/decisions',{roles:'reviewer',method:'POST',
   user:'human-7',tenant:'tenant-safe',
   body:{identityEvidenceRef:'verified-evidence-1',action:'link_existing',personId:'p1',
     tenantId:'attacker-tenant',actorId:'attacker-actor',intakeId:'attacker-intake'}});
  assert.equal(done.status,200);
  assert.equal(events[0].x.tenantId,'tenant-safe');
  assert.equal(events[0].x.actorId,'human-7');
  assert.equal(events[0].x.intakeId,'i1');
  assert.equal(seen.at(-1).tenantId,'tenant-safe');
 });
});

test('staging read views are tenant-scoped and role-protected',async()=>{
 const events=[];
 const store={
   ...makeStore(events),
   async listIntakes(x){events.push({method:'listIntakes',x});return [{intakeId:'intake-a',state:'review_needed'}]},
   async listPeople(x){events.push({method:'listPeople',x});return [{personId:'person-a',name:'Customer'}]},
   async getIntake(x){events.push({method:'getIntake',x});return {intakeId:x.intakeId,source:'website'}},
   async outboxForIntake(x){events.push({method:'outboxForIntake',x});return [{state:'pending'}]}
 };
 await withApi({store},async({call})=>{
   const denied=await call('/api/integrity/intakes',{roles:'sales'});
   assert.equal(denied.status,403);
   const list=await call('/api/integrity/intakes?limit=15',{roles:'reviewer',tenant:'tenant-owner'});
   assert.equal(list.status,200);
   assert.equal((await list.json()).items[0].state,'review_needed');
   assert.equal((await call('/api/integrity/people',{roles:'reviewer',tenant:'tenant-owner'})).status,200);
   assert.equal((await call('/api/integrity/intakes/intake-a',{roles:'reviewer',tenant:'tenant-owner'})).status,200);
   assert.equal((await call('/api/integrity/intakes/intake-a/deliveries',{roles:'reviewer'})).status,403);
   assert.equal((await call('/api/integrity/intakes/intake-a/deliveries',{roles:'integration_admin',tenant:'tenant-owner'})).status,200);
 });
 assert.equal(events.filter(x=>x.x.tenantId==='tenant-owner').length,4);
 assert.deepEqual(events.filter(x=>x.tenantId && x.tenantId!=='tenant-owner'),[]);
 assert.deepEqual(events.find(x=>x.method==='listIntakes').x,{tenantId:'tenant-owner',limit:15});
});
test('integrity detail reports unknown intake as 404',async()=>{
 const store={...makeStore([]),getIntake:async()=>null};
 await withApi({store},async({call})=>{
   const r=await call('/api/integrity/intakes/unknown',{roles:'reviewer'});
   assert.equal(r.status,404);
 });
});

test('PostgreSQL SQLSTATE errors cannot leak internal syntax or schema through the API',async()=>{
 const store={async receiveEnquiry(){
  throw Object.assign(new Error('invalid input syntax for type uuid: private schema details'),
   {code:'22P02'});
 }};
 await withApi({store},async({call})=>{
  const r=await call('/api/integrity/intakes',{method:'POST',roles:'sales',
   body:{source:'fake',sourceEventKey:'simulated-error'}});
  assert.equal(r.status,500);
  const body=await r.json();
  assert.equal(body.error.code,'internal_error');
  assert.equal(body.error.message,'Internal server error');
  assert.doesNotMatch(JSON.stringify(body),/private schema|invalid input syntax|22P02/);
 });
});
