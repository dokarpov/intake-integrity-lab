// One-shot restricted tenant worker. Schedule as a separate process. It does
// not accept arbitrary user-submitted tenant IDs or provider connection URLs.
import {randomUUID} from 'node:crypto';
import {PostgresSourcePairSync,ReadOnlySourceSyncWorker}
 from '../src/sales-integrity/source-pair-sync.js';
import {AwsSourceConnectionVault} from '../src/sales-integrity/source-sync-vault.js';
import {assertSourceSyncDbRole} from '../src/sales-integrity/source-sync-preflight.js';
const tenant=process.env.SOURCE_SYNC_TENANT_ID;
const url=process.env.SOURCE_SYNC_WORKER_DATABASE_URL;
if(process.env.NODE_ENV!=='production'||process.env.SOURCE_SYNC_ENABLED!=='true'||
   !tenant||!/^[0-9a-f-]{36}$/i.test(tenant)||!url||
   url===process.env.DATABASE_URL||url===process.env.SOURCE_SYNC_API_DATABASE_URL)
 throw Error('source_sync_worker_production_identity_required');
const {Pool}=await import('pg');
const pool=new Pool({connectionString:url,max:3,statement_timeout:20000});
try{
 await assertSourceSyncDbRole({pool,role:'worker'});
 const vault=await AwsSourceConnectionVault.fromEnvironment();
 const runner=new ReadOnlySourceSyncWorker({
  store:new PostgresSourcePairSync({pool}),vault
 });
 const state=await runner.processOne({tenantId:tenant,workerId:randomUUID()});
 // Log only non-sensitive job state. Do not emit provider responses, customer
 // records, DB connection errors or Vault payloads to hosting logs.
 process.stdout.write(JSON.stringify({result:state?.status||'no_queued_job',
  runId:state?.runId||null})+'\n');
 if(state?.status==='failed')process.exitCode=2;
}finally{await pool.end()}
