import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceMembershipAuthenticator} from '../src/service/auth/workspace-membership.js';

const principal=(tenantId='tenant-1',roles=['security_admin'])=>({
 id:'oidc|user-1',tenantId,roles,permissions:new Set(['policy.publish']),
 claims:{sub:'oidc|user-1',tenant_id:tenantId,roles}
});
const subject=(p=principal())=>({authenticate:async()=>p});
const directory=(roles=['reviewer'],status=true)=>({
 query:async(sql,args)=>{
  assert.match(sql,/m.status='active'/);
  assert.match(sql,/w.status='active'/);
  assert.deepEqual(args,[p.tenantId,p.id]);
  return {rows:status?[{roles}]:[]};
 }
});
let p;
test('workspace permissions come from a validated database membership, never OIDC roles',async()=>{
 p=principal();
 const auth=new WorkspaceMembershipAuthenticator({authenticator:subject(p),pool:directory(['reviewer'])});
 const actual=await auth.authenticate({headers:{}});
 assert.deepEqual(actual.roles,['reviewer']);
 assert.equal(actual.permissions.has('review.resolve'),true);
 assert.equal(actual.permissions.has('policy.publish'),false);
 assert.equal(actual.claims.sub,p.id);
});
test('unsigned client-selected workspace cannot override OIDC tenant',async()=>{
 p=principal('tenant-b');
 const auth=new WorkspaceMembershipAuthenticator({authenticator:subject(p),pool:directory(['auditor'])});
 const actual=await auth.authenticate({body:{tenantId:'tenant-a'},headers:{'x-dev-tenant':'tenant-a'}});
 assert.equal(actual.tenantId,'tenant-b');
 assert.deepEqual(actual.roles,['auditor']);
});
test('missing, disabled or suspended membership fails closed',async()=>{
 p=principal();
 const auth=new WorkspaceMembershipAuthenticator({authenticator:subject(p),pool:directory([],false)});
 await assert.rejects(()=>auth.authenticate({}),e=>e.statusCode===403);
});
test('role escalation and malformed directory rows are refused',async()=>{
 p=principal();
 for(const roles of [[],['root_owner'],['reviewer','reviewer'],['auditor','superadmin'],null]){
  const auth=new WorkspaceMembershipAuthenticator({authenticator:subject(p),pool:directory(roles)});
  await assert.rejects(()=>auth.authenticate({}),e=>e.statusCode===403);
 }
});
test('staging and localhost development identities cannot be used as SaaS accounts',async()=>{
 for(const claims of [{dev:true},{sandbox:true}]){
  p={...principal(),claims};
  const auth=new WorkspaceMembershipAuthenticator({authenticator:subject(p),pool:{
   query:async()=>{throw new Error('must not query membership for developer identity')}
  }});
  await assert.rejects(()=>auth.authenticate({}),e=>e.statusCode===403);
 }
});
test('unavailable membership database never falls back to token roles',async()=>{
 p=principal();
 const auth=new WorkspaceMembershipAuthenticator({authenticator:subject(p),pool:{
  query:async()=>{throw Error('db_unavailable')}
 }});
 await assert.rejects(()=>auth.authenticate({}),/db_unavailable/);
});
test('wiring requires both OIDC identity and a database lookup',()=>{
 assert.throws(()=>new WorkspaceMembershipAuthenticator({}),/workspace_auth_dependencies_required/);
});
