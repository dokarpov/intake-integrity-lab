import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PostgresIntakeCore} from '../../src/intake/postgres-intake-core.js';

const active=Boolean(process.env.TEST_DATABASE_URL);
const prefix=()=>('t'+randomUUID().replaceAll('-',''));
const DEFAULT_SECRET='ci-only-not-for-production-32-bytes-of-randomness';
const makeService=(pool,{deliveryFactory}={})=>new PostgresIntakeCore({
  pool,secret:DEFAULT_SECRET,
  deliveryFactory:deliveryFactory||(({tenantId,intakeId,personId})=>({
    destination:'1c',
    request:{method:'POST',url:'https://sandbox.invalid/1c',
      headers:{Authorization:'Bearer forbidden-to-store','X-Source':'integration-test'},
      body:{tenantId,intakeId,personId},authRef:'test-one-c-credentials'}
  }))
});
const original={source:'website',sourceEventKey:'evt-100',sourceRef:'SRC-100',
  payloadRef:'opaque:encrypted:payload-100',
  identifiers:[{kind:'email',value:'sam@example.com'}]};
async function seed(pool,service,tenant,id,email='sam@example.com',phone=null){
 await pool.query('INSERT INTO sales_persons(tenant_id,id) VALUES($1,$2)',[tenant,id]);
 const rows=[['email',email],...(phone?[['phone',phone]]:[])];
 for(const [kind,value] of rows)
  await pool.query(`INSERT INTO sales_person_identifiers
    (tenant_id,person_id,kind,identifier_token,verified_by_ref)
    VALUES($1,$2,$3,$4,'trusted-crm-import')`,
    [tenant,id,kind,service.identifierToken(tenant,kind,value)]);
}
const decision=(tenantId,intakeId,overrides={})=>({
  tenantId,intakeId,decisionKey:'approved-1',actorRef:'reviewer.a',
  action:'link_existing',personId:'p1',evidenceRef:'review:independent-callback:123',
  reason:'Independent callback confirmed record ownership.',
  ...overrides
});
test('LIVE PostgreSQL: normalized people, identity evidence, atomic decisions and outbox',{skip:!active},async t=>{
 const {Pool}=await import('pg');
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:12});
 const service=makeService(pool);
 try{
  await pool.query(readFileSync(new URL('../../infra/postgres/001_ledger.sql',import.meta.url),'utf8'));
  await pool.query(readFileSync(new URL('../../infra/postgres/migrations/002_service_workflows.sql',import.meta.url),'utf8'));
  const sql=readFileSync(new URL('../../infra/postgres/migrations/003_identity_intake_core.sql',import.meta.url),'utf8');
  await pool.query(sql);
  await pool.query(sql); // migrations must tolerate a repeat in a test sandbox

  await t.test('identifier collisions produce candidates but no automatic merge',async()=>{
    const tenant=prefix();
    await seed(pool,service,tenant,'p1');
    await seed(pool,service,tenant,'p2');
    const received=await service.receive({...original,tenantId:tenant});
    assert.deepEqual(received.candidateIds,['p1','p2']);
    assert.equal(received.state,'needs_review');
    assert.equal(received.personId,null);
    const q=await pool.query(`SELECT COUNT(*)::integer n FROM sales_delivery_outbox
      WHERE tenant_id=$1 AND intake_id=$2`,[tenant,received.id]);
    assert.equal(q.rows[0].n,0);
    const audit=await service.timeline({tenantId:tenant,intakeId:received.id});
    assert.deepEqual(audit.events.map(x=>x.event_type),
      ['intake_received','candidate_evaluated','review_requested']);
    assert.equal(audit.decisions.length,0);
    await assert.rejects(()=>service.resolve(decision(tenant,received.id,
      {consentEvidenceRef:'consent:1',acknowledgePossibleDuplicates:true,personId:'another'})),
      /person_not_in_candidate_set/);
    const candidateCount=await pool.query('SELECT COUNT(*)::integer n FROM sales_intake_candidates WHERE tenant_id=$1 AND intake_id=$2',[tenant,received.id]);
    assert.equal(candidateCount.rows[0].n,2);
    await assert.rejects(()=>service.resolve(decision(tenant,received.id)),
      /consent_evidence_required/);
    const resolved=await service.resolve(decision(tenant,received.id,
      {consentEvidenceRef:'consent:verified:1'}));
    assert.equal(resolved.state,'resolved');
    assert.equal(resolved.personId,'p1');
    assert.equal(resolved.deliveryQueued,true);
    const review=await pool.query(`SELECT status FROM sales_review_items WHERE id=$1`,
      [received.reviewId]);
    assert.equal(review.rows[0].status,'resolved');
    const outbox=await pool.query(`SELECT * FROM sales_delivery_outbox
      WHERE tenant_id=$1 AND intake_id=$2`,[tenant,received.id]);
    assert.equal(outbox.rows.length,1);
    assert.equal(outbox.rows[0].status,'pending');
    assert.equal(outbox.rows[0].request_json.headers.Authorization,undefined);
    assert.equal(outbox.rows[0].request_json.authRef,'test-one-c-credentials');
    const replay=await service.resolve(decision(tenant,received.id,
      {consentEvidenceRef:'consent:verified:1'}));
    assert.equal(replay.replayed,true);
    await assert.rejects(()=>service.resolve(decision(tenant,received.id,
      {consentEvidenceRef:'consent:verified:1',reason:'Different justification for same key'})),
      /idempotency_payload_conflict/);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM sales_delivery_outbox
      WHERE tenant_id=$1 AND intake_id=$2`,[tenant,received.id])).rows[0].n,1);
    await assert.rejects(()=>pool.query(`DELETE FROM sales_intake_decisions
      WHERE tenant_id=$1 AND intake_id=$2`,[tenant,received.id]),/append-only/i);
  });
  await t.test('concurrent replay yields one intake/review, distinct altered payload rejected',async()=>{
    const tenant=prefix();
    const attempts=await Promise.all(Array.from({length:12},()=>service.receive({
      ...original,tenantId:tenant,identifiers:[{kind:'email',value:'SAM@example.COM'}]
    })));
    assert.equal(new Set(attempts.map(x=>x.id)).size,1);
    assert.equal(attempts.filter(x=>x.replayed).length,11);
    const id=attempts[0].id;
    assert.equal((await pool.query(`SELECT count(*)::int n FROM sales_review_items
      WHERE tenant_id=$1 AND intake_id=$2`,[tenant,id])).rows[0].n,1);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM sales_intake_events
      WHERE tenant_id=$1 AND intake_id=$2`,[tenant,id])).rows[0].n,3);
    await assert.rejects(()=>service.receive({...original,tenantId:tenant,
      payloadRef:'opaque:different-payload'}),/idempotency_payload_conflict/);
  });
  await t.test('separate tenants cannot see each others matching people or intake',async()=>{
    const a=prefix(),b=prefix();
    await seed(pool,service,a,'p1','shared@example.com');
    await seed(pool,service,b,'p2','shared@example.com');
    const intake=await service.receive({...original,tenantId:a,identifiers:[
      {kind:'email',value:'shared@example.com'}]});
    assert.deepEqual(intake.candidateIds,['p1']);
    assert.deepEqual((await service.timeline({tenantId:b,intakeId:intake.id})).events,[]);
    await assert.rejects(()=>service.resolve(decision(b,intake.id,{consentEvidenceRef:'consent:verified'})),
      /intake_not_found/);
    await assert.rejects(()=>pool.query(`INSERT INTO sales_person_relationships
      (tenant_id,id,person_id,related_person_id,relation,asserted_by,evidence_ref)
      VALUES($1,$2,$3,$4,'payer','a','evidence')`,
      [a,'relation-fail','p1','p2']),/foreign key/i);
  });
  await t.test('atomic rollback on delivery preparation failure',async()=>{
    const tenant=prefix(),broken=makeService(pool,{deliveryFactory:()=>{throw Error('adapter_fault')}});
    await seed(pool,service,tenant,'p1');
    const intake=await broken.receive({...original,tenantId:tenant,consentEvidenceRef:'consent:1'});
    await assert.rejects(()=>broken.resolve(decision(tenant,intake.id)),/adapter_fault/);
    const q=await pool.query(`SELECT state FROM sales_intakes WHERE tenant_id=$1 AND id=$2`,
      [tenant,intake.id]);
    assert.equal(q.rows[0].state,'needs_review');
    assert.equal((await broken.timeline({tenantId:tenant,intakeId:intake.id})).decisions.length,0);
    assert.equal((await pool.query(`SELECT COUNT(*)::int n FROM sales_delivery_outbox
      WHERE tenant_id=$1 AND intake_id=$2`,[tenant,intake.id])).rows[0].n,0);
    assert.equal((await pool.query(`SELECT status FROM sales_review_items WHERE id=$1`,[intake.reviewId])).rows[0].status,'open');
  });
  await t.test('new person requires duplicate acknowledgement; a discard never queues delivery',async()=>{
    const tenant=prefix();
    await seed(pool,service,tenant,'p1');
    const intake=await service.receive({...original,tenantId:tenant,consentEvidenceRef:'consent:1'});
    const request=decision(tenant,intake.id,{action:'create_person',personId:null});
    await assert.rejects(()=>service.resolve(request),/possible_duplicates_require_acknowledgement/);
    const done=await service.resolve({...request,acknowledgePossibleDuplicates:true});
    assert.ok(done.personId.startsWith('person_'));
    assert.notEqual(done.personId,'p1');
    assert.equal((await pool.query('SELECT count(*)::integer n FROM sales_persons WHERE tenant_id=$1 AND id=$2',[tenant,done.personId])).rows[0].n,1);
    const discardIntake=await service.receive({...original,tenantId:tenant,
      sourceEventKey:'discard-2',consentEvidenceRef:null});
    const dropped=await service.resolve(decision(tenant,discardIntake.id,{
      action:'discard',personId:null,reason:'Source was withdrawn by requester.',
      consentEvidenceRef:null
    }));
    assert.equal(dropped.state,'discarded');
    assert.equal(dropped.deliveryQueued,false);
    assert.equal((await pool.query(`SELECT count(*)::integer n FROM sales_delivery_outbox
      WHERE tenant_id=$1 AND intake_id=$2`,[tenant,discardIntake.id])).rows[0].n,0);
  });
  await t.test('explicit relationship link preserves separate person records',async()=>{
    const tenant=prefix();
    await seed(pool,service,tenant,'p1');
    await seed(pool,service,tenant,'p2');
    const id=await service.addRelationship({tenantId:tenant,personId:'p1',relatedPersonId:'p2',
      relation:'representative',actorRef:'reviewer.a',evidenceRef:'signed:mandate:3'});
    const link=await pool.query(`SELECT * FROM sales_person_relationships WHERE tenant_id=$1 AND id=$2`,
      [tenant,id]);
    assert.equal(link.rows[0].relation,'representative');
    assert.equal((await pool.query('SELECT count(*)::integer n FROM sales_persons WHERE tenant_id=$1',[tenant])).rows[0].n,2);
    await assert.rejects(()=>service.addRelationship({tenantId:tenant,personId:'p1',relatedPersonId:'p1',
      relation:'payer',actorRef:'a',evidenceRef:'b'}),/self_link/);
  });
  await t.test('identifier fingerprint is tenant-bound and rejects local phone guesses',async()=>{
    assert.notEqual(service.identifierToken('tenant-a','email','SAm@example.com'),
      service.identifierToken('tenant-b','email','sam@example.com'));
    assert.equal(service.identifierToken('tenant-a','email',' SAM@example.com '),
      service.identifierToken('tenant-a','email','sam@example.com'));
    assert.throws(()=>service.identifierToken('tenant-a','phone','1234567890'),/requires_e164/);
  });
 }finally{await pool.end()}
});
