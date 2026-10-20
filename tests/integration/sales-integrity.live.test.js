import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PostgresSalesIntegrity} from '../../src/sales-integrity/postgres-integrity.js';

const enabled=Boolean(process.env.TEST_DATABASE_URL),secret='test-only-hmac-secret-32-chars-change-in-prod';
let pool,service;
const tenant=()=>'pgtest_'+randomUUID().replaceAll('-','');
const enquiry=(t,key,extra={})=>({tenantId:t,source:'test-web',
 sourceEventKey:key,displayName:'Sam Lee',identifier:{kind:'email',value:'sam@example.com'},
 consentEvidenceRef:'consent-check-001',actorId:'web-source',
 context:{message:'Original customer message'},...extra});
const person=(t,name='Sam Lee')=>service.registerPerson({
 tenantId:t,name,kind:'email',value:'sam@example.com',
 sourceRef:'crm-identifier',evidenceRef:'original-crm-record',actorId:'trusted-import'});
const decision=(t,id,action,extra={})=>({tenantId:t,intakeId:id,action,
 requestKey:'decision-'+randomUUID(),actorId:'reviewer',
 reason:'Confirmed identity using separate evidence',
 identityEvidenceRef:'independent-callback',consentEvidenceRef:'contact-lawful-basis',
 policyVersion:'identity-v1',...extra});
async function createForDelivery(t,key){
 const r=await service.receiveEnquiry(enquiry(t,key));
 const d=await service.decideEnquiry(decision(t,r.intakeId,'create_new'));
 return {r,d};
}
before(async()=>{
 if(!enabled)return;
 const {Pool}=await import('pg');
 pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:18});
 await pool.query(readFileSync(new URL('../../infra/postgres/migrations/003_sales_integrity.sql',import.meta.url),'utf8'));
 service=new PostgresSalesIntegrity({pool,fingerprintSecret:secret});
});
after(async()=>{await pool?.end()});

test('different tenants cannot reference another tenant person',{skip:!enabled},async()=>{
 const a=tenant(),b=tenant(),p=await person(a);
 await assert.rejects(()=>pool.query(
  'INSERT INTO sales_person_identifiers(tenant_id,person_id,kind,fingerprint,source_ref) VALUES($1,$2,$3,$4,$5)',
  [b,p.personId,'email',service.fingerprint(b,'email','sam@example.com'),'forged']),
  e=>e.code==='23503');
 assert.deepEqual(await service.candidates({tenantId:b,intakeId:randomUUID()}),[]);
});
test('two people legitimately share an email; two candidates, zero automatic merges',{skip:!enabled},async()=>{
 const t=tenant(),a=await person(t,'North'),b=await person(t,'South');
 assert.notEqual(a.personId,b.personId);
 const r=await service.receiveEnquiry(enquiry(t,'shared-1'));
 assert.equal(r.candidateCount,2);assert.equal(r.state,'review_needed');
 const matches=await service.candidates({tenantId:t,intakeId:r.intakeId});
 assert.equal(matches.length,2);assert(matches.every(x=>x.signals[0].identityVerified===false));
 const q=await pool.query('SELECT count(*)::int n FROM sales_intake_decisions WHERE tenant_id=$1',[t]);
 assert.equal(q.rows[0].n,0);
});
test('nine racing retries insert only one enquiry and one audit chain',{skip:!enabled},async()=>{
 const t=tenant(),body=enquiry(t,'repeat-1');
 const a=await Promise.all(Array.from({length:9},()=>service.receiveEnquiry(body)));
 assert.equal(new Set(a.map(x=>x.intakeId)).size,1);
 assert.equal(a.filter(x=>x.replayed===false).length,1);
 const hist=await service.history({tenantId:t,intakeId:a[0].intakeId});
 assert.equal(hist.integrityOk,true);assert.equal(hist.events.length,2);
 await assert.rejects(()=>service.receiveEnquiry(enquiry(t,'repeat-1',
  {context:{message:'Different content'}})),/idempotency_key_payload_conflict/);
});
test('wrong candidate and absent consent roll back without a decision or outbox',{skip:!enabled},async()=>{
 const t=tenant(),p=await person(t),r=await service.receiveEnquiry(enquiry(t,'consent',
  {consentEvidenceRef:null}));
 await assert.rejects(()=>service.decideEnquiry(decision(t,r.intakeId,'link_existing',
  {personId:randomUUID()})),/person_not_in_candidate_evidence/);
 await assert.rejects(()=>service.decideEnquiry(decision(t,r.intakeId,'link_existing',
  {personId:p.personId,consentEvidenceRef:null})),/consent_evidence_required_for_delivery/);
 assert.deepEqual(await service.outboxForIntake({tenantId:t,intakeId:r.intakeId}),[]);
 const d=await service.decideEnquiry(decision(t,r.intakeId,'link_existing',{personId:p.personId}));
 assert.equal(d.delivery.state,'pending');
 assert.equal((await service.history({tenantId:t,intakeId:r.intakeId})).integrityOk,true);
});
test('human create-new and outbox commit once; replay cannot modify decision',{skip:!enabled},async()=>{
 const t=tenant(),r=await service.receiveEnquiry(enquiry(t,'new-1'));
 const cmd=decision(t,r.intakeId,'create_new',{requestKey:'stable-decision-1'});
 const d=await service.decideEnquiry(cmd),same=await service.decideEnquiry(cmd);
 assert.equal(same.replayed,true);assert.equal(same.personId,d.personId);
 await assert.rejects(()=>service.decideEnquiry({...cmd,reason:'Different reviewer conclusion'}),
  /enquiry_already_decided/);
 const out=await service.outboxForIntake({tenantId:t,intakeId:r.intakeId});
 assert.equal(out.length,1);
 const q=await pool.query('SELECT count(*)::int n FROM sales_identity_people WHERE tenant_id=$1',[t]);
 assert.equal(q.rows[0].n,1);
});
test('competing reviewer decisions cannot both commit',{skip:!enabled},async()=>{
 const t=tenant(),r=await service.receiveEnquiry(enquiry(t,'competing'));
 const results=await Promise.allSettled([
  service.decideEnquiry(decision(t,r.intakeId,'create_new')),
  service.decideEnquiry(decision(t,r.intakeId,'discard'))
 ]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.match(results.find(x=>x.status==='rejected').reason.message,/enquiry_already_decided/);
 const hist=await service.history({tenantId:t,intakeId:r.intakeId});
 assert.equal(hist.events.length,3);assert.equal(hist.integrityOk,true);
});
test('discard records decision but never enqueues a CRM write',{skip:!enabled},async()=>{
 const t=tenant(),r=await service.receiveEnquiry(enquiry(t,'discard'));
 const d=await service.decideEnquiry(decision(t,r.intakeId,'discard'));
 assert.equal(d.delivery,null);
 assert.deepEqual(await service.outboxForIntake({tenantId:t,intakeId:r.intakeId}),[]);
});
test('relationships require a decision and evidence and preserve both people',{skip:!enabled},async()=>{
 const t=tenant(),a=await person(t,'North'),b=await person(t,'South');
 const r=await service.receiveEnquiry(enquiry(t,'related'));
 const rel={tenantId:t,intakeId:r.intakeId,fromPersonId:a.personId,toPersonId:b.personId,
 relationType:'colleague',actorId:'reviewer',evidenceRef:'proof-of-colleague-relationship'};
 await assert.rejects(()=>service.relatePeople(rel),/relationship_must_include_decided_person/);
 await service.decideEnquiry(decision(t,r.intakeId,'link_existing',{personId:a.personId}));
 await service.relatePeople(rel);
 await assert.rejects(()=>service.relatePeople(rel),/relationship_already_recorded/);
 await assert.rejects(()=>service.relatePeople({...rel,toPersonId:randomUUID()}),
  e=>e.code==='23503');
 const q=await pool.query('SELECT count(*)::int n FROM sales_identity_people WHERE tenant_id=$1',[t]);
 assert.equal(q.rows[0].n,2);
 assert.equal((await service.history({tenantId:t,intakeId:r.intakeId})).integrityOk,true);
});
test('decisions, intake audit and delivery events reject UPDATE and DELETE',{skip:!enabled},async()=>{
 const t=tenant(),{r,d}=await createForDelivery(t,'immutable');
 await assert.rejects(()=>pool.query('UPDATE sales_intake_decisions SET reason=$3 WHERE tenant_id=$1 AND intake_id=$2',
  [t,r.intakeId,'changed']),/append-only/);
 await assert.rejects(()=>pool.query('DELETE FROM sales_intake_audit_events WHERE tenant_id=$1 AND intake_id=$2',
  [t,r.intakeId]),/append-only/);
 await assert.rejects(()=>pool.query('DELETE FROM sales_crm_outbox_events WHERE tenant_id=$1 AND outbox_id=$2',
  [t,d.delivery.outbox_id]),/append-only/);
});
test('concurrent workers claim exclusive outbox rows with SKIP LOCKED',{skip:!enabled},async()=>{
 const t=tenant();
 for(let i=0;i<4;i++)await createForDelivery(t,'queue-'+i);
 const a=await Promise.all(Array.from({length:4},(_,i)=>service.claimDeliveries({
  tenantId:t,destination:'crm',workerId:'worker-'+i,limit:3})));
 const claims=a.flat();
 assert.equal(claims.length,4);
 assert.equal(new Set(claims.map(x=>x.outboxId)).size,4);
 assert.deepEqual(await service.claimDeliveries({tenantId:t,destination:'crm',workerId:'other'}),[]);
});
test('ambiguous HTTP result requires provider reconciliation, not blind retry',{skip:!enabled},async()=>{
 const t=tenant(),{r}=await createForDelivery(t,'lost-ack');
 const [claim]=await service.claimDeliveries({tenantId:t,destination:'crm',workerId:'first'});
 const u=await service.settleDelivery({tenantId:t,outboxId:claim.outboxId,leaseToken:claim.leaseToken,
  actorId:'first',outcome:'uncertain',reason:'timeout_after_post'});
 assert.equal(u.state,'needs_reconciliation');
 assert.deepEqual(await service.claimDeliveries({tenantId:t,destination:'crm',workerId:'second'}),[]);
 await assert.rejects(()=>service.settleDelivery({tenantId:t,outboxId:claim.outboxId,
  leaseToken:claim.leaseToken,actorId:'first',outcome:'confirmed_delivered',
  externalRecordRef:'crm-1',receiptRef:'receipt-1'}),/delivery_lease_conflict/);
 const resolved=await service.reconcileDelivery({tenantId:t,outboxId:claim.outboxId,
  actorId:'provider-reconciler',result:'found',evidenceRef:'provider-confirmed-lookup',
  externalRecordRef:'crm-1'});
 assert.equal(resolved.state,'succeeded');
 const [out]=await service.outboxForIntake({tenantId:t,intakeId:r.intakeId});
 assert.equal(out.attempts,1);assert.equal(out.operation_key,claim.operationKey);
});
test('expired lease goes to reconciliation and cannot be reclaimed',{skip:!enabled},async()=>{
 const t=tenant();await createForDelivery(t,'stale');
 const [x]=await service.claimDeliveries({tenantId:t,destination:'crm',workerId:'first',leaseSeconds:30});
 await pool.query('UPDATE sales_crm_outbox_v2 SET lease_until=clock_timestamp()-interval \'2 seconds\' WHERE tenant_id=$1 AND outbox_id=$2',
  [t,x.outboxId]);
 assert.equal(await service.expireUnacknowledged({tenantId:t}),1);
 assert.deepEqual(await service.claimDeliveries({tenantId:t,destination:'crm',workerId:'next'}),[]);
});
test('confirmed non-delivery can retry with the same operation key',{skip:!enabled},async()=>{
 const t=tenant();await createForDelivery(t,'retry-confirmed');
 const [first]=await service.claimDeliveries({tenantId:t,destination:'crm',workerId:'first'});
 const noSend=await service.settleDelivery({tenantId:t,outboxId:first.outboxId,
  leaseToken:first.leaseToken,actorId:'first',outcome:'confirmed_not_sent',
  reason:'provider_rejected_before_commit'});
 assert.equal(noSend.state,'retry');
 await pool.query('UPDATE sales_crm_outbox_v2 SET next_attempt_at=clock_timestamp()-interval \'1 second\' WHERE tenant_id=$1 AND outbox_id=$2',
  [t,first.outboxId]);
 const [second]=await service.claimDeliveries({tenantId:t,destination:'crm',workerId:'second'});
 assert.equal(first.operationKey,second.operationKey);assert.notEqual(first.leaseToken,second.leaseToken);
 const success=await service.settleDelivery({tenantId:t,outboxId:second.outboxId,
  leaseToken:second.leaseToken,actorId:'second',outcome:'confirmed_delivered',
  externalRecordRef:'CRM-99',receiptRef:'receipt-99'});
 assert.equal(success.state,'succeeded');
});
test('invalid phone format and credential-bearing source context fail closed',{skip:!enabled},async()=>{
 const t=tenant();
 await assert.rejects(()=>service.receiveEnquiry(enquiry(t,'bad',
  {identifier:{kind:'phone',value:'89991234567'}})),/international_phone_required/);
 await assert.rejects(()=>service.receiveEnquiry(enquiry(t,'credentials',
  {context:{auth:{access_token:'12345'}}})),/credentials_not_allowed_in_payload/);
});
test('unverified identity reference cannot authorize a write',{skip:!enabled},async()=>{
 const t=tenant(),p=await person(t),r=await service.receiveEnquiry(enquiry(t,'missing-evidence'));
 await assert.rejects(()=>service.decideEnquiry(decision(t,r.intakeId,'link_existing',
  {personId:p.personId,identityEvidenceRef:''})),/identityEvidenceRef_required_or_invalid/);
 assert.deepEqual(await service.outboxForIntake({tenantId:t,intakeId:r.intakeId}),[]);
});

test('relationship read returns evidence-backed links in either direction, never another tenant',{skip:!enabled},async()=>{
 const t=tenant(),a=await person(t,'Owner'),b=await person(t,'Colleague'),r=await service.receiveEnquiry(enquiry(t,'read-rel'));
 await service.decideEnquiry(decision(t,r.intakeId,'link_existing',{personId:a.personId}));
 await service.relatePeople({tenantId:t,intakeId:r.intakeId,fromPersonId:a.personId,
  toPersonId:b.personId,relationType:'colleague',actorId:'reviewer',evidenceRef:'verified-relationship'});
 const forward=await service.relationshipsFor({tenantId:t,personId:a.personId});
 const reverse=await service.relationshipsFor({tenantId:t,personId:b.personId});
 assert.equal(forward.length,1);assert.equal(reverse.length,1);
 assert.equal(forward[0].relationId,reverse[0].relationId);
 assert.equal(forward[0].evidenceRef,'verified-relationship');
 assert.deepEqual(await service.relationshipsFor({tenantId:tenant(),personId:a.personId}),[]);
});
test('CRM audit events remain sequential and tenant isolated after unknown delivery',{skip:!enabled},async()=>{
 const t=tenant(),{d}=await createForDelivery(t,'delivery-trace');
 const [claim]=await service.claimDeliveries({tenantId:t,destination:'crm',workerId:'sender'});
 await service.settleDelivery({tenantId:t,outboxId:claim.outboxId,leaseToken:claim.leaseToken,
  actorId:'sender',outcome:'uncertain',reason:'timeout_after_write'});
 const events=await service.deliveryHistory({tenantId:t,outboxId:d.delivery.outbox_id});
 assert.deepEqual(events.map(x=>x.action),['delivery.enqueued','delivery.claimed','delivery.uncertain']);
 assert.deepEqual(events.map(x=>x.sequence),[1,2,3]);
 assert.deepEqual(await service.deliveryHistory({tenantId:tenant(),outboxId:d.delivery.outbox_id}),[]);
});
