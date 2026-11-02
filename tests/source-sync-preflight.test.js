import test from 'node:test';
import assert from 'node:assert/strict';
import {assertSourceSyncDbRole} from '../src/sales-integrity/source-sync-preflight.js';
const names=['sales_source_sync_runs','sales_source_sync_staging',
 'sales_source_sync_pages','sales_source_sync_findings',
 'sales_source_snapshots','sales_source_records'];
const row=(name,role)=>({name,rls:true,owns_table:false,
 can_select:role==='worker'||['sales_source_sync_runs',
 'sales_source_sync_findings'].includes(name),
 can_insert:role==='worker'?name!=='sales_source_sync_runs':
  name==='sales_source_sync_runs',
 can_update:role==='worker'&&name==='sales_source_sync_runs',
 can_delete:false});
const fake=(role,overrides={})=>({query:async(sql)=>{
 if(sql.includes('SELECT rolsuper'))return{rows:[overrides.privileges||
  {rolsuper:false,rolbypassrls:false,rolcreaterole:false}]};
 return {rows:names.map(n=>n===overrides.name?{...row(n,role),...overrides.patch}:row(n,role))};
}});
test('API role can queue and read reports but never read staging PII or mutate evidence',async()=>{
 assert.deepEqual(await assertSourceSyncDbRole({pool:fake('api'),role:'api'}),
  {ok:true,role:'api',tenantRls:true});
 for(const patch of [{can_insert:true},{can_select:true},{can_update:true}]){
  await assert.rejects(()=>assertSourceSyncDbRole({
   pool:fake('api',{name:'sales_source_sync_staging',patch}),role:'api'}),
   /source_sync_api_db_grants_unsafe/);
 }
});
test('Worker role can stage and publish evidence but cannot self-enqueue or delete history',async()=>{
 assert.equal((await assertSourceSyncDbRole({pool:fake('worker'),role:'worker'})).ok,true);
 await assert.rejects(()=>assertSourceSyncDbRole({pool:fake('worker',{
  name:'sales_source_sync_runs',patch:{can_insert:true}}),role:'worker'}),
  /source_sync_worker_db_grants_unsafe/);
 await assert.rejects(()=>assertSourceSyncDbRole({pool:fake('worker',{
  name:'sales_source_sync_pages',patch:{can_insert:false}}),role:'worker'}),
  /source_sync_worker_db_grants_unsafe/);
});
test('Unrestricted roles, disabled RLS, schema owners and SQL failures always fail closed',async()=>{
 for(const role of ['api','worker']){
  for(const name of ['rolsuper','rolbypassrls','rolcreaterole'])
   await assert.rejects(()=>assertSourceSyncDbRole({role,pool:fake(role,{
    privileges:{rolsuper:false,rolbypassrls:false,rolcreaterole:false,[name]:true}
   })}),/source_sync_privileged_role_forbidden/);
  for(const patch of [{rls:false},{owns_table:true},{can_delete:true}])
   await assert.rejects(()=>assertSourceSyncDbRole({role,pool:fake(role,{
    name:'sales_source_records',patch})}),/source_sync_table_rls_unsafe/);
 }
 await assert.rejects(()=>assertSourceSyncDbRole({
  role:'api',pool:{query:async()=>{throw Error('SQL password=secret')}}}),
  /source_sync_preflight_unavailable/);
});
