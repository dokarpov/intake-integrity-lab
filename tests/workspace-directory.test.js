import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {VerifiedWorkspaceDirectoryAuthenticator} from '../src/service/auth/workspace-directory.js';
import {createWorkspaceDirectoryHandler} from '../src/service/auth/workspace-directory-http.js';

const principal={iss:'https://idp.example',sub:'alice',email_verified:true,
 name:'Alice',roles:['security_admin'],tenant_id:'forged'};
const req=(extra={})=>({headers:{authorization:'Bearer valid',...extra}});
const deny=e=>e.statusCode===403;
const db=(memberships=[
 {tenant_id:'w-a',roles:['reviewer'],workspaceId:'w-a',displayName:'Alpha'},
 {tenant_id:'w-b',roles:['auditor'],workspaceId:'w-b',displayName:'Bravo'}
])=>({query:async(sql,params)=>{
 assert.equal(params[0],principal.iss);
 assert.equal(params[1],principal.sub);
 assert.match(sql,/m.issuer=\$1/);
 assert.match(sql,/m.status='active'/);
 assert.match(sql,/w.status='active'/);
 const matching=params.length===3?memberships.filter(x=>x.tenant_id===params[2]):memberships;
 return {rows:matching.slice(0,sql.includes('LIMIT 2')?2:101)};
}});
const auth=(pool=db(),claims=principal)=>new VerifiedWorkspaceDirectoryAuthenticator({
 verifier:{verify:async token=>{assert.equal(token,'valid');return claims}},
 pool
});

test('multiple authorized workspaces require explicit choice',async()=>{
 const directory=auth();
 await assert.rejects(()=>directory.authenticate(req()),e=>e.statusCode===409&&
  e.code==='workspace_selection_required');
 assert.equal((await directory.authenticate(req({'x-workspace-id':'w-a'}))).tenantId,'w-a');
 assert.equal((await directory.authenticate(req({'x-workspace-id':'w-b'}))).tenantId,'w-b');
});
test('OIDC tenant/role claims and unrelated client headers cannot escalate access',async()=>{
 const directory=auth();
 const a=await directory.authenticate(req({'x-workspace-id':'w-a','x-dev-tenant':'w-b'}));
 assert.deepEqual(a.roles,['reviewer']);
 assert.equal(a.permissions.has('review.resolve'),true);
 assert.equal(a.permissions.has('audit.export'),false);
 assert.equal(a.permissions.has('policy.publish'),false);
 assert.equal(a.tenantId,'w-a');
 await assert.rejects(()=>directory.authenticate(req({'x-workspace-id':'not-a-member'})),deny);
 await assert.rejects(()=>directory.authenticate(req({'x-workspace-id':['w-a','w-b']})),
  e=>e.statusCode===400);
});
test('one active workspace is automatically selected and zero memberships deny API',async()=>{
 const a=auth(db([ {tenant_id:'only',roles:['sales'],workspaceId:'only'} ]));
 const p=await a.authenticate(req());assert.equal(p.tenantId,'only');
 await assert.rejects(()=>auth(db([])).authenticate(req()),deny);
});
test('OIDC verification and verified email are mandatory',async()=>{
 const noToken=await auth().authenticate({headers:{}}).catch(e=>e);
 assert.equal(noToken.statusCode,401);
 for(const c of [{...principal,email_verified:false},{...principal,dev:true},
                  {...principal,sandbox:true},{...principal,sub:''},
                  {...principal,iss:'urn:intake:legacy:unverified'}]){
  await assert.rejects(()=>auth(db(),c).authenticate(req()),deny);
 }
 let queried=false;
 const invalid=new VerifiedWorkspaceDirectoryAuthenticator({
  verifier:{verify:async()=>{throw Error('invalid signature')}},
  pool:{query:async()=>{queried=true;throw Error('must_not_query')}}
 });
 await assert.rejects(()=>invalid.authenticate(req()),e=>e.statusCode===401);
 assert.equal(queried,false);
});
test('unknown and duplicate database roles are always denied',async()=>{
 for(const roles of [['root'],['owner','owner'],[],['reviewer','superuser'],null]){
  await assert.rejects(()=>auth(db([{tenant_id:'w-a',roles}]))
    .authenticate(req({'x-workspace-id':'w-a'})),deny);
 }
});
test('workspace list reveals only active memberships and not JWT claims',async()=>{
 const list=await auth().listForRequest(req());
 assert.deepEqual(list.map(x=>x.workspaceId),['w-a','w-b']);
 assert.deepEqual(list.map(x=>x.roles),[['reviewer'],['auditor']]);
});
test('workspace listing rejects missing credentials and returns 200 for signed membership',async()=>{
 const directory=auth();
 const handler=createWorkspaceDirectoryHandler({directory});
 async function run(authHeader){
  const req=Readable.from([]);
  req.headers=authHeader?{authorization:authHeader}:{};
  req.socket={remoteAddress:'127.0.0.1'};
  const res={headers:{},writeHead(n,h){this.status=n;this.headers=h},
   end(s){this.body=JSON.parse(s)}};
  await handler(req,res);
  return res;
 }
 const good=await run('Bearer valid');
 assert.equal(good.status,200);
 assert.equal(good.body.items.length,2);
 const bad=await run(null);
 assert.equal(bad.status,401);
});

test('workspace directory masks database diagnostics when a backend fails',async()=>{
 const handler=createWorkspaceDirectoryHandler({directory:{
  listForRequest:async()=>{throw Error('SQL: private schema tokens and customer data')}
 }});
 const r={headers:{},writeHead(n){this.status=n},end(s){this.body=JSON.parse(s)}};
 await handler({headers:{authorization:'Bearer valid'},socket:{remoteAddress:'127.0.0.1'}},r);
 assert.equal(r.status,500);
 assert.equal(r.body.error.code,'internal_error');
 assert.equal(r.body.error.message,'Internal server error');
 assert.doesNotMatch(JSON.stringify(r.body),/SQL|private schema|customer data/);
});
