import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createReadOnlyMcpHandler} from '../src/service/mcp/read-only.js';

const calls=[];
const RESOURCE='https://intake.example/mcp';
const comparison={
 comparisonId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',createdAt:'2026-11-02T11:00:00Z',
 policyVersion:'cross-source-v1',snapshots:{oneC:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',bitrix24:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},
 counts:{comparedPairs:1,fieldDifferences:1},
 observations:[{code:'field_difference',field:'counterpartyType',sharedKey:'customer-0123',sourceRecord1c:'1C-1',
 sourceRecordBitrix24:'B-1',value1c:'OOO',valueBitrix24:'IP'}]
};
const store={
 async latest(x){calls.push({op:'latest',...x});return {sources:[
  {source:'1c',snapshotId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',recordCount:3,
   createdAt:'2026-11-02T11:00:00Z',importKey:'private-on-disk-path'}]}},
 async latestComparison(x){calls.push({op:'latestComparison',...x});return comparison},
 async assessments(x){calls.push({op:'assessments',...x});return [
  {assessmentId:'x',actorRef:'auditor-1',assessment:'requires_verification',
   reason:'Human verification required',createdAt:'2026-11-02T11:00:00Z'}]}
};
function auth(){
 const blocked=new Set();
 return {
  blocked,
  async authenticate(req){
   const token=req.headers.authorization;
   if(!token?.startsWith('Bearer ')||token==='Bearer revoked'||blocked.has(token))
    throw Object.assign(new Error('unauthorized'),{statusCode:401});
   if(token==='Bearer dev')return {tenantId:'a',id:'dev',
    claims:{iss:'https://idp.example',aud:RESOURCE,scope:'evidence:read',dev:true},permissions:new Set(['review.read','audit.read'])};
   if(token==='Bearer no-review')return {tenantId:'a',id:'no-review',
    claims:{iss:'https://idp.example',aud:RESOURCE,scope:'evidence:read'},permissions:new Set(['audit.read'])};
   return {tenantId:token==='Bearer tenant-b'?'tenant-b':'tenant-a',
    id:token,claims:{iss:'https://idp.example',sub:token,email_verified:true,
     aud:token==='Bearer wrong-audience'?'https://wrong.example/mcp':RESOURCE,
     scope:token==='Bearer wrong-scope'?'user:read':
       token==='Bearer auditor'?'evidence:read evidence:values:read':'evidence:read'},
    permissions:new Set(token==='Bearer auditor'?['review.read','audit.read']:['review.read'])};
  }
 }
}
async function harness(run){
 const authenticator=auth();
 const handler=createReadOnlyMcpHandler({authenticator,sourceComparisonStore:store,resourceAudience:RESOURCE});
 const server=createServer(handler);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 let id=0;
 const post=async(method,params={},opts={})=>{
  const message=opts.notification
   ?{jsonrpc:'2.0',method,params}
   :{jsonrpc:'2.0',id:++id,method,params};
  const response=await fetch(base,{method:opts.verb||'POST',
   headers:{'content-type':'application/json','accept':'application/json',
    ...(opts.token===null?{}:{authorization:'Bearer '+(opts.token||'reviewer')}),
    ...(opts.origin?{origin:opts.origin}:{})},
   body:opts.verb==='GET'?undefined:JSON.stringify(message)});
  let json=null;if(response.status!==202)json=await response.json();
  return {status:response.status,json};
 };
 try{await run({post,authenticator})}finally{await new Promise(r=>server.close(r))}
}
const unwrap=message=>JSON.parse(message.json.result.content[0].text);
test('MCP handshake, list and stateless notification are protocol-compatible',async()=>{
 await harness(async({post})=>{
  const init=await post('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}});
  assert.equal(init.status,200);
  assert.equal(init.json.result.protocolVersion,'2025-11-25');
  assert.equal(init.json.result.serverInfo.name,'intake-integrity-readonly');
  assert.equal((await post('notifications/initialized',{}, {notification:true})).status,202);
  const list=await post('tools/list');
  assert.equal(list.json.result.tools.length,2);
  const auditorList=await post('tools/list',{}, {token:'auditor'});
  assert.equal(auditorList.json.result.tools.length,3);
  assert(list.json.result.tools.every(t=>t.annotations.readOnlyHint===true&&
   t.annotations.destructiveHint===false));
  assert.equal((await post('ping')).status,200);
 });
});
test('read-only tools do not accept caller-supplied tenant, actor, role or SQL',async()=>{
 calls.length=0;
 await harness(async({post})=>{
  for(const name of ['list_source_snapshots','get_latest_discrepancies','list_comparison_assessments']){
   const denied=await post('tools/call',{name,arguments:{tenantId:'other',actorId:'hacker',sql:'DELETE FROM sales_source_snapshots'}});
   assert.equal(denied.json.error.code,-32602);
  }
  const s=unwrap(await post('tools/call',{name:'list_source_snapshots',arguments:{}}, {token:'tenant-b'}));
  assert.equal(s.sources.length,1);
  assert.equal('importKey' in s.sources[0],false);
  const result=unwrap(await post('tools/call',{name:'get_latest_discrepancies',arguments:{}},{token:'tenant-b'}));
  assert.equal(result.status,'available');
  assert.equal(result.valuesIncluded,false);
  assert.deepEqual(result.observations,[{code:'field_difference',field:'counterpartyType'}]);
  assert(!JSON.stringify(result).includes('customer-0123'));
  assert(calls.every(c=>c.tenantId==='tenant-b'));
 });
});
test('raw source values and written human assessments require independent audit.read',async()=>{
 await harness(async({post})=>{
  const denied=await post('tools/call',{name:'get_latest_discrepancies',arguments:{includeValues:true}});
  assert.equal(denied.json.result.isError,true);
  assert(!JSON.stringify(denied.json).includes('OOO'));
  const read=unwrap(await post('tools/call',{name:'get_latest_discrepancies',arguments:{includeValues:true}},{token:'auditor'}));
  assert.equal(read.observations[0].value1c,'OOO');
  const assessment='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const forbidden=await post('tools/call',{name:'list_comparison_assessments',arguments:{comparisonId:assessment}});
  assert.equal(forbidden.json.result.isError,true);
  const allowed=unwrap(await post('tools/call',{name:'list_comparison_assessments',arguments:{comparisonId:assessment}},{token:'auditor'}));
  assert.equal(allowed.assessments.length,1);
 });
});
test('missing or revoked bearer, dev identity, non-reviewer and browser origins fail closed',async()=>{
 await harness(async({post,authenticator})=>{
  assert.equal((await post('tools/list',{}, {token:null})).status,401);
  assert.equal((await post('tools/list',{}, {token:'dev'})).status,403);
  assert.equal((await post('tools/list',{}, {token:'no-review'})).status,403);
  assert.equal((await post('tools/list',{}, {token:'wrong-audience'})).status,403);
  assert.equal((await post('tools/list',{}, {token:'wrong-scope'})).status,403);
  assert.equal((await post('tools/list',{}, {origin:'https://evil.example'})).status,403);
  authenticator.blocked.add('Bearer reviewer');
  assert.equal((await post('tools/list')).status,401);
 });
});
test('malformed RPC, arbitrary methods and dangerous write-tools are rejected without touching DB',async()=>{
 calls.length=0;
 await harness(async({post})=>{
  const write=await post('tools/call',{name:'create_crm_record',arguments:{source:'1c'}});
  assert.equal(write.json.error.code,-32602);
  const arbitrary=await post('DELETE /api/integrity/intakes');
  assert.equal(arbitrary.json.error.code,-32601);
  const invalid=await post('tools/call',{name:'get_latest_discrepancies',arguments:{includeValues:'true'}});
  assert.equal(invalid.json.error.code,-32602);
  assert.equal(calls.length,0);
 });
});
test('backend errors are redacted from MCP responses',async()=>{
 const broken=createReadOnlyMcpHandler({authenticator:auth(),
  sourceComparisonStore:{latestComparison:async()=>{throw Error('SQL password=internal-secret')}},resourceAudience:RESOURCE});
 const server=createServer(broken);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const response=await fetch('http://127.0.0.1:'+server.address().port,{method:'POST',
   headers:{authorization:'Bearer reviewer','content-type':'application/json'},
   body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',
    params:{name:'get_latest_discrepancies',arguments:{}}})});
  const output=await response.json();
  assert.equal(output.result.isError,true);
  assert.doesNotMatch(JSON.stringify(output),/SQL|password|internal-secret/);
 }finally{await new Promise(r=>server.close(r))}
});
