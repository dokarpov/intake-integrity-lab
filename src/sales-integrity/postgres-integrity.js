import { createHash,createHmac,randomUUID } from 'node:crypto';

const uuid=()=>randomUUID();
const required=(s,name,max=240)=>{
  if(typeof s!=='string'||!s.trim()||s.length>max)throw new Error(name+'_required_or_invalid');
  return s.trim();
};
const sorted=x=>Array.isArray(x)?x.map(sorted):x&&typeof x==='object'&&Object.getPrototypeOf(x)===Object.prototype
  ?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;
const canonical=x=>JSON.stringify(sorted(x));
const hash=x=>createHash('sha256').update(x).digest('hex');
const isObject=x=>x&&typeof x==='object'&&!Array.isArray(x);
const ALLOWED_KINDS=new Set(['email','phone','external']);
const normalize=(kind,value)=>{
  if(!ALLOWED_KINDS.has(kind))throw new Error('invalid_identifier_kind');
  const v=required(value,'identifier',254);
  if(kind==='email'){
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))throw new Error('invalid_email_identifier');
    return v.toLowerCase();
  }
  if(kind==='phone'){
    const number=v.replace(/[\s().-]/g,'');
    if(!/^\+[1-9]\d{7,14}$/.test(number))throw new Error('international_phone_required');
    return number;
  }
  return v;
};
const guardJson=(value)=>{
  if(!isObject(value))throw new Error('json_object_required');
  for(const [key,val] of Object.entries(value)){
    if(/^(authorization|cookie|set-cookie|password|access[_-]?token|api[_-]?key|client[_-]?secret)$/i.test(key)){
      throw new Error('credentials_not_allowed_in_payload');
    }
    if(isObject(val))guardJson(val);
    if(Array.isArray(val))val.filter(isObject).forEach(guardJson);
  }
};

/**
 * Opt-in PostgreSQL lifecycle. Does not replace legacy API/outbox.
 * A match is candidate evidence, never an implicit person merge.
 * Business decisions require an authenticated actor and evidence reference.
 * CRM side effects happen OUTSIDE database transactions.
 */
export class PostgresSalesIntegrity {
  constructor({pool,fingerprintSecret,now=()=>new Date().toISOString()}={}){
    if(!pool)throw new Error('postgres_pool_required');
    if(typeof fingerprintSecret!=='string'||fingerprintSecret.length<32)
      throw new Error('hmac_secret_minimum_32_chars_required');
    Object.assign(this,{pool,now,secret:fingerprintSecret});
  }
  fingerprint(tenantId,kind,value){
    return createHmac('sha256',this.secret).update(
      canonical([required(tenantId,'tenant_id'),kind,normalize(kind,value)])).digest('hex');
  }
  async transaction(tenantId,fn){
    required(tenantId,'tenant_id');
    const c=await this.pool.connect();
    try{
      await c.query('BEGIN');
      // Transaction local: never reuse tenant context from a pooled connection.
      // The caller tenant is derived from verified API membership or an
      // authenticated server-owned worker job, not browser JSON.
      await c.query("SELECT set_config('intake.tenant_id',$1,true)",[tenantId]);
      await c.query("SET LOCAL lock_timeout = '5s'");
      const result=await fn(c);
      await c.query('COMMIT');
      return result;
    }catch(e){try{await c.query('ROLLBACK')}catch{}throw e}
    finally{c.release()}
  }
  async queryAsTenant(tenantId,sql,params){
    return this.transaction(tenantId,c=>c.query(sql,params));
  }
  // Every caller must lock the parent intake row (or own its new insertion).
  async auditIntake(c,{tenantId,intakeId,actorId,action,metadata={}}){
    const q=await c.query(
      'SELECT sequence,event_hash FROM sales_intake_audit_events WHERE tenant_id=$1 AND intake_id=$2 ORDER BY sequence DESC LIMIT 1',
      [tenantId,intakeId]);
    const last=q.rows[0],sequence=last?Number(last.sequence)+1:1;
    const event={tenantId,intakeId,sequence,previousHash:last?.event_hash||null,
      eventId:uuid(),actorId,action,metadata,createdAt:this.now()};
    const digest=hash(canonical(event));
    await c.query(`INSERT INTO sales_intake_audit_events
      (tenant_id,intake_id,sequence,event_id,previous_hash,event_hash,actor_id,action,metadata_json,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
      [tenantId,intakeId,sequence,event.eventId,event.previousHash,digest,actorId,action,
        JSON.stringify(metadata),event.createdAt]);
    return {sequence,eventHash:digest};
  }
  // Caller locks the outbox row FOR UPDATE to serialize its event sequence.
  async auditDelivery(c,{tenantId,outboxId,actorId,action,details={}}){
    const q=await c.query(
      'SELECT COALESCE(max(sequence),0)::int AS n FROM sales_crm_outbox_events WHERE tenant_id=$1 AND outbox_id=$2',
      [tenantId,outboxId]);
    await c.query(`INSERT INTO sales_crm_outbox_events
      (tenant_id,outbox_id,sequence,actor_id,action,details_json)
      VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
      [tenantId,outboxId,q.rows[0].n+1,actorId,action,JSON.stringify(details)]);
  }
  // Connector/import path. Separate people may legitimately share an email.
  async registerPerson({tenantId,name,kind,value,sourceRef,evidenceRef,actorId}){
    required(tenantId,'tenant_id');required(name,'name',200);
    required(sourceRef,'source_ref');required(evidenceRef,'evidence_ref');required(actorId,'actor_id');
    const fingerprint=this.fingerprint(tenantId,kind,value),personId=uuid();
    return this.transaction(tenantId,async c=>{
      await c.query('INSERT INTO sales_identity_people(tenant_id,person_id,display_name) VALUES($1,$2,$3)',
        [tenantId,personId,name.trim()]);
      await c.query(`INSERT INTO sales_person_identifiers
        (tenant_id,person_id,kind,fingerprint,source_ref,evidence_ref)
        VALUES($1,$2,$3,$4,$5,$6)`,
        [tenantId,personId,kind,fingerprint,sourceRef,evidenceRef]);
      return {tenantId,personId,name:name.trim()};
    });
  }
  async receiveEnquiry({tenantId,source,sourceEventKey,displayName,identifier,
    context={},consentEvidenceRef=null,actorId}){
    required(tenantId,'tenant_id');required(source,'source');required(sourceEventKey,'source_event_key',200);
    required(displayName,'display_name',200);required(actorId,'actor_id');
    if(!identifier||!isObject(context))throw new Error('identifier_and_context_required');
    guardJson(context);
    const kind=identifier.kind,fingerprint=this.fingerprint(tenantId,kind,identifier.value);
    const digest=hash(canonical({source,sourceEventKey,displayName,kind,fingerprint,context,consentEvidenceRef}));
    const intakeId=uuid();
    return this.transaction(tenantId,async c=>{
      const insert=await c.query(`INSERT INTO sales_incoming_enquiries
        (tenant_id,intake_id,source,source_event_key,payload_digest,contact_kind,contact_fingerprint,
         display_name,context_json,consent_evidence_ref)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
        ON CONFLICT(tenant_id,source,source_event_key) DO NOTHING RETURNING *`,
        [tenantId,intakeId,source,sourceEventKey,digest,kind,fingerprint,displayName,JSON.stringify(context),consentEvidenceRef]);
      if(!insert.rows.length){
        const old=await c.query(`SELECT * FROM sales_incoming_enquiries
          WHERE tenant_id=$1 AND source=$2 AND source_event_key=$3 FOR UPDATE`,
          [tenantId,source,sourceEventKey]);
        if(old.rows[0]?.payload_digest!==digest)throw new Error('idempotency_key_payload_conflict');
        const count=await c.query(
          'SELECT count(*)::int AS n FROM sales_intake_candidates WHERE tenant_id=$1 AND intake_id=$2',
          [tenantId,old.rows[0].intake_id]);
        return {tenantId,intakeId:old.rows[0].intake_id,state:old.rows[0].processing_state,
          candidateCount:count.rows[0].n,replayed:true};
      }
      await this.auditIntake(c,{tenantId,intakeId,actorId,action:'intake.received',
        metadata:{source,sourceEventKey,kind,consentReferencePresent:Boolean(consentEvidenceRef)}});
      const matches=await c.query(`SELECT DISTINCT p.person_id FROM sales_person_identifiers i
        JOIN sales_identity_people p ON p.tenant_id=i.tenant_id AND p.person_id=i.person_id
        WHERE i.tenant_id=$1 AND i.kind=$2 AND i.fingerprint=$3 ORDER BY p.person_id`,
        [tenantId,kind,fingerprint]);
      for(const p of matches.rows){
        await c.query(`INSERT INTO sales_intake_candidates(tenant_id,intake_id,person_id,match_reasons)
          VALUES($1,$2,$3,$4::jsonb)`,
          [tenantId,intakeId,p.person_id,JSON.stringify([{kind,signal:'shared_identifier',identityVerified:false}])]);
      }
      const state=matches.rows.length?'review_needed':'received';
      await c.query(
        'UPDATE sales_incoming_enquiries SET processing_state=$3 WHERE tenant_id=$1 AND intake_id=$2',
        [tenantId,intakeId,state]);
      await this.auditIntake(c,{tenantId,intakeId,actorId:'integrity-engine',
        action:'identity.candidates_evaluated',metadata:{count:matches.rows.length,automaticMerge:false}});
      return {tenantId,intakeId,state,candidateCount:matches.rows.length,replayed:false};
    });
  }

  // Read-only projections for the authenticated staging console.
  // Do not expose raw identifier fingerprints or payload secrets.
  async listIntakes({tenantId,limit=50}={}){
    required(tenantId,'tenant_id');
    if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('invalid_list_limit');
    const q=await this.queryAsTenant(tenantId,
      `SELECT i.intake_id,i.display_name,i.source,i.source_event_key,
        i.processing_state,i.created_at,
        (SELECT count(*)::int FROM sales_intake_candidates c
         WHERE c.tenant_id=i.tenant_id AND c.intake_id=i.intake_id) AS candidate_count,
        d.action AS decision_action,d.person_id AS selected_person_id,
        o.state AS delivery_state
       FROM sales_incoming_enquiries i
       LEFT JOIN sales_intake_decisions d
         ON d.tenant_id=i.tenant_id AND d.intake_id=i.intake_id
       LEFT JOIN sales_crm_outbox_v2 o
         ON o.tenant_id=i.tenant_id AND o.intake_id=i.intake_id
       WHERE i.tenant_id=$1 ORDER BY i.created_at DESC,i.intake_id DESC LIMIT $2`,
      [tenantId,limit]
    );
    return q.rows.map(r=>({
      intakeId:r.intake_id,name:r.display_name,source:r.source,
      sourceEventKey:r.source_event_key,state:r.processing_state,
      candidateCount:r.candidate_count,decisionAction:r.decision_action,
      selectedPersonId:r.selected_person_id,deliveryState:r.delivery_state,
      createdAt:r.created_at
    }));
  }
  async getIntake({tenantId,intakeId}={}){
    required(tenantId,'tenant_id');required(intakeId,'intake_id');
    const q=await this.queryAsTenant(tenantId,
      `SELECT i.intake_id,i.display_name,i.source,i.source_event_key,
        i.context_json,i.processing_state,i.consent_evidence_ref,i.created_at,
        d.action AS decision_action,d.person_id AS selected_person_id,
        d.actor_id AS decision_actor,d.reason AS decision_reason,
        d.policy_version AS decision_policy_version,
        d.identity_evidence_ref AS decision_evidence_ref
       FROM sales_incoming_enquiries i
       LEFT JOIN sales_intake_decisions d
         ON d.tenant_id=i.tenant_id AND d.intake_id=i.intake_id
       WHERE i.tenant_id=$1 AND i.intake_id=$2`,
      [tenantId,intakeId]
    );
    const r=q.rows[0];
    if(!r)return null;
    return {intakeId:r.intake_id,name:r.display_name,source:r.source,
      sourceEventKey:r.source_event_key,context:r.context_json,
      state:r.processing_state,consentReferencePresent:Boolean(r.consent_evidence_ref),
      createdAt:r.created_at,
      decision:r.decision_action?{action:r.decision_action,personId:r.selected_person_id,
        actorId:r.decision_actor,reason:r.decision_reason,
        policyVersion:r.decision_policy_version,
        identityEvidenceRef:r.decision_evidence_ref}:null};
  }
  async listPeople({tenantId,limit=100}={}){
    required(tenantId,'tenant_id');
    if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('invalid_list_limit');
    const q=await this.queryAsTenant(tenantId,
      `SELECT p.person_id,p.display_name,p.created_at,
        count(i.identifier_id)::int AS identifier_count
       FROM sales_identity_people p LEFT JOIN sales_person_identifiers i
       ON i.tenant_id=p.tenant_id AND i.person_id=p.person_id
       WHERE p.tenant_id=$1 GROUP BY p.tenant_id,p.person_id
       ORDER BY p.created_at DESC,p.person_id DESC LIMIT $2`,
      [tenantId,limit]
    );
    return q.rows.map(r=>({personId:r.person_id,name:r.display_name,
      identifierCount:r.identifier_count,createdAt:r.created_at}));
  }

  async candidates({tenantId,intakeId}){
    required(tenantId,'tenant_id');required(intakeId,'intake_id');
    const q=await this.queryAsTenant(tenantId,`SELECT p.person_id,p.display_name,c.match_reasons
      FROM sales_intake_candidates c
      JOIN sales_identity_people p ON p.tenant_id=c.tenant_id AND p.person_id=c.person_id
      WHERE c.tenant_id=$1 AND c.intake_id=$2 ORDER BY p.display_name,p.person_id`,
      [tenantId,intakeId]);
    return q.rows.map(r=>({personId:r.person_id,name:r.display_name,signals:r.match_reasons}));
  }
  async decideEnquiry({tenantId,intakeId,requestKey,action,personId=null,actorId,reason,
    identityEvidenceRef,consentEvidenceRef=null,policyVersion='identity-check-v1',destination='crm'}){
    for(const [k,v] of Object.entries({tenantId,intakeId,requestKey,actorId,reason,identityEvidenceRef,policyVersion}))
      required(v,k,k==='reason'?4000:(k==='identityEvidenceRef'?1600:240));
    if(reason.trim().length<8)throw new Error('reason_too_short');
    if(!['link_existing','create_new','discard'].includes(action))throw new Error('invalid_decision_action');
    if(action==='link_existing')required(personId,'selected_candidate');
    else if(personId!==null)throw new Error('person_selection_not_allowed');
    if(action!=='discard')required(destination,'destination');
    const digest=hash(canonical({intakeId,action,personId,actorId,reason,
      identityEvidenceRef,consentEvidenceRef,policyVersion,destination}));
    return this.transaction(tenantId,async c=>{
      const q=await c.query(
        'SELECT * FROM sales_incoming_enquiries WHERE tenant_id=$1 AND intake_id=$2 FOR UPDATE',
        [tenantId,intakeId]);
      const intake=q.rows[0];if(!intake)throw new Error('enquiry_not_found');
      const already=await c.query(
        'SELECT * FROM sales_intake_decisions WHERE tenant_id=$1 AND intake_id=$2',
        [tenantId,intakeId]);
      if(already.rows.length){
        const decision=already.rows[0];
        if(decision.request_key!==requestKey||decision.request_digest!==digest)
          throw new Error('enquiry_already_decided');
        const oldOutbox=await c.query(`SELECT outbox_id,state,operation_key
          FROM sales_crm_outbox_v2 WHERE tenant_id=$1 AND intake_id=$2`,[tenantId,intakeId]);
        return {intakeId,decisionId:decision.decision_id,personId:decision.person_id,
          action:decision.action,delivery:oldOutbox.rows[0]||null,replayed:true};
      }
      let selected=personId;
      if(action==='link_existing'){
        const candidates=await c.query(`SELECT 1 FROM sales_intake_candidates
          WHERE tenant_id=$1 AND intake_id=$2 AND person_id=$3`,[tenantId,intakeId,personId]);
        if(!candidates.rows.length)throw new Error('person_not_in_candidate_evidence');
      }
      const consent=consentEvidenceRef||intake.consent_evidence_ref;
      if(action!=='discard'&&(!consent||!String(consent).trim()))
        throw new Error('consent_evidence_required_for_delivery');
      if(action==='create_new'){
        selected=uuid();
        await c.query('INSERT INTO sales_identity_people(tenant_id,person_id,display_name) VALUES($1,$2,$3)',
          [tenantId,selected,intake.display_name]);
        await c.query(`INSERT INTO sales_person_identifiers
          (tenant_id,person_id,kind,fingerprint,source_ref,evidence_ref)
          VALUES($1,$2,$3,$4,$5,$6)`,
          [tenantId,selected,intake.contact_kind,intake.contact_fingerprint,
            'enquiry:'+intakeId,identityEvidenceRef]);
      }
      const decisionId=uuid();
      await c.query(`INSERT INTO sales_intake_decisions
        (tenant_id,decision_id,intake_id,request_key,request_digest,action,person_id,actor_id,
         reason,identity_evidence_ref,consent_evidence_ref,policy_version)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [tenantId,decisionId,intakeId,requestKey,digest,action,selected,actorId,
          reason,identityEvidenceRef,consent||null,policyVersion]);
      await c.query(
        'UPDATE sales_incoming_enquiries SET processing_state=$3 WHERE tenant_id=$1 AND intake_id=$2',
        [tenantId,intakeId,action==='discard'?'discarded':'resolved']);
      await this.auditIntake(c,{tenantId,intakeId,actorId,action:'intake.decision_recorded',
        metadata:{decisionId,action,personId:selected,policyVersion,evidenceRef:identityEvidenceRef,
          consentReferencePresent:Boolean(consent)}});
      let delivery=null;
      if(action!=='discard'){
        const operationKey=hash(canonical([tenantId,intakeId,destination,'one-enquiry-v1']));
        const request={operationKey,intakeId,personId:selected,decisionId,
          source:intake.source,originalSourceKey:intake.source_event_key,
          context:intake.context_json,consentEvidenceRef:consent,identityEvidenceRef};
        guardJson(request);
        const outboxId=uuid();
        const out=await c.query(`INSERT INTO sales_crm_outbox_v2
          (tenant_id,outbox_id,intake_id,destination,operation_key,request_json)
          VALUES($1,$2,$3,$4,$5,$6::jsonb)
          RETURNING outbox_id,state,operation_key`,
          [tenantId,outboxId,intakeId,destination,operationKey,JSON.stringify(request)]);
        delivery=out.rows[0];
        await this.auditDelivery(c,{tenantId,outboxId,actorId,
          action:'delivery.enqueued',details:{intakeId,destination,operationKey}});
      }
      return {intakeId,decisionId,personId:selected,action,delivery,replayed:false};
    });
  }
  async relatePeople({tenantId,intakeId,fromPersonId,toPersonId,relationType,actorId,evidenceRef}){
    for(const [k,v] of Object.entries({tenantId,intakeId,fromPersonId,toPersonId,relationType,actorId,evidenceRef}))
      required(v,k);
    if(!['colleague','household','authorized_representative','same_organization','other'].includes(relationType))
      throw new Error('relationship_type_not_supported');
    if(fromPersonId===toPersonId)throw new Error('relationship_requires_two_people');
    return this.transaction(tenantId,async c=>{
      const intake=await c.query(
        'SELECT intake_id FROM sales_incoming_enquiries WHERE tenant_id=$1 AND intake_id=$2 FOR UPDATE',
        [tenantId,intakeId]);
      if(!intake.rows.length)throw new Error('enquiry_not_found');
      const d=await c.query(
        'SELECT person_id FROM sales_intake_decisions WHERE tenant_id=$1 AND intake_id=$2',
        [tenantId,intakeId]);
      if(!d.rows.length||![fromPersonId,toPersonId].includes(d.rows[0].person_id))
        throw new Error('relationship_must_include_decided_person');
      const relationId=uuid();
      const ins=await c.query(`INSERT INTO sales_person_relationships
        (tenant_id,relation_id,from_person_id,to_person_id,relation_type,intake_id,asserted_by,evidence_ref)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT(tenant_id,from_person_id,to_person_id,relation_type,intake_id)
        DO NOTHING RETURNING relation_id`,
        [tenantId,relationId,fromPersonId,toPersonId,relationType,intakeId,actorId,evidenceRef]);
      if(!ins.rows.length)throw new Error('relationship_already_recorded');
      await this.auditIntake(c,{tenantId,intakeId,actorId,
        action:'person.relationship_asserted',
        metadata:{relationId,relationType,fromPersonId,toPersonId,evidenceRef}});
      return {tenantId,intakeId,relationId,fromPersonId,toPersonId,relationType};
    });
  }
  async claimDeliveries({tenantId,destination,workerId,limit=10,leaseSeconds=120,outboxId=null}){
    required(tenantId,'tenant_id');required(destination,'destination');required(workerId,'worker_id');
    if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('invalid_claim_limit');
    if(!Number.isInteger(leaseSeconds)||leaseSeconds<30||leaseSeconds>900)
      throw new Error('invalid_lease_seconds');
    return this.transaction(tenantId,async c=>{
      const q=await c.query(`SELECT * FROM sales_crm_outbox_v2
        WHERE tenant_id=$1 AND destination=$2 AND state IN ('pending','retry')
          AND next_attempt_at<=clock_timestamp()
          AND ($4::uuid IS NULL OR outbox_id=$4)
        ORDER BY next_attempt_at,created_at
        LIMIT $3 FOR UPDATE SKIP LOCKED`,
        [tenantId,destination,limit,outboxId]);
      const result=[];
      for(const row of q.rows){
        const leaseToken=uuid();
        await c.query(`UPDATE sales_crm_outbox_v2 SET state='claimed',lease_token=$3,
          leased_at=clock_timestamp(),lease_until=clock_timestamp()+($4::int*interval '1 second'),
          attempts=attempts+1 WHERE tenant_id=$1 AND outbox_id=$2`,
          [tenantId,row.outbox_id,leaseToken,leaseSeconds]);
        await this.auditDelivery(c,{tenantId,outboxId:row.outbox_id,actorId:workerId,
          action:'delivery.claimed',details:{attempt:row.attempts+1}});
        result.push({tenantId,outboxId:row.outbox_id,destination,leaseToken,
          operationKey:row.operation_key,request:row.request_json,attempt:row.attempts+1});
      }
      return result;
    });
  }
  async expireUnacknowledged({tenantId,actorId='lease-reaper',limit=50}){
    required(tenantId,'tenant_id');required(actorId,'actor_id');
    if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('invalid_claim_limit');
    return this.transaction(tenantId,async c=>{
      const due=await c.query(`SELECT outbox_id FROM sales_crm_outbox_v2
        WHERE tenant_id=$1 AND state='claimed' AND lease_until<clock_timestamp()
        ORDER BY lease_until LIMIT $2 FOR UPDATE SKIP LOCKED`,
        [tenantId,limit]);
      for(const row of due.rows){
        await c.query(`UPDATE sales_crm_outbox_v2 SET state='needs_reconciliation',
          lease_token=NULL,lease_until=NULL,last_reason='lease_expired_outcome_unknown'
          WHERE tenant_id=$1 AND outbox_id=$2`,[tenantId,row.outbox_id]);
        await this.auditDelivery(c,{tenantId,outboxId:row.outbox_id,actorId,
          action:'delivery.uncertain',details:{reason:'expired_lease_no_confirmation'}});
      }
      return due.rows.length;
    });
  }
  async settleDelivery({tenantId,outboxId,leaseToken,actorId,outcome,
    externalRecordRef=null,receiptRef=null,reason='provider_response'}){
    for(const [k,v] of Object.entries({tenantId,outboxId,leaseToken,actorId,reason}))required(v,k);
    if(!['confirmed_delivered','confirmed_not_sent','uncertain'].includes(outcome))
      throw new Error('invalid_delivery_outcome');
    if(outcome==='confirmed_delivered'){
      required(externalRecordRef,'external_record_ref');
      required(receiptRef,'receipt_ref');
    }
    return this.transaction(tenantId,async c=>{
      const q=await c.query(
        'SELECT * FROM sales_crm_outbox_v2 WHERE tenant_id=$1 AND outbox_id=$2 FOR UPDATE',
        [tenantId,outboxId]);
      const row=q.rows[0];if(!row)throw new Error('outbox_not_found');
      if(row.state!=='claimed'||row.lease_token!==leaseToken)throw new Error('delivery_lease_conflict');
      const state=outcome==='confirmed_delivered'?'succeeded':
        outcome==='confirmed_not_sent'?'retry':'needs_reconciliation';
      await c.query(`UPDATE sales_crm_outbox_v2 SET state=$3,lease_token=NULL,lease_until=NULL,
        last_reason=$4,external_record_ref=CASE WHEN $3='succeeded' THEN $5 ELSE external_record_ref END,
        receipt_ref=CASE WHEN $3='succeeded' THEN $6 ELSE receipt_ref END,
        completed_at=CASE WHEN $3='succeeded' THEN clock_timestamp() ELSE completed_at END,
        next_attempt_at=CASE WHEN $3='retry' THEN clock_timestamp()+interval '30 seconds'
                            ELSE next_attempt_at END
        WHERE tenant_id=$1 AND outbox_id=$2`,
        [tenantId,outboxId,state,reason,externalRecordRef,receiptRef]);
      await this.auditDelivery(c,{tenantId,outboxId,actorId,
        action:'delivery.'+outcome,details:{state,reason,receiptPresent:Boolean(receiptRef)}});
      return {tenantId,outboxId,state,operationKey:row.operation_key};
    });
  }
  async reconcileDelivery({tenantId,outboxId,actorId,result,evidenceRef,externalRecordRef=null}){
    for(const [k,v] of Object.entries({tenantId,outboxId,actorId,evidenceRef}))required(v,k);
    if(!['found','confirmed_absent'].includes(result))throw new Error('invalid_reconciliation_result');
    if(result==='found')required(externalRecordRef,'external_record_ref');
    return this.transaction(tenantId,async c=>{
      const q=await c.query(
        'SELECT * FROM sales_crm_outbox_v2 WHERE tenant_id=$1 AND outbox_id=$2 FOR UPDATE',
        [tenantId,outboxId]);
      const row=q.rows[0];if(!row)throw new Error('outbox_not_found');
      if(row.state!=='needs_reconciliation')throw new Error('reconciliation_not_required');
      const state=result==='found'?'succeeded':'retry';
      await c.query(`UPDATE sales_crm_outbox_v2 SET state=$3,
        last_reason='reconciled_'||$4,
        external_record_ref=CASE WHEN $3='succeeded' THEN $5 ELSE external_record_ref END,
        receipt_ref=CASE WHEN $3='succeeded' THEN $6 ELSE receipt_ref END,
        completed_at=CASE WHEN $3='succeeded' THEN clock_timestamp() ELSE completed_at END,
        next_attempt_at=CASE WHEN $3='retry' THEN clock_timestamp() ELSE next_attempt_at END
        WHERE tenant_id=$1 AND outbox_id=$2`,
        [tenantId,outboxId,state,result,externalRecordRef,evidenceRef]);
      await this.auditDelivery(c,{tenantId,outboxId,actorId,
        action:'delivery.reconciled',details:{result,state,evidenceRef}});
      return {tenantId,outboxId,state,operationKey:row.operation_key};
    });
  }
  async history({tenantId,intakeId}){
    required(tenantId,'tenant_id');required(intakeId,'intake_id');
    const q=await this.queryAsTenant(tenantId,`SELECT sequence,event_id,previous_hash,event_hash,action,actor_id,
      metadata_json,created_at FROM sales_intake_audit_events
      WHERE tenant_id=$1 AND intake_id=$2 ORDER BY sequence`,[tenantId,intakeId]);
    let prev=null;let n=0;
    const events=q.rows.map(r=>({sequence:Number(r.sequence),eventId:r.event_id,
      previousHash:r.previous_hash,eventHash:r.event_hash,action:r.action,actorId:r.actor_id,
      metadata:r.metadata_json,createdAt:new Date(r.created_at).toISOString()}));
    const integrityOk=events.every(e=>{
      const digest=hash(canonical({tenantId,intakeId,sequence:e.sequence,previousHash:e.previousHash,
        eventId:e.eventId,actorId:e.actorId,action:e.action,metadata:e.metadata,createdAt:e.createdAt}));
      const correct=e.sequence===++n&&e.previousHash===prev&&e.eventHash===digest;
      prev=e.eventHash;return correct;
    });
    return {events,integrityOk};
  }
  async relationshipsFor({tenantId,personId}){
    required(tenantId,'tenant_id');required(personId,'person_id');
    const q=await this.queryAsTenant(tenantId,`SELECT relation_id,from_person_id,to_person_id,relation_type,
      intake_id,asserted_by,evidence_ref,created_at
      FROM sales_person_relationships
      WHERE tenant_id=$1 AND (from_person_id=$2 OR to_person_id=$2)
      ORDER BY created_at DESC,relation_id`,[tenantId,personId]);
    return q.rows.map(r=>({relationId:r.relation_id,fromPersonId:r.from_person_id,
      toPersonId:r.to_person_id,relationType:r.relation_type,intakeId:r.intake_id,
      assertedBy:r.asserted_by,evidenceRef:r.evidence_ref,createdAt:r.created_at}));
  }
  async deliveryHistory({tenantId,outboxId}){
    required(tenantId,'tenant_id');required(outboxId,'outbox_id');
    const q=await this.queryAsTenant(tenantId,`SELECT sequence,action,actor_id,details_json,created_at
      FROM sales_crm_outbox_events
      WHERE tenant_id=$1 AND outbox_id=$2 ORDER BY sequence`,[tenantId,outboxId]);
    return q.rows.map(r=>({sequence:Number(r.sequence),action:r.action,
      actorId:r.actor_id,details:r.details_json,createdAt:r.created_at}));
  }
  async outboxForIntake({tenantId,intakeId}){
    required(tenantId,'tenant_id');required(intakeId,'intake_id');
    const q=await this.queryAsTenant(tenantId,`SELECT outbox_id,destination,operation_key,state,attempts,
      external_record_ref,receipt_ref FROM sales_crm_outbox_v2
      WHERE tenant_id=$1 AND intake_id=$2 ORDER BY created_at`,[tenantId,intakeId]);
    return q.rows;
  }
}
