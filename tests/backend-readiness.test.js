import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { PostgresOutboxStore } from '../src/delivery/postgres-outbox-store.js';
import { createApiHandler } from '../src/service/app.js';

test('PostgreSQL outbox must never default an absent tenant to a shared tenant',async()=>{
  let writes=0;
  const pool={query:async()=>{writes++;return {rows:[]}}};
  const store=new PostgresOutboxStore({pool});
  for(const item of [
    {intakeId:'i1',destination:'1c',request:{}},
    {tenantId:'t1',destination:'1c',request:{}},
    {tenantId:'t1',intakeId:'i1',request:{}}
  ]) await assert.rejects(store.enqueue(item),/delivery_identity_required/);
  assert.equal(writes,0);
});

test('readyz fails when PostgreSQL cannot be queried and does not assert full CRM readiness',async()=>{
  const make=async(runtimes)=>{
    const handler=createApiHandler({authenticator:{authenticate:async()=>{throw new Error('should_not_authenticate')}},runtimes,policies:{}});
    const server=createServer(handler);
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try { const r=await fetch('http://127.0.0.1:'+server.address().port+'/readyz'); return {status:r.status,body:await r.json()}; }
    finally {await new Promise(resolve=>server.close(resolve));}
  };
  const failed=await make({mode:'postgres',pool:{query:async()=>{throw new Error('DB down')}}});
  assert.equal(failed.status,503);assert.equal(failed.body.ok,false);
  const good=await make({mode:'postgres',pool:{query:async()=>({rows:[{value:1}]})}});
  assert.equal(good.status,200);assert.equal(good.body.storage,'postgres');assert.equal(good.body.reviewDeliveryReady,false);
  const memory=await make({mode:'memory'});
  assert.equal(memory.status,200);assert.equal(memory.body.storage,'memory');assert.equal(memory.body.reviewDeliveryReady,false);
});
