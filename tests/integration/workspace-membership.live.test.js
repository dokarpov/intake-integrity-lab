import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {WorkspaceMembershipAuthenticator} from '../../src/service/auth/workspace-membership.js';

test('PostgreSQL membership restricts organizations and disables revoked users',
 {skip:!process.env.TEST_DATABASE_URL}, async()=>{
  const {Pool}=await import('pg');
  const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL});
  const unique=randomUUID(),organizationA='org_a_'+unique,organizationB='org_b_'+unique;
  const subjectId='member_'+unique;
  let selected=organizationA;
  const identity={authenticate:async()=>({id:subjectId,tenantId:selected,roles:['policy_admin'],claims:{sub:subjectId}})};
  const auth=new WorkspaceMembershipAuthenticator({authenticator:identity,pool});
  try{
   await pool.query(readFileSync(new URL('../../infra/postgres/migrations/006_workspace_memberships.sql',import.meta.url),'utf8'));
   for(const tenantId of [organizationA,organizationB])
    await pool.query('INSERT INTO intake_workspaces(tenant_id,display_name) VALUES($1,$2)',[tenantId,'Test workspace']);
   await pool.query('INSERT INTO intake_workspace_memberships(tenant_id,subject_id,roles) VALUES($1,$2,$3)',[organizationA,subjectId,['reviewer']]);
   const assigned=await auth.authenticate({});
   assert.deepEqual(assigned.roles,['reviewer']);
   assert.equal(assigned.permissions.has('policy.publish'),false);
   selected=organizationB;
   await assert.rejects(()=>auth.authenticate({}),e=>e.statusCode===403);
   await pool.query('INSERT INTO intake_workspace_memberships(tenant_id,subject_id,roles) VALUES($1,$2,$3)',[organizationB,subjectId,['auditor']]);
   assert.deepEqual((await auth.authenticate({})).roles,['auditor']);
   await pool.query('UPDATE intake_workspace_memberships SET status=$3 WHERE tenant_id=$1 AND subject_id=$2',[organizationB,subjectId,'disabled']);
   await assert.rejects(()=>auth.authenticate({}),e=>e.statusCode===403);
   selected=organizationA;
   await pool.query('UPDATE intake_workspaces SET status=$2 WHERE tenant_id=$1',[organizationA,'suspended']);
   await assert.rejects(()=>auth.authenticate({}),e=>e.statusCode===403);
  }finally{await pool.end()}
 });
