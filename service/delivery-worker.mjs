import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { PostgresOutboxStore, } from '../src/delivery/postgres-outbox-store.js';
import { DeliveryWorker } from '../src/delivery/outbox.js';
import { injectOneCRuntimeAuth } from '../src/integrations/one-c/http-service.js';
import { PostgresLedgerStore } from '../src/compliance/storage/postgres-store.js';
import { AsyncComplianceLedger } from '../src/compliance/async-ledger.js';
import { recordDeliveryAttempt, recordDeliveryResult } from '../src/compliance/audited-delivery.js';
import { ServicePolicyRegistry } from '../src/service/policies.js';

// A shared synthetic staging environment must never start a real 1C sender.
if(process.env.NODE_ENV==='staging')throw new Error('staging_real_provider_delivery_forbidden');
function load(path){return JSON.parse(readFileSync(path,'utf8'))}
if(!process.env.DATABASE_URL||!process.env.ONE_C_CONFIG_FILE||!process.env.SERVICE_CONFIG_FILE)throw new Error('DATABASE_URL_ONE_C_CONFIG_FILE_SERVICE_CONFIG_FILE_required');
const service=load(process.env.SERVICE_CONFIG_FILE), oneC=load(process.env.ONE_C_CONFIG_FILE), policies=new ServicePolicyRegistry(service.policies), integrationPolicy=policies.get('integration');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:Number(process.env.PG_POOL_MAX||6),statement_timeout:Number(process.env.PG_STATEMENT_TIMEOUT_MS||10000)}),store=new PostgresOutboxStore({pool}),ledgerStore=new PostgresLedgerStore({pool}),ledgers=new Map();
function ledger(tenantId){if(!ledgers.has(tenantId))ledgers.set(tenantId,new AsyncComplianceLedger({tenantId,ledgerId:`sales-intake-ledger-v3:${tenantId}`,store:ledgerStore,strict:true}));return ledgers.get(tenantId)}
async function sender(item){const req=injectOneCRuntimeAuth(item.request,oneC,process.env),r=await fetch(req.url,{method:req.method,headers:req.headers,body:typeof req.body==='string'?req.body:JSON.stringify(req.body)}),text=await r.text();let parsed;try{parsed=JSON.parse(text)}catch{}return{ok:r.ok,status:r.status,body:text,externalRecordRef:parsed?.externalRecordRef||parsed?.id||parsed?.ref||r.headers.get('location')||null}}
const audit={attempt:async item=>recordDeliveryAttempt(ledger(item.tenantId),{envelope:{intakeId:item.intakeId},request:item.request,actor:{type:'service',id:'one-c-delivery-worker'},purpose:integrationPolicy.purpose,legalBasis:integrationPolicy.legalBasis,retention:integrationPolicy.retention,destination:'1c'}),result:async(item,result)=>recordDeliveryResult(ledger(item.tenantId),{envelope:{intakeId:item.intakeId},actor:{type:'service',id:'one-c-delivery-worker'},purpose:integrationPolicy.purpose,legalBasis:integrationPolicy.legalBasis,retention:integrationPolicy.retention,destination:'1c',...result})};
const worker=new DeliveryWorker({store,sender,audit,maxAttempts:Number(process.env.DELIVERY_MAX_ATTEMPTS||6),backoff:{baseMs:Number(process.env.DELIVERY_BACKOFF_BASE_MS||1000),maxMs:Number(process.env.DELIVERY_BACKOFF_MAX_MS||900000)}}),interval=Number(process.env.DELIVERY_POLL_MS||2000);let stopped=false;
async function loop(){while(!stopped){const results=await worker.runOnce({limit:Number(process.env.DELIVERY_BATCH_SIZE||20)});if(!results.length)await new Promise(r=>setTimeout(r,interval))}}
process.on('SIGTERM',()=>{stopped=true});process.on('SIGINT',()=>{stopped=true});try{await loop()}finally{await pool.end()}
