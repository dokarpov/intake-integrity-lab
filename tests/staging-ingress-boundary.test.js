import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {errorBody} from '../src/service/http/io.js';

test('internal SQL/provider exception is never leaked through HTTP error code or message',()=>{
 const detail='relation private_customer_table does not exist: password=example-secret';
 const result=errorBody(Object.assign(new Error(detail),{statusCode:500,code:'23503'}),'req_secure_123');
 assert.deepEqual(result,{error:{code:'internal_error',message:'Internal server error',requestId:'req_secure_123'}});
 assert.doesNotMatch(JSON.stringify(result),/private_customer|secret|23503|password/);
});
test('HTTP 5xx always redacts even when error has no status',()=>{
 const result=errorBody(new Error('raw internal key'),'req_secure_456');
 assert.equal(result.error.code,'internal_error');
});
test('explicit 4xx errors retain stable diagnostics',()=>{
 const result=errorBody(Object.assign(new Error('workspace_membership_required'),
  {statusCode:403,code:'workspace_membership_required'}),'req_ok_123');
 assert.equal(result.error.code,'workspace_membership_required');
});
test('both public staging ingresses enforce the synthetic-only gate and block real worker startup',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 assert.match(read('service/server.mjs'),/if\(stagingWriteGate\(req,res\)\)return;/);
 assert.match(read('functions/intake-staging.mjs'),/if\(shouldBlockStagingWrite\(/);
 assert.match(read('service/delivery-worker.mjs'),/staging_real_provider_delivery_forbidden/);
});
