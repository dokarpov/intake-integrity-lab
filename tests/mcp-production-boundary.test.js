import test from 'node:test';
import assert from 'node:assert/strict';
import {assertMcpReadOnlyDatabaseBoundary} from '../src/service/mcp/production-boundary.js';
const names=['sales_source_snapshots','sales_source_records','sales_source_comparisons','sales_source_assessments'];
const safe=()=>({rolsuper:false,rolbypassrls:false,rolcreaterole:false});
const row=name=>({name,rls:true,owns_table:false,can_select:true,
 can_insert:false,can_update:false,can_delete:false});
const fake=(role=safe(),tables=names.map(row))=>({
 query:async(sql)=>{
  if(sql.includes('SELECT rolsuper'))return {rows:[role]};
  if(sql.includes('FROM pg_class'))return {rows:tables};
  throw Error('Unexpected SQL');
 }
});
test('MCP dedicated read-only role must have tenant RLS across all four evidence tables',async()=>{
 const result=await assertMcpReadOnlyDatabaseBoundary({pool:fake()});
 assert.deepEqual(result,{ok:true,readOnly:true,tenantRls:true,tableCount:4});
});
test('MCP rejects privileged SQL roles and wrong table privileges',async()=>{
 for(const p of ['rolsuper','rolbypassrls','rolcreaterole'])
  await assert.rejects(()=>assertMcpReadOnlyDatabaseBoundary({
   pool:fake({...safe(),[p]:true})}),/mcp_database_privileged_role_forbidden/);
 for(const p of ['rls','owns_table','can_select','can_insert','can_update','can_delete']){
  const bad=row(names[0]);bad[p]=!bad[p];
  await assert.rejects(()=>assertMcpReadOnlyDatabaseBoundary({
   pool:fake(safe(),[bad,...names.slice(1).map(row)])}),/mcp_database_rls_or_grants_unsafe/);
 }
});
test('MCP rejects absent evidence tables and database failures',async()=>{
 await assert.rejects(()=>assertMcpReadOnlyDatabaseBoundary({pool:fake(safe(),names.slice(0,2).map(row))}),
  /mcp_database_rls_or_grants_unsafe/);
 await assert.rejects(()=>assertMcpReadOnlyDatabaseBoundary({}),
  /mcp_readonly_database_required/);
 await assert.rejects(()=>assertMcpReadOnlyDatabaseBoundary({pool:{query:async()=>{throw Error('database password secret')}}}),
  /mcp_database_preflight_unavailable/);
});
