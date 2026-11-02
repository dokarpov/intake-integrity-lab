import test from 'node:test';import assert from 'node:assert/strict';import { readFileSync } from 'node:fs';import { randomUUID } from 'node:crypto';
import { AsyncComplianceLedger } from '../../src/compliance/async-ledger.js';import { PostgresLedgerStore } from '../../src/compliance/storage/postgres-store.js';import { PostgresTeamReviewStore } from '../../src/review/postgres-team-review-store.js';
import { PostgresPendingIntakeStore } from '../../src/review/pending-intake-store.js';
import { sealReviewEnvelope, unsealReviewEnvelope } from '../../src/review/sealed-envelope.js';
const enabled=Boolean(process.env.TEST_DATABASE_URL);
test('LIVE PostgreSQL: concurrent append, immutability trigger and team-review persistence',{skip:!enabled},async()=>{
  const {Pool}=await import('pg');const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:8});
  try{
    await pool.query(readFileSync(new URL('../../infra/postgres/001_ledger.sql',import.meta.url),'utf8'));
    await pool.query(readFileSync(new URL('../../infra/postgres/migrations/002_service_workflows.sql',import.meta.url),'utf8'));
    await pool.query(readFileSync(new URL('../../infra/postgres/migrations/003_pending_intakes.sql',import.meta.url),'utf8'));
    const tenant=`it_${randomUUID().replaceAll('-','')}`,ledgerId=`live:${tenant}`,store=new PostgresLedgerStore({pool}),ledger=new AsyncComplianceLedger({tenantId:tenant,ledgerId,store,strict:true,defaultRetention:{class:'short',policyVersion:'integration'}});
    const event=i=>({eventId:`evt_${tenant}_${i}`,actor:{type:'system',id:'integration-test'},action:'data.created',result:'success',reasonCode:'postgres_live_test',purpose:{code:'integration_test',version:'1'},legalBasis:{basis:'not_applicable',reference:'test'},object:{type:'test_record',ref:String(i)},dataClasses:['audit_metadata']});
    await Promise.all(Array.from({length:25},(_,i)=>ledger.append(event(i))));const integrity=await ledger.verifyIntegrity();assert.equal(integrity.ok,true);assert.equal(integrity.eventCount,25);
    await assert.rejects(()=>pool.query(`UPDATE compliance_ledger_events SET event_result='failure' WHERE ledger_id=$1 AND sequence=1`,[ledgerId]),/append-only|compliance ledger rows/i);
    const reviews=new PostgresTeamReviewStore({pool,tenantId:tenant});const a=await reviews.enqueue({intakeId:'i1',reason:'identity_conflict',candidateRefs:['c1','c2']}),b=await reviews.enqueue({intakeId:'i2',reason:'identity_conflict',candidateRefs:['c3','c4']});const assigned=await reviews.bulkAssign([a.id,b.id],{actor:'manager',assignee:'reviewer.a',reason:'integration_test'});assert.equal(assigned.every(x=>x.assignedTo==='reviewer.a'),true);const claimed=await reviews.claim(a.id,{actor:'reviewer.a'});assert.equal(claimed.status,'in_progress');const resolved=await reviews.resolve(a.id,{actor:'reviewer.a',decision:'create_new',note:'synthetic integration case'});assert.equal(resolved.status,'resolved');
    const now='2026-11-02T12:00:00Z',expiresAt='2026-11-03T12:00:00Z',key=Buffer.alloc(32,41),intakeId='pending-secure',pending=new PostgresPendingIntakeStore({pool,now:()=>now});
    const envelope={intakeId,primaryContact:{email:'test@example.invalid',name:'Synthetic'},consents:{privacy:true,dataProcessing:true}};
    const sealed=sealReviewEnvelope(envelope,{key,tenantId:tenant,intakeId,expiresAt,now});
    await pending.save({tenantId:tenant,intakeId,sealed});
    await assert.rejects(pending.save({tenantId:tenant,intakeId,sealed}),/pending_intake_exists/);
    assert.equal(await pending.get({tenantId:'other-tenant',intakeId}),null);
    const retrieved=await pending.get({tenantId:tenant,intakeId});
    assert.equal(JSON.stringify(retrieved).includes('test@example.invalid'),false);
    assert.deepEqual(unsealReviewEnvelope(retrieved.sealed,{key,tenantId:tenant,intakeId,now}),envelope);
    assert.equal(await pending.consume({tenantId:tenant,intakeId}),true);
    assert.equal(await pending.consume({tenantId:tenant,intakeId}),false);
    assert.equal(await pending.get({tenantId:tenant,intakeId}),null);

  } finally {await pool.end()}
});
