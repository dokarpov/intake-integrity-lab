/**
 * Exercise the exact Neon staging Function via authenticated real HTTP.
 * All records are fictional and written only to a disposable CI PostgreSQL.
 */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
const base=process.env.BASE_URL||'http://127.0.0.1:8788';
const token=process.env.STAGING_ACCESS_TOKEN;
if(!token||token.length<40||!process.env.DATABASE_URL)throw Error('test_credentials_required');
const db=new Pool({connectionString:process.env.DATABASE_URL,max:2});
async function call(method,path,data,auth=true){
 const headers={'Content-Type':'application/json'};
 if(auth)headers.Authorization='Bearer '+token;
 const res=await fetch(base+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});
 const output=await res.json().catch(()=>null);
 return {status:res.status,data:output};
}
function status(result,expected,label){assert.equal(result.status,expected,label+': '+JSON.stringify(result.data))}
const sourceKey='neon-fn-ci-'+randomUUID();
const payload={source:'fictional-ci',sourceEventKey:sourceKey,displayName:'Sam Lee',
 identifier:{kind:'email',value:'sam@example.com'},
 consentEvidenceRef:'fictional-ci-consent',context:{message:'Fictional sandbox end-to-end QA'}};
try{
 status(await call('GET','/readyz',undefined,false),200,'DB readiness');
 status(await call('GET','/api/me',undefined,false),401,'Anonymous API denial');
 status(await call('POST','/api/integrity/intakes',payload,false),401,'Anonymous write denial');
 const me=await call('GET','/api/me');status(me,200,'Authenticated actor');
 assert.equal(me.data.tenantId,'staging-demo');
 const created=await call('POST','/api/integrity/intakes',payload);
 status(created,201,'Authenticated intake');
 assert.equal(created.data.candidateCount,2);
 assert.equal(created.data.replayed,false);
 const intakeId=created.data.intakeId;
 const replay=await call('POST','/api/integrity/intakes',payload);
 status(replay,200,'Intake replay');assert.equal(replay.data.replayed,true);
 assert.equal(replay.data.intakeId,intakeId);
 status(await call('POST','/api/integrity/intakes',{...payload,context:{message:'Altered replay'}}),409,'Conflicting replay');
 const matches=await call('GET','/api/integrity/intakes/'+intakeId+'/candidates');
 status(matches,200,'Candidate lookup');assert.equal(matches.data.items.length,2);
 assert(matches.data.items.every(x=>x.signals.every(s=>s.identityVerified===false)));
 const personId=matches.data.items[0].personId;
 const requestKey='decision-ci-'+randomUUID();
 const decision={requestKey,action:'link_existing',personId,
   reason:'Fictional callback confirms selected Studio North for this CI-only test.',
   policyVersion:'ci-sandbox-v1',destination:'crm-simulator'};
 status(await call('POST','/api/integrity/intakes/'+intakeId+'/decisions',decision,false),401,'Anonymous decision denied');
 status(await call('POST','/api/integrity/intakes/'+intakeId+'/decisions',decision),403,'Unverified decision denied');
 const fabricated=await call('POST','/api/integrity/sandbox/evidence',{
   intakeId,action:'link_existing',personId:randomUUID(),simulateEvidence:true,simulateConsent:true
 });
 assert.notEqual(fabricated.status,200,'Cannot issue proof for non-candidate');
 const issued=await call('POST','/api/integrity/sandbox/evidence',{
   intakeId,action:'link_existing',personId,simulateEvidence:true,simulateConsent:true
 });
 status(issued,200,'Fictional evidence issued');assert.equal(issued.data.simulation,true);
 const approved={...decision,identityEvidenceRef:issued.data.identityEvidenceRef,consentEvidenceRef:issued.data.consentEvidenceRef};
 const decided=await call('POST','/api/integrity/intakes/'+intakeId+'/decisions',approved);
 status(decided,200,'Verified decision');assert.equal(decided.data.replayed,false);
 assert.equal(decided.data.action,'link_existing');
 const outboxId=decided.data.delivery.outbox_id;
 assert.match(outboxId,/^[0-9a-f-]{36}$/i);
 const identical=await call('POST','/api/integrity/intakes/'+intakeId+'/decisions',approved);
 status(identical,200,'Idempotent decision');assert.equal(identical.data.replayed,true);
 status(await call('POST','/api/integrity/intakes/'+intakeId+'/decisions',{
   ...approved,requestKey:randomUUID(),reason:'Attempt to change a settled review decision'
 }),409,'No conflicting decision');
 const deliveries=await call('GET','/api/integrity/intakes/'+intakeId+'/deliveries');
 status(deliveries,200,'Outbox persisted');
 assert.equal(deliveries.data.items.length,1);assert.equal(deliveries.data.items[0].state,'pending');
 const lost=await call('POST','/api/integrity/sandbox/crm/run',{outboxId,mode:'lost_ack'});
 status(lost,200,'Lost acknowledgement simulation');assert.equal(lost.data.processed,1);
 const waiting=await call('GET','/api/integrity/intakes/'+intakeId+'/deliveries');
 assert.equal(waiting.data.items[0].state,'needs_reconciliation');
 const avoidRetry=await call('POST','/api/integrity/sandbox/crm/run',{outboxId,mode:'success'});
 status(avoidRetry,200,'No unsafe retry');assert.equal(avoidRetry.data.processed,0);
 const settled=await call('POST','/api/integrity/sandbox/crm/reconcile',{outboxId});
 status(settled,200,'Independent simulated receipt lookup');assert.equal(settled.data.state,'succeeded');
 const history=await call('GET','/api/integrity/intakes/'+intakeId+'/history');
 status(history,200,'Audit history');assert.equal(history.data.integrityOk,true);
 assert.deepEqual(history.data.events.map(x=>x.action),
   ['intake.received','identity.candidates_evaluated','intake.decision_recorded']);
 const record=await call('GET','/api/integrity/intakes/'+intakeId);
 status(record,200,'Recorded identity');assert.equal(record.data.state,'resolved');
 assert.equal(record.data.decision.personId,personId);
 const q=await db.query(
  "SELECT (SELECT count(*)::int FROM sales_intake_decisions WHERE tenant_id='staging-demo' AND intake_id=$1) AS decisions,"+
  " (SELECT count(*)::int FROM sales_crm_outbox_v2 WHERE tenant_id='staging-demo' AND intake_id=$1) AS outboxes,"+
  " (SELECT count(*)::int FROM sandbox_crm_deliveries WHERE tenant_id='staging-demo' AND outbox_id=$2) AS receipts,"+
  " (SELECT state FROM sales_crm_outbox_v2 WHERE tenant_id='staging-demo' AND outbox_id=$2) AS state",
  [intakeId,outboxId]);
 assert.deepEqual(q.rows[0],{decisions:1,outboxes:1,receipts:1,state:'succeeded'});
 console.log('PASS exact Neon Function E2E: authenticated HTTP, real PostgreSQL, two ambiguous matches, verified human decision, atomic outbox, lost acknowledgement, reconciliation, one receipt, replay and negative cases');
}finally{await db.end()}
