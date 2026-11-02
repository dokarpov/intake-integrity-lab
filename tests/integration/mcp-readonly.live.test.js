import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PostgresSourceComparison} from '../../src/sales-integrity/source-comparison.js';
import {createReadOnlyMcpHandler} from '../../src/service/mcp/read-only.js';

const row=(id,type)=>({sourceRecordId:id,sharedKey:'fictional-shared-key',
 company:'Synthetic Studio',counterpartyType:type,contactRef:'synthetic-contact',
 ownerRef:'synthetic-owner',originalStatus:'Archived'});
test('LIVE Postgres MCP reads persisted evidence with strictly authenticated tenant scoping',
 {skip:!process.env.TEST_DATABASE_URL},async()=>{
 const {Pool}=await import('pg');
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:4});
 const suffix=randomUUID().replaceAll('-','');
 const a='mcp_a_'+suffix,b='mcp_b_'+suffix;
 const store=new PostgresSourceComparison({pool});
 let server;
 try{
  await pool.query(readFileSync(new URL('../../infra/postgres/migrations/005_source_comparison.sql',import.meta.url),'utf8'));
  await store.importSnapshot({tenantId:a,source:'1c',importKey:'synthetic-a-1c',actorRef:'ci',
   rows:[row('1c-a','OOO')]});
  await store.importSnapshot({tenantId:a,source:'bitrix24',importKey:'synthetic-a-bitrix',actorRef:'ci',
   rows:[row('bitrix-a','IP')]});
  const comparison=await store.compareLatest({tenantId:a,actorRef:'ci'});
  await store.assess({tenantId:a,comparisonId:comparison.comparisonId,assessmentKey:'human-review-1',
   actorRef:'synthetic-human',assessment:'requires_verification',
   reason:'Synthetic contract documents disagree, check authoritative registry.'});
  server=createServer(createReadOnlyMcpHandler({sourceComparisonStore:store,
   authenticator:{authenticate:async req=>{
    if(req.headers.authorization==='Bearer missing')throw Object.assign(new Error('revoked'),{statusCode:401});
    const owner=req.headers.authorization==='Bearer b'?b:a;
    return {id:'synthetic-verifier',tenantId:owner,
     claims:{iss:'https://verified.example',sub:'synthetic-user',email_verified:true},
     permissions:new Set(['review.read','audit.read'])};
   }}}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let requestId=0;
  const call=async(token,name,args={})=>{
   const response=await fetch('http://127.0.0.1:'+server.address().port,{
    method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:++requestId,method:'tools/call',
      params:{name,arguments:args}})});
   assert.equal(response.status,200);
   const data=await response.json();
   assert.equal(data.result.isError,false);
   return data.result.structuredContent;
  };
  const actual=await call('a','get_latest_discrepancies',{includeValues:true});
  assert.equal(actual.comparisonId,comparison.comparisonId);
  assert.equal(actual.counts.fieldDifferences,1);
  assert.equal(actual.observations[0].value1c,'OOO');
  assert.equal(actual.observations[0].valueBitrix24,'IP');
  const assessments=await call('a','list_comparison_assessments',{comparisonId:comparison.comparisonId});
  assert.equal(assessments.assessments.length,1);
  const crossTenant=await call('b','get_latest_discrepancies');
  assert.equal(crossTenant.status,'not_available');
  const crossAssessments=await call('b','list_comparison_assessments',{comparisonId:comparison.comparisonId});
  assert.deepEqual(crossAssessments.assessments,[]);
 }finally{
  if(server)await new Promise(r=>server.close(r));
  await pool.end();
 }
});
