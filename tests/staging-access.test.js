import test from 'node:test';
import assert from 'node:assert/strict';
import {StagingAccessAuthenticator} from '../src/service/auth/staging-access.js';
const secret='staging-only-very-long-token-not-a-production-password';
const build=()=>new StagingAccessAuthenticator({token:secret});
test('hosted testing token grants only scoped sandbox operator permissions',async()=>{
 const before=process.env.NODE_ENV;
 try{
  process.env.NODE_ENV='staging';
  const a=build();
  const user=await a.authenticate({headers:{authorization:'Bearer '+secret}});
  assert.equal(user.tenantId,'staging-demo');
  assert.equal(user.permissions.has('review.resolve'),true);
  assert.equal(user.permissions.has('integration.test'),true);
  assert.equal(user.permissions.has('policy.publish'),false);
  await assert.rejects(()=>a.authenticate({headers:{authorization:'Bearer wrong'}}),/staging_access_denied/);
  await assert.rejects(()=>a.authenticate({headers:{authorization:'Bearer '+secret+'x'}}),/staging_access_denied/);
  await assert.rejects(()=>a.authenticate({headers:{}}),/staging_access_denied/);
 }finally{if(before===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=before}
});
test('staging passcode mode never starts in production',()=>{
 const before=process.env.NODE_ENV;
 try{
  process.env.NODE_ENV='production';
  assert.throws(()=>build(),/staging_access_forbidden_outside_staging/);
 }finally{if(before===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=before}
});
