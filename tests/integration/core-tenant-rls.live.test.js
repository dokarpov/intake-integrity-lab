import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PostgresSalesIntegrity} from '../../src/sales-integrity/postgres-integrity.js';

const migration=file=>readFileSync(new URL('../../infra/postgres/migrations/'+file,import.meta.url),'utf8');
const secret='ci-only-fingerprint-secret-32-character-minimum';
const tables=[
 'sales_identity_people','sales_person_identifiers','sales_incoming_enquiries',
 'sales_intake_candidates','sales_person_relationships','sales_intake_decisions',
 'sales_intake_audit_events','sales_crm_outbox_v2','sales_crm_outbox_events'
];

test('restricted PostgreSQL role cannot cross tenant boundary in core intake and CRM outbox',
 {skip:!process.env.TEST_DATABASE_URL},async()=>{
  const {Pool}=await import('pg');
  const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:3});
  const suffix=randomUUID().replaceAll('-','').slice(0,20);
  const role='intake_rls_ci_'+suffix,password=randomUUID();
  const a='org_a_'+suffix,b='org_b_'+suffix;
  let restricted;
  try{
    await admin.query(migration('003_sales_integrity.sql'));
    await admin.query(migration('008_core_sales_rls.sql'));
    await admin.query('CREATE ROLE '+role+' LOGIN PASSWORD '+"'"+password+"'");
    await admin.query('GRANT USAGE ON SCHEMA public TO '+role);
    await admin.query('GRANT SELECT, INSERT, UPDATE ON '+tables.join(',')+' TO '+role);
    const dburl=new URL(process.env.TEST_DATABASE_URL);
    dburl.username=role;dburl.password=password;
    restricted=new Pool({connectionString:dburl.toString(),max:2});
    const roleInfo=await restricted.query(`SELECT r.rolsuper,r.rolbypassrls,
      current_user AS runtime_user
      FROM pg_roles r WHERE r.rolname=current_user`);
    assert.equal(roleInfo.rows[0].rolsuper,false);
    assert.equal(roleInfo.rows[0].rolbypassrls,false);
    const policyInfo=await restricted.query(`SELECT tablename,rowsecurity
      FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1::text[])`,[tables]);
    assert.equal(policyInfo.rows.length,tables.length);
    assert.ok(policyInfo.rows.every(row=>row.rowsecurity),'all nine core tables have RLS');

    const engine=new PostgresSalesIntegrity({pool:restricted,fingerprintSecret:secret});
    const make=async(tenant,key)=>engine.receiveEnquiry({
      tenantId:tenant,source:'ci-form',sourceEventKey:key,displayName:'Example Customer',
      identifier:{kind:'email',value:'example@example.test'},actorId:'ci-actor',
      consentEvidenceRef:'ci-fictional-consent',context:{message:'Synthetic only'}
    });
    const aIntake=await make(a,'event-a');
    const bIntake=await make(b,'event-b');
    assert.equal((await engine.listIntakes({tenantId:a})).length,1);
    assert.equal((await engine.listIntakes({tenantId:b})).length,1);
    assert.equal(await engine.getIntake({tenantId:b,intakeId:aIntake.intakeId}),null);
    const decision=await engine.decideEnquiry({
      tenantId:a,intakeId:aIntake.intakeId,requestKey:'decision-a',
      action:'create_new',actorId:'ci-reviewer',reason:'Verified by independent test fixture',
      identityEvidenceRef:'ci-identity-proof',consentEvidenceRef:'ci-fictional-consent'
    });
    assert.equal((await engine.outboxForIntake({tenantId:a,intakeId:aIntake.intakeId})).length,1);
    assert.deepEqual(await engine.outboxForIntake({tenantId:b,intakeId:aIntake.intakeId}),[]);
    assert.deepEqual(await engine.deliveryHistory({tenantId:b,outboxId:decision.delivery.outbox_id}),[]);
    assert.equal((await engine.history({tenantId:a,intakeId:aIntake.intakeId})).integrityOk,true);
    assert.equal((await engine.listPeople({tenantId:a})).length,1);
    assert.equal((await engine.listPeople({tenantId:b})).length,0);

    for(const table of tables){
      const outside=await restricted.query('SELECT count(*)::int AS n FROM '+table);
      assert.equal(outside.rows[0].n,0,table+' must deny unscoped reads');
    }
    const conn=await restricted.connect();
    try{
      await conn.query('BEGIN');
      await conn.query("SELECT set_config('intake.tenant_id',$1,true)",[b]);
      for(const table of tables){
        const rows=await conn.query('SELECT count(*)::int AS n FROM '+table+' WHERE tenant_id=$1',[a]);
        assert.equal(rows.rows[0].n,0,'B cannot read A in '+table);
      }
      const forged=await conn.query('UPDATE sales_incoming_enquiries SET display_name=$1 WHERE tenant_id=$2',
        ['Cross-org alteration',a]);
      assert.equal(forged.rowCount,0);
      await assert.rejects(()=>conn.query(
        'INSERT INTO sales_identity_people(tenant_id,person_id,display_name) VALUES($1,$2,$3)',
        [a,randomUUID(),'Cross-org insertion']),err=>err.code==='42501');
      await conn.query('ROLLBACK');
    }finally{conn.release()}
    const noLeak=await restricted.query('SELECT count(*)::int AS n FROM sales_incoming_enquiries');
    assert.equal(noLeak.rows[0].n,0,'pooled context is reset after transaction');
    assert.equal((await engine.getIntake({tenantId:a,intakeId:aIntake.intakeId})).name,'Example Customer');
    assert.equal((await engine.getIntake({tenantId:b,intakeId:bIntake.intakeId})).name,'Example Customer');
  }finally{
    if(restricted)await restricted.end();
    await admin.end();
  }
});
