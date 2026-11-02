import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {assertSourceSyncDbRole} from '../../src/sales-integrity/source-sync-preflight.js';
const m=file=>readFileSync(new URL('../../infra/postgres/migrations/'+file,import.meta.url),'utf8');
test('LIVE PostgreSQL read-only provider sync enforces real restricted role/RLS A↔B boundaries',
 {skip:!process.env.TEST_DATABASE_URL},async()=>{
 const {Pool}=await import('pg');
 const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:3});
 const suffix=randomUUID().replaceAll('-','').slice(0,18);
 const apiRole='sync_api_'+suffix,workerRole='sync_worker_'+suffix;
 const password=randomUUID();
 const base=new URL(process.env.TEST_DATABASE_URL);
 let apiPool,workerPool;
 try{
  await admin.query(m('005_source_comparison.sql'));
  await admin.query(m('007_source_rls.sql'));
  await admin.query(m('011_source_pair_sync.sql'));
  const names=['sales_source_sync_runs','sales_source_sync_staging',
   'sales_source_sync_pages','sales_source_sync_findings',
   'sales_source_snapshots','sales_source_records'];
  for(const name of [apiRole,workerRole]){
   await admin.query('CREATE ROLE '+name+" LOGIN PASSWORD '"+password+"'");
   await admin.query('GRANT USAGE ON SCHEMA public TO '+name);
  }
  await admin.query('GRANT SELECT,INSERT ON sales_source_sync_runs TO '+apiRole);
  await admin.query('GRANT SELECT ON sales_source_sync_findings TO '+apiRole);
  await admin.query('GRANT SELECT ON '+names.join(',')+' TO '+workerRole);
  await admin.query('GRANT UPDATE ON sales_source_sync_runs TO '+workerRole);
  await admin.query('GRANT INSERT ON '+names.filter(x=>x!=='sales_source_sync_runs').join(',')+
   ' TO '+workerRole);
  const uri=name=>{const u=new URL(base);u.username=name;u.password=password;return u.toString()};
  apiPool=new Pool({connectionString:uri(apiRole),max:2});
  workerPool=new Pool({connectionString:uri(workerRole),max:2});
  assert.equal((await assertSourceSyncDbRole({pool:apiPool,role:'api'})).tenantRls,true);
  assert.equal((await assertSourceSyncDbRole({pool:workerPool,role:'worker'})).tenantRls,true);
  await assert.rejects(()=>apiPool.query('SELECT * FROM sales_source_sync_staging'),e=>e.code==='42501');
  await assert.rejects(()=>apiPool.query('INSERT INTO sales_source_snapshots (tenant_id,source,import_key,content_sha256,record_count,actor_ref) VALUES ($1,$2,$3,$4,$5,$6)',
   ['a','1c','a','a'.repeat(64),0,'test']),e=>e.code==='42501');
  const tenantA='safe_a_'+suffix,tenantB='safe_b_'+suffix;
  // Use a trusted migration identity only to set up fictional, scoped fixtures.
  await admin.query(`INSERT INTO sales_source_sync_runs
   (tenant_id,run_key,mapping_version,actor_ref)
   VALUES($1,$2,$3,$4),($5,$6,$7,$8)`,
   [tenantA,'seed-A','mapping-synthetic','tester',
    tenantB,'seed-B','mapping-synthetic','tester']);
  const conn=await apiPool.connect();
  try{
   let q=await conn.query('SELECT tenant_id FROM sales_source_sync_runs');
   assert.equal(q.rows.length,0); // no tenant context: deny all
   await conn.query('BEGIN');
   await conn.query("SELECT set_config('intake.tenant_id',$1,true)",[tenantA]);
   q=await conn.query('SELECT tenant_id FROM sales_source_sync_runs');
   assert.deepEqual(q.rows.map(x=>x.tenant_id),[tenantA]);
   q=await conn.query('SELECT tenant_id FROM sales_source_sync_runs WHERE tenant_id=$1',[tenantB]);
   assert.equal(q.rows.length,0);
   await assert.rejects(()=>conn.query(`INSERT INTO sales_source_sync_runs
    (tenant_id,run_key,mapping_version,actor_ref)
    VALUES($1,$2,$3,$4)`,[tenantB,'attack','mapping-synthetic','tester']),
    e=>e.code==='42501');
   await conn.query('ROLLBACK');
   q=await conn.query('SELECT tenant_id FROM sales_source_sync_runs');
   assert.equal(q.rows.length,0); // pooled transaction context reset
  }finally{conn.release()}
 }finally{
  if(apiPool)await apiPool.end();
  if(workerPool)await workerPool.end();
  await admin.end();
 }
});
