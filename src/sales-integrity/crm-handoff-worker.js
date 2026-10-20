/**
 * Adapter boundary for a provider-specific CRM sender.
 *
 * sender({destination,operationKey,request,attempt}) MUST return exactly one
 * of {kind:'confirmed_delivered',externalRecordRef,receiptRef},
 * {kind:'confirmed_not_sent',reason}, or {kind:'uncertain',reason}.
 *
 * A generic HTTP 500, connection reset or timeout is UNKNOWN, not proof the
 * destination didn't commit. An authenticated integration must implement
 * provider idempotency or read-after-write reconciliation separately.
 */
export class IntegrityCrmHandoffWorker{
  constructor({integrity,sender,workerId,tenantId,destination='crm',maxBatch=10}={}){
    if(!integrity||typeof sender!=='function'||!workerId||!tenantId||!destination)
      throw new Error('integrity_worker_dependencies_required');
    Object.assign(this,{integrity,sender,workerId,tenantId,destination,maxBatch});
  }
  async runOnce(){
    const claims=await this.integrity.claimDeliveries({
      tenantId:this.tenantId,destination:this.destination,workerId:this.workerId,limit:this.maxBatch
    });
    const outcomes=[];
    for(const claim of claims){
      let response;
      try{
        response=await this.sender({
          destination:claim.destination,operationKey:claim.operationKey,
          request:claim.request,attempt:claim.attempt
        });
      }catch(error){
        response={kind:'uncertain',reason:'transport_failure_outcome_unknown'};
      }
      let outcome='uncertain',externalRecordRef=null,receiptRef=null;
      if(response?.kind==='confirmed_delivered'&&response.externalRecordRef&&response.receiptRef){
        outcome='confirmed_delivered';
        externalRecordRef=response.externalRecordRef;
        receiptRef=response.receiptRef;
      }else if(response?.kind==='confirmed_not_sent'&&response.authoritativelyRejected===true){
        outcome='confirmed_not_sent';
      }
      const reason=response?.reason||(
        outcome==='uncertain'?'no_authoritative_provider_receipt':'provider_confirmed'
      );
      const entry=await this.integrity.settleDelivery({
        tenantId:this.tenantId,outboxId:claim.outboxId,leaseToken:claim.leaseToken,
        actorId:this.workerId,outcome,externalRecordRef,receiptRef,reason
      });
      outcomes.push(entry);
    }
    return outcomes;
  }
  async reconcile({outboxId,providerLookup,actorId='provider-reconciler'}={}){
    if(typeof providerLookup!=='function')throw new Error('provider_lookup_required');
    // Provider lookup is required to check the idempotency key against the
    // real destination. A person's own "not found" guess is insufficient.
    const answer=await providerLookup({tenantId:this.tenantId,outboxId,destination:this.destination});
    if(!answer||!['found','confirmed_absent'].includes(answer.kind)||!answer.evidenceRef)
      throw new Error('provider_reconciliation_evidence_required');
    return this.integrity.reconcileDelivery({
      tenantId:this.tenantId,outboxId,actorId,
      result:answer.kind,evidenceRef:answer.evidenceRef,externalRecordRef:answer.externalRecordRef||null
    });
  }
}
