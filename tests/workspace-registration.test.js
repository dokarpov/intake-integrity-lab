import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {WorkspaceBootstrap} from '../src/service/auth/workspace-bootstrap.js';
import {createWorkspaceRegistrationHandler} from '../src/service/auth/workspace-registration-http.js';
import {permissionsFor} from '../src/service/auth/rbac.js';

const verified={sub:'sub-123',iss:'https://login.example',email_verified:true};
function request({bearer='Bearer test',body={displayName:'Example Studio'},contentType='application/json'}={}){
 const req=Readable.from([Buffer.from(JSON.stringify(body))]);
 req.headers={'authorization':bearer,'content-type':contentType};
 req.socket={remoteAddress:'127.0.0.1'};
 return req;
}
async function invoke(handler,input){
 const res={status:0,headers:{},payload:'',
  writeHead(status,headers){this.status=status;this.headers=headers},
  end(body){this.payload=body}
 };
 await handler(request(input),res);
 return {status:res.status,body:JSON.parse(res.payload)};
}
test('workspace owner privileges do not grant customer-data access',()=>{
 const p=permissionsFor(['owner']);
 assert.equal(p.has('workspace.manage'),true);
 assert.equal(p.has('workspace.membership.manage'),true);
 assert.equal(p.has('audit.read'),false);
 assert.equal(p.has('review.resolve'),false);
 assert.equal(p.has('integration.retry'),false);
});
test('registration requires signed OIDC verification before any database call',async()=>{
 let called=0;
 const handler=createWorkspaceRegistrationHandler({
  verifier:{verify:async()=>{throw Error('jwt_signature_invalid')}},
  bootstrap:{registerVerifiedIdentity:async()=>{called++;return{}}},
 });
 const r=await invoke(handler);
 assert.equal(r.status,401);
 assert.equal(called,0);
});
test('registration accepts only workspace displayName and never a supplied tenant or role',async()=>{
 let recorded;
 const handler=createWorkspaceRegistrationHandler({
  verifier:{verify:async token=>{assert.equal(token,'test');return verified}},
  bootstrap:{registerVerifiedIdentity:async args=>{
   recorded=args;return{workspaceId:'server-generated',displayName:args.displayName,replayed:false};
  }}
 });
 const good=await invoke(handler);
 assert.equal(good.status,201);
 assert.equal(good.body.workspaceId,'server-generated');
 assert.deepEqual(recorded,{claims:verified,displayName:'Example Studio'});
 const bad=await invoke(handler,{body:{displayName:'Example',tenantId:'other',roles:['owner']}});
 assert.equal(bad.status,400);
});
test('registration replay returns 200 and does not assert duplicate creation',async()=>{
 const handler=createWorkspaceRegistrationHandler({
  verifier:{verify:async()=>verified},
  bootstrap:{registerVerifiedIdentity:async()=>({workspaceId:'original',displayName:'Initial',replayed:true})}
 });
 const result=await invoke(handler);
 assert.equal(result.status,200);
 assert.equal(result.body.workspaceId,'original');
});
test('unverified email never reaches the workspace database',async()=>{
 const bootstrap=new WorkspaceBootstrap({pool:{connect:async()=>{throw Error('unexpected database call')}}});
 await assert.rejects(()=>bootstrap.registerVerifiedIdentity({
  claims:{...verified,email_verified:false},displayName:'A Studio'
 }),e=>e.statusCode===403);
});
test('a registration backend requires both verifier and transactional storage',()=>{
 assert.throws(()=>new WorkspaceBootstrap(),/workspace_bootstrap_pool_required/);
 assert.throws(()=>createWorkspaceRegistrationHandler(),/workspace_registration_dependencies_required/);
});
