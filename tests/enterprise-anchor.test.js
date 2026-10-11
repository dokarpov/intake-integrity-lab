import test from 'node:test'; import assert from 'node:assert/strict';
import { ComplianceLedger } from '../src/compliance/ledger.js';
import { ACTOR_TYPE, DATA_CLASS, LEGAL_BASIS, RESULT } from '../src/compliance/event-catalog.js';
import { LocalEd25519Signer } from '../src/compliance/signing/local-ed25519-signer.js';
import { MemoryWormArchive } from '../src/compliance/archive/memory-worm.js';
import { ArchiveManager } from '../src/compliance/archive/archive-manager.js';
import { LocalDataKeyProvider } from '../src/compliance/encryption/local-data-key-provider.js';
import { anchorLedgerSegment } from '../src/compliance/archive/enterprise-anchor.js';
import { verifyArchivedSegment } from '../src/compliance/archive/verify-anchor.js';
function ev(ref){return{actor:{type:ACTOR_TYPE.SYSTEM,id:'svc'},action:'data.created',result:RESULT.SUCCESS,reasonCode:'accepted',purpose:{code:'sales',version:'1'},legalBasis:{basis:LEGAL_BASIS.CONTRACT,reference:'contract'},object:{type:'lead',ref},dataClasses:[DATA_CLASS.CONTACT],retention:{class:'standard',expiresAt:'2030-01-01T00:00:00Z'}}}
test('segment is signed, encrypted, archived with recovery control object and independently verified',async()=>{
 const ledger=new ComplianceLedger({strict:true});ledger.append(ev('1'));ledger.append(ev('2'));ledger.append(ev('3'));
 const signer=new LocalEd25519Signer(),target=new MemoryWormArchive(),manager=new ArchiveManager({targets:[target]}),keys=new LocalDataKeyProvider();
 const receipt=await anchorLedgerSegment(ledger.events,{signer,archiveManager:manager,dataKeyProvider:keys,ledgerId:ledger.ledgerId,retentionDays:365});
 assert.equal(receipt.payloadArchive.quorumSatisfied,true);assert.equal(receipt.controlArchive.quorumSatisfied,true);
 const payload=target.objects.get(receipt.payloadArchive.receipts[0].key),control=target.objects.get(receipt.controlArchive.receipts[0].key);assert.ok(payload&&control);
 const v=await verifyArchivedSegment({payloadBytes:payload.body,controlBytes:control.body,dataKeyProvider:keys,signer});assert.equal(v.ok,true);assert.equal(v.package.events.length,3);
});
