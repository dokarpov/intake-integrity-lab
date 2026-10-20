import { createHmac, randomUUID } from 'node:crypto';
import { sanitizeOutboxRequest } from '../delivery/outbox.js';

const required=(v,key,max=250)=>{
  if(typeof v!=='string'||!v.trim()||v.length>max)throw Error(key+'_required');
  return v.trim();
};
const hash=(secret,...parts)=>createHmac('sha256',secret).update(JSON.stringify(parts)).digest('hex');
const normal=(kind,value)=>{
  const v=required(value,kind,254);
  if(kind==='email'){
    const x=v.toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))throw Error('invalid_email');
    return x;
  }
  if(kind==='phone'){
    const x=v.replace(/[\s().-]/g,'');
    if(!/^\+[1-9]\d{6,14}$/.test(x))throw Error('phone_requires_e164');
    return x;
  }
  throw Error('identifier_kind_invalid');
};
const encode=(secret,tenantId,items)=>{
  if(!Array.isArray(items)||!items.length||items.length>12)throw Error('identifiers_required');
  return [...new Map(items.map(({kind,value})=>{
    const token=hash(secret,'identifier-v1',tenantId,kind,normal(kind,value));
    return [kind+token,{kind,token}];
  })).values()].sort((a,b)=>(a.kind+a.token).localeCompare(b.kind+b.token));
};
async function transaction(pool,callback){
  const c=await pool.connect();
  try{
    await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='5s'");
    const result=await callback(c);await c.query('COMMIT');return result;
  }catch(e){try{await c.query('ROLLBACK')}catch{}throw e}
  finally{c.release()}
}
async function event(c,tenantId,intakeId,type,actor,version,detail={}){
  await c.query(`INSERT INTO sales_intake_events
    (tenant_id,id,intake_id,event_type,actor_ref,policy_version,detail_json)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [tenantId,'event_'+randomUUID(),intakeId,type,actor,version,JSON.stringify(detail)]);
}
const view=(r,c=[],replayed=false)=>({
  tenantId:r.tenant_id,id:r.id,source:r.source,sourceRef:r.source_ref,
  state:r.state,personId:r.person_id,reviewId:r.review_id,
  candidateIds:c.map(x=>x.person_id),replayed
});
export class PostgresIntakeCore {
  constructor({pool,secret,deliveryFactory,policyVersion='intake-v1'}={}){
    if(!pool?.connect)throw Error('postgres_pool_required');
    if(typeof secret!=='string'||secret.length<32)throw Error('strong_hmac_secret_required');
    if(typeof deliveryFactory!=='function')throw Error('trusted_delivery_factory_required');
    Object.assign(this,{pool,secret,deliveryFactory,policyVersion});
  }
  identifierToken(tenantId,kind,value){
    required(tenantId,'tenant_id');
    return hash(this.secret,'identifier-v1',tenantId,kind,normal(kind,value));
  }
  async receive({tenantId,source,sourceEventKey,sourceRef,payloadRef,
    consentEvidenceRef=null,identifiers,actorRef='authenticated-source'}={}){
    for(const [k,v,max] of [['tenant_id',tenantId,120],['source',source,100],
      ['source_event_key',sourceEventKey,250],['source_ref',sourceRef,250],
      ['payload_ref',payloadRef,250],['actor_ref',actorRef,160]])required(v,k,max);
    if(consentEvidenceRef!==null)required(consentEvidenceRef,'consent_evidence_ref');
    const tokens=encode(this.secret,tenantId,identifiers);
    const idempotencyToken=hash(this.secret,'intake-key-v1',tenantId,source,sourceEventKey);
    const digest=hash(this.secret,'intake-request-v1',tenantId,source,sourceRef,
      payloadRef,consentEvidenceRef,tokens);
    return transaction(this.pool,async c=>{
      const intakeId='intake_'+randomUUID();
      const inserted=await c.query(`INSERT INTO sales_intakes
       (tenant_id,id,source,source_ref,idempotency_token,request_digest,payload_ref,
        consent_evidence_ref,state)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'needs_review')
       ON CONFLICT (tenant_id,source,idempotency_token) DO NOTHING RETURNING *`,
       [tenantId,intakeId,source,sourceRef,idempotencyToken,digest,payloadRef,consentEvidenceRef]);
      if(!inserted.rows.length){
        const q=await c.query(`SELECT * FROM sales_intakes
          WHERE tenant_id=$1 AND source=$2 AND idempotency_token=$3`,
          [tenantId,source,idempotencyToken]);
        const row=q.rows[0];
        if(!row||row.request_digest!==digest)throw Error('idempotency_payload_conflict');
        const matches=await c.query(`SELECT person_id FROM sales_intake_candidates
          WHERE tenant_id=$1 AND intake_id=$2 ORDER BY person_id`,[tenantId,row.id]);
        return view(row,matches.rows,true);
      }
      const matched=await c.query(`WITH supplied(kind,identifier_token) AS
        (SELECT * FROM unnest($2::text[],$3::text[]))
        SELECT p.person_id,COUNT(*)::integer evidence_count
        FROM sales_person_identifiers p JOIN supplied s
        ON s.kind=p.kind AND s.identifier_token=p.identifier_token
        WHERE p.tenant_id=$1 GROUP BY p.person_id ORDER BY p.person_id`,
        [tenantId,tokens.map(x=>x.kind),tokens.map(x=>x.token)]);
      const people=matched.rows;
      for(const p of people)await c.query(`INSERT INTO sales_intake_candidates
        (tenant_id,intake_id,person_id,evidence_kind,evidence_count)
        VALUES($1,$2,$3,'identifier_overlap',$4)`,
        [tenantId,intakeId,p.person_id,p.evidence_count]);
      const reviewId='review_'+randomUUID();
      const reason=people.length>1?'multiple_possible_people':
        people.length===1?'identifier_overlap_unverified':'new_identity_unverified';
      await c.query(`INSERT INTO sales_review_items
        (id,tenant_id,intake_id,status,reason,candidate_refs,context,priority,queue,
        tags,created_at,sla_due_at,version)
        VALUES($1,$2,$3,'open',$4,$5::jsonb,$6::jsonb,
        'normal','identity','[]'::jsonb,now(),now()+interval '2 hours',1)`,
        [reviewId,tenantId,intakeId,reason,JSON.stringify(people.map(p=>p.person_id)),
          JSON.stringify({source,sourceRef})]);
      await c.query(`UPDATE sales_intakes SET review_id=$3 WHERE tenant_id=$1 AND id=$2`,
        [tenantId,intakeId,reviewId]);
      await event(c,tenantId,intakeId,'intake_received',actorRef,this.policyVersion,{source,sourceRef});
      await event(c,tenantId,intakeId,'candidate_evaluated','system',this.policyVersion,
        {candidateCount:people.length,reason});
      await event(c,tenantId,intakeId,'review_requested','system',this.policyVersion,
        {reviewId,reason});
      return view({...inserted.rows[0],review_id:reviewId},people);
    });
  }
  async resolve({tenantId,intakeId,decisionKey,actorRef,action,personId=null,
    evidenceRef,reason,consentEvidenceRef=null,acknowledgePossibleDuplicates=false}={}){
    for(const [k,v] of [['tenant_id',tenantId],['intake_id',intakeId],
      ['decision_key',decisionKey],['actor_ref',actorRef],['evidence_ref',evidenceRef]])
      required(v,k);
    if(typeof reason!=='string'||reason.trim().length<10||reason.length>1000)
      throw Error('decision_reason_required');
    if(!['link_existing','create_person','discard'].includes(action))
      throw Error('decision_action_invalid');
    if(action==='link_existing')required(personId,'person_id');
    if(action!=='link_existing'&&personId!==null)throw Error('person_id_not_allowed');
    if(consentEvidenceRef!==null)required(consentEvidenceRef,'consent_evidence_ref');
    const token=hash(this.secret,'decision-key-v1',tenantId,intakeId,decisionKey);
    const signature=hash(this.secret,'decision-body-v1',tenantId,intakeId,actorRef,action,
      personId,evidenceRef,reason.trim(),consentEvidenceRef,Boolean(acknowledgePossibleDuplicates));
    return transaction(this.pool,async c=>{
      const q=await c.query(`SELECT * FROM sales_intakes
        WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[tenantId,intakeId]);
      const intake=q.rows[0];if(!intake)throw Error('intake_not_found');
      if(intake.state!=='needs_review'){
        const prev=await c.query(`SELECT * FROM sales_intake_decisions
          WHERE tenant_id=$1 AND intake_id=$2`,[tenantId,intakeId]);
        const d=prev.rows[0];
        if(d?.decision_token===token&&d?.decision_digest===signature)
          return {intakeId,personId:intake.person_id,state:intake.state,replayed:true,
            deliveryQueued:action!=='discard'};
        if(d?.decision_token===token)throw Error('idempotency_payload_conflict');
        throw Error('intake_already_resolved');
      }
      const candidates=await c.query(`SELECT person_id FROM sales_intake_candidates
        WHERE tenant_id=$1 AND intake_id=$2`,[tenantId,intakeId]);
      let selected=null;
      if(action==='link_existing'){
        if(!candidates.rows.some(x=>x.person_id===personId))throw Error('person_not_in_candidate_set');
        selected=personId;
      }
      if(action==='create_person'&&candidates.rows.length&&!acknowledgePossibleDuplicates)
        throw Error('possible_duplicates_require_acknowledgement');
      const consent=consentEvidenceRef||intake.consent_evidence_ref;
      if(action!=='discard'&&!consent)throw Error('consent_evidence_required_before_delivery');
      if(action==='create_person'){
        selected='person_'+randomUUID();
        await c.query(`INSERT INTO sales_persons(tenant_id,id) VALUES($1,$2)`,[tenantId,selected]);
      }
      const state=action==='discard'?'discarded':'resolved';
      await c.query(`INSERT INTO sales_intake_decisions
        (tenant_id,id,intake_id,actor_ref,action,selected_person_id,evidence_ref,reason,
        policy_version,decision_token,decision_digest)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [tenantId,'decision_'+randomUUID(),intakeId,actorRef,action,selected,evidenceRef,
          reason.trim(),this.policyVersion,token,signature]);
      await c.query(`UPDATE sales_intakes SET state=$3,person_id=$4,resolved_at=now(),
        consent_evidence_ref=$5 WHERE tenant_id=$1 AND id=$2`,
        [tenantId,intakeId,state,selected,consent]);
      const review=await c.query(`UPDATE sales_review_items
        SET status='resolved',resolved_at=now(),version=version+1,resolution=$3::jsonb
        WHERE tenant_id=$1 AND id=$2 AND status<>'resolved' RETURNING id`,
        [tenantId,intake.review_id,
          JSON.stringify({actor:actorRef,decision:action,targetRef:selected,
            note:reason.trim(),evidenceRef})]);
      if(review.rowCount!==1)throw Error('review_is_not_open');
      await event(c,tenantId,intakeId,action==='discard'?'intake_discarded':
        action==='create_person'?'person_created':'person_linked',
        actorRef,this.policyVersion,{personId:selected,action,evidenceRef,reason:reason.trim()});
      if(action!=='discard'){
        // Factory is a trusted backend adapter. It must be pure: no network call in TX.
        const config=await this.deliveryFactory({tenantId,intakeId,personId:selected,
          payloadRef:intake.payload_ref,consentEvidenceRef:consent,decisionEvidenceRef:evidenceRef});
        if(!config?.destination||!config.request)throw Error('delivery_factory_invalid');
        const req=sanitizeOutboxRequest(config.request);
        if(typeof req.url!=='string'||!req.url.startsWith('https://'))
          throw Error('delivery_requires_https');
        await c.query(`INSERT INTO sales_delivery_outbox
          (id,tenant_id,intake_id,destination,request_json,status,attempts,next_attempt_at,created_at)
          VALUES($1,$2,$3,$4,$5::jsonb,'pending',0,now(),now())`,
          ['outbox_'+randomUUID(),tenantId,intakeId,config.destination,JSON.stringify(req)]);
        await event(c,tenantId,intakeId,'crm_delivery_queued','system',this.policyVersion,
          {destination:config.destination});
      }
      return {intakeId,personId:selected,state,replayed:false,deliveryQueued:action!=='discard'};
    });
  }
  async addRelationship({tenantId,personId,relatedPersonId,relation,actorRef,evidenceRef}={}){
    for(const [k,v] of [['tenant_id',tenantId],['person_id',personId],
      ['related_person_id',relatedPersonId],['actor_ref',actorRef],['evidence_ref',evidenceRef]])
      required(v,k);
    if(personId===relatedPersonId)throw Error('relationship_self_link_forbidden');
    if(!['representative','payer','colleague','household','other'].includes(relation))
      throw Error('relationship_type_invalid');
    return transaction(this.pool,async c=>{
      const q=await c.query(`INSERT INTO sales_person_relationships
        (tenant_id,id,person_id,related_person_id,relation,asserted_by,evidence_ref)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [tenantId,'relationship_'+randomUUID(),personId,relatedPersonId,relation,actorRef,evidenceRef]);
      return q.rows[0].id;
    });
  }
  async timeline({tenantId,intakeId}={}){
    required(tenantId,'tenant_id');required(intakeId,'intake_id');
    const [e,d]=await Promise.all([
      this.pool.query(`SELECT event_type,actor_ref,policy_version,detail_json,created_at
        FROM sales_intake_events WHERE tenant_id=$1 AND intake_id=$2 ORDER BY created_at,id`,
        [tenantId,intakeId]),
      this.pool.query(`SELECT action,selected_person_id,actor_ref,evidence_ref,reason,
        policy_version,created_at FROM sales_intake_decisions
        WHERE tenant_id=$1 AND intake_id=$2`,[tenantId,intakeId])
    ]);
    return {events:e.rows,decisions:d.rows};
  }
}
