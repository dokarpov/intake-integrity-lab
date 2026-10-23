import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {VerifiedWorkspaceDirectoryAuthenticator} from '../../src/service/auth/workspace-directory.js';
import {assertProductionWorkspaceBoundary} from '../../src/service/auth/workspace-production-boundary.js';

const migration=file=>readFileSync(new URL('../../infra/postgres/migrations/'+file,import.meta.url),'utf8');
const verified={iss:'https://idp.test',sub:'directory-test-user',email_verified:true,roles:['owner'],tenant_id:'spoofed-tenant'};
const request=(workspaceId)=>({headers:{authorization:'Bearer test',...(workspaceId?{'x-workspace-id':workspaceId}:{})}});
const forbidden=e=>e.statusCode===403;

test('LIVE PostgreSQL only verified membership authorizes workspace selection; disabling is immediate',
 {skip:!process.env.TEST_DATABASE_URL},async()=>{
  const {Pool}=await import('pg');
  const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:4});
  const suffix=randomUUID().replaceAll('-','');
  const a='directory_a_'+suffix,b='directory_b_'+suffix,c='directory_c_'+suffix;
  const subject='directory_user_'+suffix;
  const claims={...verified,sub:subject};
  const role='dir_readonly_'+suffix.slice(0,18),password=randomUUID();
  let readonly;
  try{
   await admin.query(migration('006_workspace_memberships.sql'));
   await admin.query(migration('009_workspace_bootstrap.sql'));
   await admin.query(migration('010_membership_identity_issuer.sql'));
   for(const tenantId of [a,b,c])
    await admin.query('INSERT INTO intake_workspaces(tenant_id,display_name) VALUES($1,$2)',[tenantId,tenantId]);
   await admin.query('INSERT INTO intake_workspace_memberships(tenant_id,issuer,subject_id,roles) VALUES($1,$2,$3,$4::text[])',[a,claims.iss,subject,['reviewer']]);
   await admin.query('INSERT INTO intake_workspace_memberships(tenant_id,issuer,subject_id,roles) VALUES($1,$2,$3,$4::text[])',[b,claims.iss,subject,['auditor']]);
   await admin.query('CREATE ROLE '+role+" LOGIN PASSWORD '"+password+"'");
   await admin.query('GRANT USAGE ON SCHEMA public TO '+role);
   await admin.query('GRANT SELECT ON intake_workspaces,intake_workspace_memberships TO '+role);
   const uri=new URL(process.env.TEST_DATABASE_URL);uri.username=role;uri.password=password;
   readonly=new Pool({connectionString:uri.toString(),max:3});
   const prodProfile=await assertProductionWorkspaceBoundary({pool:readonly});
   assert.equal(prodProfile.issuerBound,true);
   await assert.rejects(()=>assertProductionWorkspaceBoundary({pool:admin}),
    /production_workspace_database_role_unsafe/);
   const directory=new VerifiedWorkspaceDirectoryAuthenticator({
    pool:readonly,
    verifier:{verify:async bearer=>{assert.equal(bearer,'test');return claims}}
   });
   assert.equal((await directory.listForRequest(request())).length,2);
   await assert.rejects(()=>directory.authenticate(request()),e=>e.statusCode===409);
   await assert.rejects(()=>directory.authenticate(request(c)),forbidden);
   assert.equal((await directory.authenticate(request(a))).roles[0],'reviewer');
   const anotherIssuerDirectory=new VerifiedWorkspaceDirectoryAuthenticator({pool:readonly,
    verifier:{verify:async()=>({...claims,iss:'https://other-issuer.test'})}});
   await assert.rejects(()=>anotherIssuerDirectory.authenticate(request(a)),forbidden);
   assert.deepEqual(await anotherIssuerDirectory.listForRequest(request()),[]);
   assert.equal((await directory.authenticate(request(b))).roles[0],'auditor');
   await admin.query('UPDATE intake_workspace_memberships SET status=$1 WHERE tenant_id=$2 AND subject_id=$3',['disabled',a,subject]);
   await assert.rejects(()=>directory.authenticate(request(a)),forbidden);
   assert.equal((await directory.authenticate(request())).tenantId,b);
   await admin.query('UPDATE intake_workspaces SET status=$1 WHERE tenant_id=$2',['suspended',b]);
   assert.deepEqual(await directory.listForRequest(request()),[]);
   await assert.rejects(()=>directory.authenticate(request(b)),forbidden);
   await assert.rejects(()=>readonly.query('UPDATE intake_workspace_memberships SET status=$1',['active']),e=>e.code==='42501');
   await assert.rejects(()=>readonly.query('INSERT INTO intake_workspaces(tenant_id,display_name) VALUES($1,$2)',[randomUUID(),'Injected']),e=>e.code==='42501');
  }finally{if(readonly)await readonly.end();await admin.end()}
 });
