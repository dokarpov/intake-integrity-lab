import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PostgresSourceComparison} from '../../src/sales-integrity/source-comparison.js';

test('LIVE PostgreSQL source records reject other tenants under a restricted role',
 {skip:!process.env.TEST_DATABASE_URL},async()=>{
  const {Pool}=await import('pg');
  const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:3});
  const a='tenant_a_'+randomUUID(),b='tenant_b_'+randomUUID();
  const testPassword='local-pg-test-credentials-only';
  const role='intake_source_rls_test';
  const one=(company)=>[{
   sourceRecordId:'record-1',sharedKey:'key-1',company,
   counterpartyType:'OOO',contactRef:'contact-1',ownerRef:'owner-1'
  }];
  try{
   await admin.query(readFileSync(new URL('../../infra/postgres/migrations/005_source_comparison.sql',import.meta.url),'utf8'));
   await admin.query(readFileSync(new URL('../../infra/postgres/migrations/007_source_rls.sql',import.meta.url),'utf8'));
   await admin.query(`DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='intake_source_rls_test')
    THEN CREATE ROLE intake_source_rls_test LOGIN PASSWORD 'local-pg-test-credentials-only';
    END IF;
    END $$;`);
   await admin.query('GRANT USAGE ON SCHEMA public TO intake_source_rls_test');
   await admin.query(`GRANT SELECT, INSERT ON
    sales_source_snapshots,sales_source_records,sales_source_comparisons,sales_source_assessments
    TO intake_source_rls_test`);
   const ownerEngine=new PostgresSourceComparison({pool:admin});
   await ownerEngine.importSnapshot({tenantId:a,source:'1c',importKey:'a',actorRef:'fixture',rows:one('Company A')});
   await ownerEngine.importSnapshot({tenantId:b,source:'1c',importKey:'b',actorRef:'fixture',rows:one('Company B')});
   const uri=new URL(process.env.TEST_DATABASE_URL);
   uri.username=role;uri.password=testPassword;
   const restricted=new Pool({connectionString:uri.toString(),max:2});
   try{
    const sqlEngine=new PostgresSourceComparison({pool:restricted});
    assert.equal((await sqlEngine.latest({tenantId:a})).sources.length,1);
    assert.equal((await sqlEngine.latest({tenantId:b})).sources.length,1);
    const withoutTenant=await restricted.query('SELECT count(*)::int AS n FROM sales_source_snapshots');
    assert.equal(withoutTenant.rows[0].n,0,'default connection has no readable records');
    const c=await restricted.connect();
    try{
     await c.query('BEGIN');
     await c.query("SELECT set_config('intake.tenant_id',$1,true)",[a]);
     const r=await c.query('SELECT DISTINCT tenant_id FROM sales_source_snapshots');
     assert.deepEqual(r.rows.map(x=>x.tenant_id),[a]);
     const denied=await c.query('SELECT * FROM sales_source_snapshots WHERE tenant_id=$1',[b]);
     assert.equal(denied.rowCount,0);
     await assert.rejects(()=>c.query(`INSERT INTO sales_source_snapshots
      (tenant_id,source,import_key,content_sha256,record_count,actor_ref)
      VALUES($1,'1c','forbidden',repeat('a',64),1,'fixture')`,[b]),e=>e.code==='42501');
     await c.query('ROLLBACK');
    }finally{c.release()}
    const after=await restricted.query('SELECT count(*)::int AS n FROM sales_source_snapshots');
    assert.equal(after.rows[0].n,0,'transaction-local tenant context is not leaked');
   }finally{await restricted.end()}
  }finally{await admin.end()}
 });
