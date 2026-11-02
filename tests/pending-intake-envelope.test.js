import test from 'node:test';
import assert from 'node:assert/strict';
import { sealReviewEnvelope, unsealReviewEnvelope } from '../src/review/sealed-envelope.js';
import { MemoryPendingIntakeStore } from '../src/review/pending-intake-store.js';

const key=Buffer.alloc(32,0x23);
const tenantId='tenant-a',intakeId='intake-A';
const clock='2026-11-02T12:00:00Z',expiry='2026-11-03T12:00:00Z';
const envelope={intakeId,primaryContact:{name:'Synthetic Person',email:'private@example.invalid'},source:{channel:'web'},consents:{privacy:true,dataProcessing:true}};
function seal(){return sealReviewEnvelope(envelope,{key,tenantId,intakeId,expiresAt:expiry,now:clock})}

test('encrypted pending envelope decrypts only for correct tenant/intake, and stores no plaintext contact',()=>{
  const sealed=seal();
  assert.ok(!JSON.stringify(sealed).includes('Synthetic Person'));
  assert.ok(!JSON.stringify(sealed).includes('private@example.invalid'));
  assert.deepEqual(unsealReviewEnvelope(sealed,{key,tenantId,intakeId,now:clock}),envelope);
  assert.throws(()=>unsealReviewEnvelope(sealed,{key,tenantId:'tenant-b',intakeId,now:clock}),/authentication_failed/);
  assert.throws(()=>unsealReviewEnvelope(sealed,{key,tenantId,intakeId:'intake-B',now:clock}),/authentication_failed/);
  assert.throws(()=>unsealReviewEnvelope(sealed,{key,tenantId,intakeId,now:'2026-11-04T12:00:00Z'}),/expired/);
  assert.throws(()=>sealReviewEnvelope(envelope,{key:Buffer.alloc(4),tenantId,intakeId,expiresAt:expiry,now:clock}),/32_byte_key/);
});

test('authenticated ciphertext, expiry and tag tampering are rejected',()=>{
  const sealed=seal();
  for(const patch of [{tag:'invalid'},{expiresAt:'2026-11-04T12:00:00Z'},{ciphertext:'aGVsbG8'}]){
    assert.throws(()=>unsealReviewEnvelope({...sealed,...patch},{key,tenantId,intakeId,now:clock}));
  }
});

test('pending envelope store is tenant scoped, single-use and expires',async()=>{
  let now=clock;
  const store=new MemoryPendingIntakeStore({now:()=>now});
  await store.save({tenantId,intakeId,sealed:seal()});
  await assert.rejects(store.save({tenantId,intakeId,sealed:seal()}),/exists/);
  assert.equal(await store.get({tenantId:'tenant-b',intakeId}),null);
  assert.equal((await store.get({tenantId,intakeId})).sealed.v,1);
  assert.equal(await store.consume({tenantId,intakeId}),true);
  assert.equal(await store.consume({tenantId,intakeId}),false);
  assert.equal(await store.get({tenantId,intakeId}),null);
  now='2026-11-04T12:00:00Z';
  assert.equal(await store.purgeExpired(),1);
});
