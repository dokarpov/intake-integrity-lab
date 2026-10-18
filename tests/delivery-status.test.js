import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryOutboxStore} from '../src/delivery/outbox.js';
// Simulated delivery-status scenarios, not a live connector test.
test('delivery status only returns matching tenant and intake',async()=>{
 const store=new MemoryOutboxStore();
 await store.enqueue({tenantId:'alpha',intakeId:'ENQ-1',destination:'1c',request:{url:'https://example.invalid/1c',headers:{authorization:'Bearer secret'},body:{name:'Private'}}});
 await store.enqueue({tenantId:'beta',intakeId:'ENQ-1',destination:'1c',request:{url:'https://example.invalid/1c',body:{name:'Other'}}});
 await store.enqueue({tenantId:'alpha',intakeId:'ENQ-2',destination:'1c',request:{url:'https://example.invalid/1c',body:{name:'Third'}}});
 const rows=await store.listForIntake({tenantId:'alpha',intakeId:'ENQ-1'});
 assert.equal(rows.length,1);assert.equal(rows[0].status,'pending');assert.equal(rows[0].intakeId,'ENQ-1');assert.equal('request' in rows[0],false);assert.equal('tenantId' in rows[0],false);
});
test('delivery status requires both tenant and intake',async()=>{
 const store=new MemoryOutboxStore();await assert.rejects(store.listForIntake({intakeId:'ENQ-1'}),/delivery_scope_required/);await assert.rejects(store.listForIntake({tenantId:'alpha'}),/delivery_scope_required/);
});
test('delivery status reports retry and recovery without exposing payload',async()=>{
 const store=new MemoryOutboxStore({now:()=> '2026-10-18T12:00:00Z'});
 await store.enqueue({id:'outbox-test',tenantId:'alpha',intakeId:'ENQ-3',destination:'1c',request:{url:'https://example.invalid/1c',body:{name:'Private'}}});
 await store.claimDue({now:'2026-10-18T12:00:00Z'});
 await store.fail('outbox-test',{error:new Error('temporary outage'),now:'2026-10-18T12:00:00Z'});
 let rows=await store.listForIntake({tenantId:'alpha',intakeId:'ENQ-3'});assert.equal(rows[0].status,'retry');assert.equal(rows[0].attempts,1);
 await store.claimDue({now:'2026-10-18T12:00:02Z'});await store.complete('outbox-test',{externalRecordRef:'CRM-42',statusCode:200});
 rows=await store.listForIntake({tenantId:'alpha',intakeId:'ENQ-3'});assert.equal(rows[0].status,'succeeded');assert.equal(rows[0].externalRecordRef,'CRM-42');assert.equal('request' in rows[0],false);
});

test('duplicate CRM delivery for same tenant and intake is rejected',async()=>{
 const store=new MemoryOutboxStore();const item={tenantId:'alpha',intakeId:'ENQ-9',destination:'1c',request:{url:'https://example.invalid/1c',body:{name:'Example'}}};
 await store.enqueue(item);
 await assert.rejects(store.enqueue(item),/duplicate_delivery_intake_destination/);
 assert.equal((await store.listForIntake({tenantId:'alpha',intakeId:'ENQ-9'})).length,1);
 await store.enqueue({...item,tenantId:'beta'});
 assert.equal((await store.listForIntake({tenantId:'beta',intakeId:'ENQ-9'})).length,1);
});
