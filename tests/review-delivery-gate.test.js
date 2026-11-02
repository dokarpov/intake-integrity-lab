import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Authenticator } from '../src/service/auth/authenticator.js';
import { ServicePolicyRegistry } from '../src/service/policies.js';
import { TenantRuntimeRegistry } from '../src/service/runtime.js';
import { createApiHandler } from '../src/service/app.js';

const policy = code => ({purpose:{code,version:'1'},legalBasis:{basis:'not_applicable',reference:'synthetic-test'},retention:{class:'short',policyVersion:'test'}});
const policies = new ServicePolicyRegistry({intake:policy('intake'),review:policy('review'),audit:policy('audit'),dsr:policy('dsr'),policy:policy('policy'),controls:policy('controls')});

async function harness(fn,{oneCConfig=null}={}) {
  const runtimes=new TenantRuntimeRegistry({mode:'memory',strictLedger:true,subjectHmacSecret:'test-only-secret'});
  const handler=createApiHandler({authenticator:new Authenticator({mode:'dev'}),runtimes,policies,oneCConfig});
  const server=createServer(handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const call=(path,body,role='reviewer',tenant='t1')=>fetch(base+path,{
    method:body===undefined?'GET':'POST',
    headers:{'content-type':'application/json','x-dev-user':'reviewer-1','x-dev-tenant':tenant,'x-dev-roles':role},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  try {await fn({runtimes,call,base});}
  finally {await new Promise(resolve=>server.close(resolve));}
}

test('capability report does not confuse configured connectors with verified delivery',async()=>{
  await harness(async({call})=>{
    let res=await call('/api/capabilities');assert.equal(res.status,200);
    let c=await res.json();assert.equal(c.product,'Acorde');assert.equal(c.reviewDelivery.available,false);
    assert.equal(c.crmDelivery.configured,false);assert.equal(c.crmDelivery.verified,false);
  },{oneCConfig:null});
  await harness(async({call})=>{
    const res=await call('/api/capabilities');
    const c=await res.json();
    assert.equal(c.crmDelivery.configured,true);
    assert.equal(c.crmDelivery.verified,false);
  },{oneCConfig:{baseUrl:'https://sandbox.invalid',path:'/intakes'}});
});

test('review create/link never reports resolved without durable handoff, even with connector configured',async()=>{
  await harness(async({call,runtimes})=>{
    const rt=runtimes.tenant('t1');
    const item=rt.reviews.enqueue({intakeId:'intake-review-test',reason:'ambiguous_identity',candidateRefs:['crm-1']});
    for (const body of [
      {decision:'create_new',note:'Unique identity verified'},
      {decision:'use_existing',targetRef:'crm-1',note:'Linked after verification'}
    ]) {
      const res=await call('/api/reviews/'+item.id+'/resolve',body);
      assert.equal(res.status,409);
      const response=await res.json();
      assert.equal(response.error.code,'review_delivery_unavailable');
      assert.equal(rt.reviews.get(item.id).status,'open');
      assert.equal((await rt.outbox.stats()).pending,0);
      assert.equal((await rt.ledger.events()).some(e=>e.action==='review.human_override'),false);
    }
    const wrong=await call('/api/reviews/'+item.id+'/resolve',{decision:'use_existing',targetRef:'crm-other',note:'fake'});
    assert.equal(wrong.status,400);
  },{oneCConfig:{baseUrl:'https://sandbox.invalid',path:'/intakes'}});
});

test('audited rejection does not enqueue delivery and requires explicit reason',async()=>{
  await harness(async({call,runtimes})=>{
    const rt=runtimes.tenant('t1');
    const item=rt.reviews.enqueue({intakeId:'intake-rejection-test',reason:'consent_mismatch',candidateRefs:['crm-2']});
    const bad=await call('/api/reviews/'+item.id+'/resolve',{decision:'reject',note:''});
    assert.equal(bad.status,400);
    assert.equal(rt.reviews.get(item.id).status,'open');
    const res=await call('/api/reviews/'+item.id+'/resolve',{decision:'reject',note:'Insufficient verified evidence'});
    assert.equal(res.status,200);
    assert.equal((await res.json()).resolution.decision,'reject');
    assert.equal(rt.reviews.get(item.id).status,'resolved');
    assert.equal((await rt.outbox.stats()).pending,0);
    assert.equal((await rt.ledger.events()).filter(e=>e.action==='review.human_override').length,1);
  });
});

test('cross-tenant review resolution is not allowed',async()=>{
  await harness(async({call,runtimes})=>{
    const item=runtimes.tenant('t1').reviews.enqueue({intakeId:'intake-secret',reason:'ambiguous_identity'});
    const response=await call('/api/reviews/'+item.id+'/resolve',{decision:'reject',note:'another tenant'},'reviewer','t2');
    assert.equal(response.status,404);
    assert.equal(runtimes.tenant('t1').reviews.get(item.id).status,'open');
  });
});
