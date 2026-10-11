import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncComplianceLedger } from '../src/compliance/async-ledger.js';
import { MemoryAtomicLedgerStore } from '../src/compliance/storage/memory-atomic-store.js';
import { ACTOR_TYPE, LEGAL_BASIS } from '../src/compliance/event-catalog.js';
import { processSalesIntakeAudited } from '../src/compliance/audited-intake.js';
import { DEDUP_MODE } from '../src/pipeline.js';

const ctx={actor:{type:ACTOR_TYPE.SERVICE,id:'sales-api'},purpose:{code:'sales_intake',version:'1'},legalBasis:{basis:LEGAL_BASIS.CONTRACT,reference:'contract'},retention:{class:'standard',expiresAt:'2030-01-01T00:00:00Z'}};
const raw={primaryContact:{name:'Synthetic Contact',phone:'+7 900 000 00 00'},consents:{privacy:true,dataProcessing:true,marketing:false},source:{channel:'web'}};

test('audited intake awaits ledger writes before it can be delivered',async()=>{
 const ledger=new AsyncComplianceLedger({store:new MemoryAtomicLedgerStore(),strict:true});
 const result=await processSalesIntakeAudited(raw,{ledger,auditContext:ctx,dedupMode:DEDUP_MODE.OFF});
 assert.equal(result.deliverable,true);assert.equal(result.auditReady,true);assert.equal((await ledger.events()).length,2);assert.equal((await ledger.verifyIntegrity()).ok,true);
});

test('audited intake refuses to infer legal basis',async()=>{
 const ledger=new AsyncComplianceLedger({store:new MemoryAtomicLedgerStore(),strict:true});
 await assert.rejects(()=>processSalesIntakeAudited(raw,{ledger,auditContext:{actor:ctx.actor,purpose:ctx.purpose},dedupMode:DEDUP_MODE.OFF}),/legal_basis_required/);
});
