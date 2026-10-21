import {createHash,randomUUID} from 'node:crypto';
/**
 * TESTING-ONLY provider simulator. Writes real PostgreSQL rows instead of
 * pretending a browser result is a CRM receipt. No real CRM network calls.
 */
export class SandboxCrmSimulator {
 constructor({pool,integrity,tenantId='staging-demo'}={}){
  if(process.env.NODE_ENV==='production')throw new Error('sandbox_crm_forbidden_in_production');
  if(!pool?.query||!integrity?.claimDeliveries||!integrity?.settleDelivery)
    throw new Error('sandbox_crm_dependencies_required');
  Object.assign(this,{pool,integrity,tenantId});
 }
 async accept(claim){
  if(claim.tenantId!==this.tenantId||claim.destination!=='crm-simulator')
    throw new Error('sandbox_destination_invalid');
  const payloadDigest=createHash('sha256').update(JSON.stringify(claim.request)).digest('hex');
  const recordRef='sandbox-customer-'+randomUUID();
  const receiptRef='sandbox-receipt-'+randomUUID();
  const row=await this.pool.query(`INSERT INTO sandbox_crm_deliveries
    (tenant_id,operation_key,outbox_id,request_digest,crm_record_ref,receipt_ref)
    VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(tenant_id,operation_key) DO NOTHING
    RETURNING crm_record_ref,receipt_ref,request_digest`,
    [this.tenantId,claim.operationKey,claim.outboxId,payloadDigest,recordRef,receiptRef]);
  if(row.rows.length)return row.rows[0];
  const old=await this.pool.query(`SELECT crm_record_ref,receipt_ref,request_digest
    FROM sandbox_crm_deliveries WHERE tenant_id=$1 AND operation_key=$2`,
    [this.tenantId,claim.operationKey]);
  if(!old.rows.length||old.rows[0].request_digest!==payloadDigest)
    throw new Error('sandbox_operation_reuse_with_conflicting_payload');
  return old.rows[0];
 }
 async runOnce({mode='success',limit=10,outboxId=null}={}){
  if(!['success','lost_ack'].includes(mode))throw new Error('sandbox_mode_invalid');
  if(typeof outboxId!=='string'||!outboxId)throw new Error('outbox_id_required');
  const claims=await this.integrity.claimDeliveries({
    tenantId:this.tenantId,destination:'crm-simulator',
    workerId:'sandbox-provider',limit,outboxId
  });
  const results=[];
  for(const claim of claims){
   let outcome='uncertain',externalRecordRef=null,receiptRef=null;
   try{
    const receipt=await this.accept(claim);
    if(mode==='success'){
     outcome='confirmed_delivered';
     externalRecordRef=receipt.crm_record_ref;
     receiptRef=receipt.receipt_ref;
    }
   }catch(error){
    // A database or transport failure cannot prove the destination did not commit.
    outcome='uncertain';
   }
   const r=await this.integrity.settleDelivery({
    tenantId:this.tenantId,outboxId:claim.outboxId,leaseToken:claim.leaseToken,
    actorId:'sandbox-provider',outcome,externalRecordRef,receiptRef,
    reason:mode==='lost_ack'?'sandbox_acknowledgement_lost':
      outcome==='confirmed_delivered'?'sandbox_provider_receipt':'sandbox_provider_unknown'
   });
   results.push({outboxId:claim.outboxId,state:r.state,mode,operationKey:claim.operationKey});
  }
  return {processed:results.length,results};
 }
 async reconcile({outboxId}={}){
  if(typeof outboxId!=='string'||!outboxId)throw new Error('outbox_id_required');
  const q=await this.pool.query(`SELECT operation_key FROM sales_crm_outbox_v2
    WHERE tenant_id=$1 AND outbox_id=$2`,[this.tenantId,outboxId]);
  if(!q.rows.length)throw new Error('outbox_not_found');
  const r=await this.pool.query(`SELECT crm_record_ref,receipt_ref
    FROM sandbox_crm_deliveries WHERE tenant_id=$1 AND operation_key=$2`,
    [this.tenantId,q.rows[0].operation_key]);
  return this.integrity.reconcileDelivery({
    tenantId:this.tenantId,outboxId,actorId:'sandbox-reconciler',
    result:r.rows.length?'found':'confirmed_absent',
    evidenceRef:r.rows.length?r.rows[0].receipt_ref:'sandbox-provider-confirmed-absent',
    externalRecordRef:r.rows.length?r.rows[0].crm_record_ref:null
  });
 }
}
