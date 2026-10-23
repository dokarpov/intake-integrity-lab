/**
 * Isolated Neon Functions host for the existing Intake Integrity PostgreSQL
 * engine. FICTIONAL DATA ONLY. No real CRM network calls.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
import {Pool} from 'pg';
import {PostgresSalesIntegrity} from '../src/sales-integrity/postgres-integrity.js';
import {SandboxDecisionEvidence} from '../src/sales-integrity/sandbox-evidence.js';
import {SandboxCrmSimulator} from '../src/sales-integrity/sandbox-crm.js';
import {PostgresSourceComparison} from '../src/sales-integrity/source-comparison.js';
import {shouldBlockStagingWrite} from '../src/service/http/staging-write-gate.js';
import sourceHtml from '../demo/source-comparison.html';
import onboardingHtml from '../demo/onboarding.html';
import scrollStoryHtml from '../demo/scroll-story.html';
import html from '../demo/integrity.html';

if(process.env.NODE_ENV!=='staging')throw Error('staging_only_runtime');
const token=process.env.STAGING_ACCESS_TOKEN;
const fingerprintSecret=process.env.INTEGRITY_FINGERPRINT_HMAC_SECRET;
const evidenceSecret=process.env.SANDBOX_EVIDENCE_HMAC_SECRET;
if(!process.env.DATABASE_URL||!token||token.length<40||
   !fingerprintSecret||fingerprintSecret.length<32||
   !evidenceSecret||evidenceSecret.length<40)throw Error('staging_secrets_required');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:5,
  connectionTimeoutMillis:8000,statement_timeout:10000,
  idleTimeoutMillis:20000});
pool.on('error',(e)=>console.error('staging pool idle connection issue:',e.code||'unknown'));
const integrity=new PostgresSalesIntegrity({pool,fingerprintSecret});
const evidence=new SandboxDecisionEvidence({integrityStore:integrity,secret:evidenceSecret});
const crm=new SandboxCrmSimulator({pool,integrity});
const sources=new PostgresSourceComparison({pool});
const tenantId='staging-demo',actorId='sandbox.operator';
const samples=[
 {name:'Sam Lee - Studio North',email:'sam@example.com',ref:'demo-crm-north'},
 {name:'Sam Lee - Studio South',email:'sam@example.com',ref:'demo-crm-south'},
 {name:'Nora Chen - Example Labs',email:'nora@example.com',ref:'demo-crm-nora'}
];
const headers={'cache-control':'no-store','x-content-type-options':'nosniff',
 'referrer-policy':'no-referrer',
 'x-frame-options':'DENY',
 'content-security-policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
function json(value,status=200){
 return Response.json(value,{status,headers});
}
function fail(code,status=400){
 return json({error:{code,message:code.replaceAll('_',' ')}},status);
}
function validAccess(request){
 const h=request.headers.get('authorization')||'';
 const m=/^Bearer (\S+)$/.exec(h);
 if(!m)return false;
 const value=Buffer.from(m[1]),wanted=Buffer.from(token);
 return value.length===wanted.length&&timingSafeEqual(value,wanted);
}
async function body(request,max=16000){
 const len=Number(request.headers.get('content-length')||0);
 if(len>max)throw Error('request_too_large');
 const raw=await request.text();
 if(raw.length>max)throw Error('request_too_large');
 let parsed;try{parsed=JSON.parse(raw)}catch{throw Error('invalid_json')}
 if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw Error('json_object_required');
 return parsed;
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validId(v){if(typeof v!=='string'||!uuid.test(v))throw Error('invalid_record_id');return v}
let pendingSeed=null;
async function seedFictional(){
 if(pendingSeed)return pendingSeed;
 pendingSeed=(async()=>{
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['intake-synthetic-staging-seed-v1']);
   for(const sample of samples){
    const check=await client.query(
     'SELECT 1 FROM sales_person_identifiers WHERE tenant_id=$1 AND source_ref=$2 LIMIT 1',
     [tenantId,sample.ref]);
    if(check.rows.length)continue;
    await integrity.registerPerson({tenantId,name:sample.name,kind:'email',value:sample.email,
       sourceRef:sample.ref,evidenceRef:'synthetic-fixture',actorId:'staging-bootstrap'});
   }
   await client.query('COMMIT');
  }catch(e){try{await client.query('ROLLBACK')}catch{}throw e}
  finally{client.release()}
 })().catch(e=>{pendingSeed=null;throw e});
 return pendingSeed;
}
function guardDestination(v){
 if(v!=='crm-simulator')throw Error('sandbox_destination_only');
 return v;
}
async function route(request){
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if(method==='GET'&&path==='/testing/story')
  return new Response(scrollStoryHtml,{status:200,headers:{...headers,'content-type':'text/html; charset=utf-8'}});
 if(method==='GET'&&path==='/sources')
  return new Response(sourceHtml,{status:200,headers:{...headers,'content-type':'text/html; charset=utf-8'}});
 if(method==='GET'&&(path==='/'||path==='/welcome'))
  return new Response(onboardingHtml,{status:200,headers:{...headers,'content-type':'text/html; charset=utf-8'}});
 if(method==='GET'&&path==='/integrity')
  return new Response(html,{status:200,headers:{...headers,'content-type':'text/html; charset=utf-8'}});
 if(method==='GET'&&path==='/healthz')return json({ok:true,service:'intake-integrity-staging',mode:'synthetic'});
 if(method==='GET'&&path==='/readyz'){
  try{await pool.query('SELECT 1 FROM sales_incoming_enquiries LIMIT 1');return json({ok:true,database:'postgres'})}
  catch{return fail('database_unavailable',503)}
 }
 if(!path.startsWith('/api/'))return fail('not_found',404);
 if(!validAccess(request))return fail('unauthorized',401);
 // Neon Function is a separate public staging ingress, not protected by service/server.mjs.
 // No remote address is trusted here; isolated CI exception never applies.
 if(shouldBlockStagingWrite({env:process.env,method,remoteAddress:''}))
  return fail('staging_synthetic_only',423);
 await seedFictional();
 if(method==='GET'&&path==='/api/integrity/sources/latest')
  return json(await sources.latest({tenantId}));
 if(method==='GET'&&path==='/api/integrity/sources/comparison/latest')
  return json((await sources.latestComparison({tenantId}))||{comparisonId:null});
 if(method==='POST'&&path==='/api/integrity/sources/snapshots'){
  const v=await body(request,64000);
  return json(await sources.importSnapshot({...v,tenantId,actorRef:actorId}));
 }
 if(method==='POST'&&path==='/api/integrity/sources/compare')
  return json(await sources.compareLatest({tenantId,actorRef:actorId}));
 if(method==='GET'&&path==='/api/integrity/sources/assessments'){
  const id=validId(url.searchParams.get('comparisonId'));
  return json({items:await sources.assessments({tenantId,comparisonId:id})});
 }
 if(method==='POST'&&path==='/api/integrity/sources/assessments'){
  const v=await body(request);
  return json(await sources.assess({...v,comparisonId:validId(v.comparisonId),tenantId,actorRef:actorId}));
 }
 if(method==='GET'&&path==='/api/me')return json({
   id:actorId,name:'Staging reviewer',tenantId,roles:['sales','reviewer','auditor','integration_admin'],
   permissions:['intake.submit','review.read','review.resolve','audit.read','integration.read','integration.test']
 });
 if(method==='GET'&&path==='/api/integrity/intakes'){
  const limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit')||50)));
  return json({items:await integrity.listIntakes({tenantId,limit:Math.trunc(limit)})});
 }
 if(method==='GET'&&path==='/api/integrity/people')
  return json({items:await integrity.listPeople({tenantId})});
 if(method==='POST'&&path==='/api/integrity/intakes'){
  const data=await body(request);
  const result=await integrity.receiveEnquiry({...data,tenantId,actorId});
  return json(result,result.replayed?200:201);
 }
 if(method==='POST'&&path==='/api/integrity/sandbox/evidence'){
  const data=await body(request);
  return json(await evidence.issue({...data,tenantId,actorId}));
 }
 if(method==='POST'&&path==='/api/integrity/sandbox/crm/run'){
  const data=await body(request);
  return json(await crm.runOnce({mode:data.mode==='lost_ack'?'lost_ack':'success',
    limit:1,outboxId:validId(data.outboxId)}));
 }
 if(method==='POST'&&path==='/api/integrity/sandbox/crm/reconcile'){
  const data=await body(request);
  return json(await crm.reconcile({outboxId:validId(data.outboxId)}));
 }
 const match=/^\/api\/integrity\/intakes\/([^\/]+)(?:\/([^\/]+))?$/.exec(path);
 if(!match)return fail('not_found',404);
 const intakeId=validId(match[1]),part=match[2]||'';
 if(method==='GET'&&!part){
  const record=await integrity.getIntake({tenantId,intakeId});
  return record?json(record):fail('intake_not_found',404);
 }
 if(method==='GET'&&part==='candidates')
  return json({items:await integrity.candidates({tenantId,intakeId})});
 if(method==='GET'&&part==='history')
  return json(await integrity.history({tenantId,intakeId}));
 if(method==='GET'&&part==='deliveries')
  return json({items:await integrity.outboxForIntake({tenantId,intakeId})});
 if(method==='POST'&&part==='decisions'){
  const data=await body(request);
  guardDestination(data.destination);
  if(await evidence.verifyDecision({...data,tenantId,actorId,intakeId})!==true)
   return fail('decision_evidence_not_verified',403);
  return json(await integrity.decideEnquiry({...data,tenantId,actorId,intakeId}));
 }
 return fail('not_found',404);
}
export default {
 async fetch(request){
  try{return await route(request)}
  catch(err){
   const name=String(err?.message||'');
   const status=/not_found/.test(name)?404:
     /already_decided|idempotency_key_payload_conflict|delivery_lease_conflict|source_import_key_conflict|assessment_key_conflict/.test(name)?409:
     /required|invalid|forbidden|not_allowed|not_candidate|not_reviewable|consent|selected|too_short|does_not_match|outbox_id|unsupported|snapshot|source_import|duplicate_source|assessment_choice|assessment_reason|both_source/.test(name)?400:500;
   if(status===500)console.error('staging request failed:',err?.code||name);
   return fail(status===500?'internal_error':name,status);
  }
 }
};
