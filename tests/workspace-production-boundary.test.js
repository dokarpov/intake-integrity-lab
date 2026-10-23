import test from 'node:test';
import assert from 'node:assert/strict';
import {assertProductionWorkspaceBoundary} from '../src/service/auth/workspace-production-boundary.js';

const safe={superuser:false,bypass_rls:false,can_create_role:false,
 owns_directory:false,can_read:true,can_insert:false,can_update:false,
 can_delete:false,issuer_present:true,
 primary_key:'PRIMARY KEY (tenant_id, issuer, subject_id)'};
const pool=record=>({query:async(sql)=>{
 assert.match(sql,/to_regclass\('public\.intake_workspace_memberships'\)/);
 assert.match(sql,/pg_get_constraintdef/);
 return {rows:record?[record]:[]};
}});
test('production startup permits a read-only directory identity on issuer-bound schema',async()=>{
 const r=await assertProductionWorkspaceBoundary({pool:pool(safe)});
 assert.deepEqual(r,{ok:true,issuerBound:true,restrictedDirectoryRole:true});
});
test('production refuses owner, bypassrls, superuser and any membership mutation grant',async()=>{
 for(const property of ['superuser','bypass_rls','can_create_role','owns_directory',
  'can_insert','can_update','can_delete']){
  await assert.rejects(()=>assertProductionWorkspaceBoundary({
   pool:pool({...safe,[property]:true})
  }),/production_workspace_database_role_unsafe/,property);
 }
 await assert.rejects(()=>assertProductionWorkspaceBoundary({pool:pool({...safe,can_read:false})}),
  /production_workspace_database_role_unsafe/);
});
test('missing table, old primary key and nullable/missing issuer fail before serving traffic',async()=>{
 await assert.rejects(()=>assertProductionWorkspaceBoundary({pool:pool(null)}),
  /production_workspace_database_role_unsafe/);
 for(const row of [{...safe,issuer_present:false},
   {...safe,primary_key:'PRIMARY KEY (tenant_id, subject_id)'}]){
  await assert.rejects(()=>assertProductionWorkspaceBoundary({pool:pool(row)}),
   /production_workspace_issuer_migration_required/);
 }
});
test('missing database or SQL faults cannot bypass production startup check',async()=>{
 await assert.rejects(()=>assertProductionWorkspaceBoundary({}),/production_workspace_database_required/);
 await assert.rejects(()=>assertProductionWorkspaceBoundary({pool:{query:async()=>{
  throw new Error('sensitive database schema mismatch')
 }}}),/production_workspace_preflight_unavailable/);
});
