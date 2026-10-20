import test from 'node:test';
import assert from 'node:assert/strict';
import {IntegrityCrmHandoffWorker} from '../src/sales-integrity/crm-handoff-worker.js';

function harness(response,throwError=false){
 const changes=[],requests=[];
 const integrity={
  claimDeliveries:async()=>[{outboxId:'outbox-1',leaseToken:'lease-1',
    destination:'1c',operationKey:'stable-provider-key',
    request:{personId:'person-1'},attempt:1}],
  settleDelivery:async x=>{changes.push(x);return {state:x.outcome}},
  reconcileDelivery:async x=>{changes.push(x);return {state:x.result==='found'?'succeeded':'retry'}}
 };
 const worker=new IntegrityCrmHandoffWorker({
  integrity,tenantId:'t1',destination:'1c',workerId:'deliverer',
  sender:async x=>{requests.push(x);if(throwError)throw new Error('timeout');return response}
 });
 return {worker,requests,changes};
}
test('provider receipt completes with stable idempotency key and actual external record',async()=>{
 const h=harness({kind:'confirmed_delivered',externalRecordRef:'CRM-1',receiptRef:'signed-receipt'});
 await h.worker.runOnce();
 assert.equal(h.requests[0].operationKey,'stable-provider-key');
 assert.equal(h.changes[0].outcome,'confirmed_delivered');
 assert.equal(h.changes[0].externalRecordRef,'CRM-1');
});
test('HTTP-like failure cannot be assumed to mean no provider side effect',async()=>{
 const h=harness({kind:'confirmed_not_sent',reason:'HTTP_500'});
 await h.worker.runOnce();
 assert.equal(h.changes[0].outcome,'uncertain');
});
test('transport timeout goes to uncertain outcome, not automated retry',async()=>{
 const h=harness(null,true);
 await h.worker.runOnce();
 assert.equal(h.changes[0].outcome,'uncertain');
 assert.equal(h.changes[0].reason,'transport_failure_outcome_unknown');
});
test('explicit provider-certified non-delivery can be retried',async()=>{
 const h=harness({kind:'confirmed_not_sent',authoritativelyRejected:true,
  reason:'validated_provider_rejection_before_commit'});
 await h.worker.runOnce();
 assert.equal(h.changes[0].outcome,'confirmed_not_sent');
});
test('apparent delivery without receipt remains uncertain',async()=>{
 const h=harness({kind:'confirmed_delivered',externalRecordRef:'CRM-1'});
 await h.worker.runOnce();
 assert.equal(h.changes[0].outcome,'uncertain');
});
test('reconcile only after authoritative lookup evidence',async()=>{
 const h=harness(null);
 await assert.rejects(()=>h.worker.reconcile({outboxId:'outbox-1',
  providerLookup:async()=>({kind:'found'})}),/provider_reconciliation_evidence_required/);
 await h.worker.reconcile({outboxId:'outbox-1',
  providerLookup:async()=>({kind:'found',externalRecordRef:'CRM-1',evidenceRef:'lookup-receipt-1'})});
 assert.equal(h.changes[0].result,'found');
 assert.equal(h.changes[0].evidenceRef,'lookup-receipt-1');
});
