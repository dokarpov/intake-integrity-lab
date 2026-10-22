import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {WorkspaceBootstrap} from '../../src/service/auth/workspace-bootstrap.js';

const migration=file=>readFileSync(new URL('../../infra/postgres/migrations/'+file,import.meta.url),'utf8');
const ident=(suffix)=>({
 iss:'https://verified-idp.example',sub:'user_'+suffix,email_verified:true
});

test('LIVE PostgreSQL workspace bootstrap enforces replay, identity ownership and cancellation',
 {skip:!process.env.TEST_DATABASE_URL},async()=>{
  const {Pool}=await import('pg');
  const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:8});
  const unique=randomUUID().replaceAll('-',''),first=ident(unique),other=ident('another_'+unique);
  try{
   await pool.query(migration('006_workspace_memberships.sql'));
   await pool.query(migration('009_workspace_bootstrap.sql'));
   const bootstrap=new WorkspaceBootstrap({pool});
   await assert.rejects(()=>bootstrap.registerVerifiedIdentity({
    claims:{...first,email_verified:false},displayName:'Example Studio'
   }),e=>e.statusCode===403);
   const attempts=await Promise.all(Array.from({length:6},()=>bootstrap.registerVerifiedIdentity({
    claims:first,displayName:'Example Studio'
   })));
   assert.equal(new Set(attempts.map(x=>x.workspaceId)).size,1);
   assert.equal(attempts.filter(x=>x.replayed===false).length,1);
   const workspaceId=attempts[0].workspaceId;
   const replay=await bootstrap.registerVerifiedIdentity({
    claims:first,displayName:'Changed Name'
   });
   assert.equal(replay.workspaceId,workspaceId);
   assert.equal(replay.displayName,'Example Studio');
   assert.equal(replay.replayed,true);
   const owner=await pool.query(`SELECT w.tenant_id,w.display_name,m.subject_id,m.roles
    FROM intake_workspaces w JOIN intake_workspace_memberships m
    ON m.tenant_id=w.tenant_id WHERE w.tenant_id=$1`,[workspaceId]);
   assert.equal(owner.rows.length,1);
   assert.deepEqual(owner.rows[0].roles,['owner']);
   assert.equal(owner.rows[0].subject_id,first.sub);
   const second=await bootstrap.registerVerifiedIdentity({claims:other,displayName:'Other Company'});
   assert.notEqual(second.workspaceId,workspaceId);
   const count=await pool.query(`SELECT count(*)::int AS n FROM intake_workspace_bootstraps
      WHERE tenant_id=ANY($1::text[])`,[[workspaceId,second.workspaceId]]);
   assert.equal(count.rows[0].n,2);
   await pool.query('UPDATE intake_workspace_memberships SET status=$3 WHERE tenant_id=$1 AND subject_id=$2',
     [workspaceId,first.sub,'disabled']);
   await assert.rejects(()=>bootstrap.registerVerifiedIdentity({
    claims:first,displayName:'Attempt to restore access'
   }),e=>e.statusCode===403);
   const disabled=await pool.query('SELECT status FROM intake_workspace_memberships WHERE tenant_id=$1 AND subject_id=$2',
     [workspaceId,first.sub]);
   assert.equal(disabled.rows[0].status,'disabled');
  }finally{await pool.end()}
 });
