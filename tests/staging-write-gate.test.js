import test from 'node:test';
import assert from 'node:assert/strict';
import {createStagingWriteGate,shouldBlockStagingWrite,allowIsolatedCiFixtureWrite} from '../src/service/http/staging-write-gate.js';

const staging={NODE_ENV:'staging',HOST:'0.0.0.0',STAGING_TOKEN_AUTH_ENABLED:'true'};
const isolated={NODE_ENV:'staging',HOST:'127.0.0.1',CI:'true',
 STAGING_FIXTURES:'true',STAGING_SYNTHETIC_TEST_WRITES:'true'};
const loopback='127.0.0.1';

test('shared-token staging denies all mutation verbs regardless of source, payload or path',()=>{
 for(const method of ['POST','PUT','PATCH','DELETE','PROPFIND','TRACE']){
  for(const path of ['/api/intakes','/api/integrity/intakes','/api/integrity/sources/snapshots',
   '/api/integrity/sources/assessments','/api/reviews/x/resolve','/api/integrity/sandbox/evidence',
   '/api/integrity/sandbox/crm/run','/api/workspaces/registration']){
   assert.equal(shouldBlockStagingWrite({env:staging,method,path,remoteAddress:loopback}),true,
    method+' '+path);
  }
 }
 for(const method of ['GET','HEAD','OPTIONS'])
  assert.equal(shouldBlockStagingWrite({env:staging,method}),false);
});
test('isolated CI is the only write bypass and no shared access token may coexist',()=>{
 assert.equal(allowIsolatedCiFixtureWrite(isolated,loopback),true);
 assert.equal(shouldBlockStagingWrite({env:isolated,method:'POST',remoteAddress:loopback}),false);
 for(const [key,value] of Object.entries({
  CI:'false',STAGING_FIXTURES:'false',STAGING_SYNTHETIC_TEST_WRITES:'false',
  HOST:'0.0.0.0',STAGING_TOKEN_AUTH_ENABLED:'true',NODE_ENV:'production'
 })){
  const env={...isolated,[key]:value};
  assert.equal(allowIsolatedCiFixtureWrite(env,loopback),false,key);
 }
 assert.equal(allowIsolatedCiFixtureWrite(isolated,'10.0.0.1'),false);
 assert.equal(allowIsolatedCiFixtureWrite(isolated,''),false);
 assert.equal(allowIsolatedCiFixtureWrite({NODE_ENV:'development'},loopback),false);
});
test('synthetic-only failure never consumes request body or touches downstream service',()=>{
 const gate=createStagingWriteGate({env:staging});
 const r={status:null,body:null,writeHead(s){this.status=s},end(value){this.body=JSON.parse(value)}};
 const req={method:'POST',url:'/api/integrity/sources/snapshots',
  headers:{'x-correlation-id':'example-request-1234'},socket:{remoteAddress:'203.0.113.5'}};
 assert.equal(gate(req,r),true);
 assert.equal(r.status,423);
 assert.equal(r.body.error.code,'staging_synthetic_only');
 assert.equal(r.body.error.requestId,'example-request-1234');
 assert.equal(r.body.error.message.includes('customer imports require'),true);
});
test('non-staging production behavior is unchanged by the containment gate',()=>{
 const env={NODE_ENV:'production'};
 assert.equal(shouldBlockStagingWrite({env,method:'POST'}),false);
 assert.equal(shouldBlockStagingWrite({env:{NODE_ENV:'development'},method:'POST'}),false);
});
