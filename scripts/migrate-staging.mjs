import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const files=[
  'infra/postgres/001_ledger.sql',
  'infra/postgres/migrations/002_service_workflows.sql',
  'infra/postgres/migrations/003_sales_integrity.sql',
  'infra/postgres/migrations/004_sandbox_crm.sql'
];
const apply=process.argv.includes('--apply');
if(!apply){
  process.stdout.write('Database migration plan (no changes):\n'+files.join('\n')+
    '\nTo apply to an isolated test DB set INTAKE_MIGRATION_TARGET=staging and use --apply.\n');
  process.exit(0);
}
if(process.env.INTAKE_MIGRATION_TARGET!=='staging')throw new Error('staging_migration_explicit_confirmation_required');
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL_required');
const {Pool}=await import('pg');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:7000});
const client=await pool.connect();
try{
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='45s'");
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['intake-integrity-schema']);
  await client.query(`CREATE TABLE IF NOT EXISTS integrity_schema_migrations(
    name text PRIMARY KEY,
    sha256 text NOT NULL CHECK(length(sha256)=64),
    applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
  )`);
  for(const file of files){
    const sql=readFileSync(resolve(root,file),'utf8');
    const sha=createHash('sha256').update(sql).digest('hex');
    const old=await client.query('SELECT sha256 FROM integrity_schema_migrations WHERE name=$1',[file]);
    if(old.rows.length){
      if(old.rows[0].sha256!==sha)throw new Error('applied_migration_checksum_changed: '+file);
      process.stdout.write('Already applied: '+file+'\n');continue;
    }
    await client.query(sql);
    await client.query('INSERT INTO integrity_schema_migrations(name,sha256) VALUES($1,$2)',[file,sha]);
    process.stdout.write('Applied: '+file+'\n');
  }
  await client.query('COMMIT');
  process.stdout.write('Staging schema migration committed.\n');
}catch(e){
  try{await client.query('ROLLBACK')}catch{}
  throw e;
}finally{
  client.release();
  await pool.end();
}
