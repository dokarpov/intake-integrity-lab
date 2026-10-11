import test from 'node:test'; import assert from 'node:assert/strict';
import { AsyncComplianceLedger } from '../src/compliance/async-ledger.js';
import { MemoryAtomicLedgerStore } from '../src/compliance/storage/memory-atomic-store.js';
import { ACTOR_TYPE, DATA_CLASS, LEGAL_BASIS, RESULT } from '../src/compliance/event-catalog.js';

const base=i=>({actor:{type:ACTOR_TYPE.SYSTEM,id:'test'},action:'data.created',result:RESULT.SUCCESS,reasonCode:'test',purpose:{code:'test',version:'1'},legalBasis:{basis:LEGAL_BASIS.CONTRACT,reference:'test-contract'},object:{type:'row',ref:String(i)},dataClasses:[DATA_CLASS.CONTACT],retention:{class:'standard',expiresAt:'2030-01-01T00:00:00Z'},metadata:{batch:i}});

test('atomic async ledger preserves a single chain under concurrent appends',async()=>{
 const ledger=new AsyncComplianceLedger({store:new MemoryAtomicLedgerStore(),strict:true});
 await Promise.all(Array.from({length:100},(_,i)=>ledger.append(base(i))));
 const events=await ledger.events(); assert.equal(events.length,100); assert.deepEqual(events.map(x=>x.sequence),Array.from({length:100},(_,i)=>i+1));
 assert.equal((await ledger.verifyIntegrity()).ok,true);
});
