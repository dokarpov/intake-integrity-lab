import test from 'node:test'; import assert from 'node:assert/strict'; import { randomBytes } from 'node:crypto';
import { AwsS3ObjectLockArchive } from '../src/compliance/archive/aws-s3-object-lock.js';
import { ArchiveManager } from '../src/compliance/archive/archive-manager.js';
import { MemoryWormArchive } from '../src/compliance/archive/memory-worm.js';
import { LocalDataKeyProvider } from '../src/compliance/encryption/local-data-key-provider.js';
import { encryptForArchive, decryptArchive } from '../src/compliance/encryption/envelope.js';
import { AwsKmsHmacPseudonymizer } from '../src/compliance/pseudonymizer-kms.js';

class FakeS3 { constructor(){this.lastPut=null;this.hold='OFF';this.retention=null;} async send(cmd){const {operation,input}=cmd;if(operation==='GetObjectLockConfiguration')return{ObjectLockConfiguration:{ObjectLockEnabled:'Enabled'}};if(operation==='GetBucketVersioning')return{Status:'Enabled'};if(operation==='PutObject'){this.lastPut=input;this.retention={Mode:input.ObjectLockMode,RetainUntilDate:input.ObjectLockRetainUntilDate};return{VersionId:'v1',ETag:'etag'}};if(operation==='HeadObject')return{ChecksumSHA256:this.lastPut.ChecksumSHA256,ETag:'etag'};if(operation==='GetObjectRetention')return{Retention:this.retention};if(operation==='PutObjectRetention'){this.retention=input.Retention;return{}};if(operation==='PutObjectLegalHold'){this.hold=input.LegalHold.Status;return{}};if(operation==='GetObjectLegalHold')return{LegalHold:{Status:this.hold}};throw new Error(operation)}}
const commands=Object.fromEntries(['GetObjectLockConfiguration','GetBucketVersioning','PutObject','HeadObject','GetObjectRetention','PutObjectRetention','PutObjectLegalHold','GetObjectLegalHold'].map(k=>[k,input=>({operation:k,input})]));

test('S3 WORM adapter preflights object lock/versioning and verifies retention',async()=>{
 const a=new AwsS3ObjectLockArchive({client:new FakeS3(),bucket:'audit',retentionDays:3650,commands}); assert.equal((await a.preflight()).ok,true);
 const r=await a.archive({key:'x',bytes:Buffer.from('hello'),now:new Date('2026-10-02T00:00:00Z')}); assert.equal(r.objectLockMode,'COMPLIANCE'); assert.equal(r.versionId,'v1');
});

test('archive manager requires quorum',async()=>{
 const good1=new MemoryWormArchive({name:'a'}),good2=new MemoryWormArchive({name:'b'}),bad={async archive(){throw new Error('down')}};
 const manager=new ArchiveManager({targets:[good1,good2,bad],quorum:2}); const r=await manager.archive({key:'x',bytes:'abc'});assert.equal(r.receipts.length,2);assert.equal(r.quorumSatisfied,true);
 const impossible=new ArchiveManager({targets:[good1,bad],quorum:2});await assert.rejects(()=>impossible.archive({key:'y',bytes:'abc'}),/quorum_failed/);
});

test('archive envelope encryption round trips and clears raw data-key boundary',async()=>{
 const p=new LocalDataKeyProvider({masterKey:randomBytes(32)});const x=await encryptForArchive(Buffer.from('secret'),{dataKeyProvider:p,aad:'a'});const plain=await decryptArchive({ciphertext:x.ciphertext,envelope:x.envelope},{dataKeyProvider:p});assert.equal(plain.toString(),'secret');assert.equal(x.envelope.algorithm,'AES-256-GCM');
});

test('KMS HMAC pseudonymizer keeps raw identifier out of reference',async()=>{
 const client={async send(cmd){assert.equal(cmd.operation,'GenerateMac');return{Mac:Buffer.alloc(32,7),KeyId:'kms-hmac',MacAlgorithm:'HMAC_SHA_256'}}};
 const p=new AwsKmsHmacPseudonymizer({client,keyId:'kms-hmac',commands:{GenerateMac:i=>({operation:'GenerateMac',input:i})}});const ref=await p.subjectRef('person@example.test','email');assert.match(ref.ref,/^sub_/);assert.equal(ref.ref.includes('person'),false);assert.equal(ref.keyId,'kms-hmac');
});


test('WORM legal hold can be verified and retention can only extend',async()=>{
 const client=new FakeS3();const a=new AwsS3ObjectLockArchive({client,bucket:'audit',retentionDays:10,commands});const r=await a.archive({key:'x',bytes:'z',now:new Date('2026-10-02T00:00:00Z')});
 assert.equal((await a.setLegalHold({key:r.key,versionId:r.versionId,on:true})).legalHold,true);
 await assert.rejects(()=>a.extendRetention({key:r.key,versionId:r.versionId,retainUntil:'2026-10-03T00:00:00Z'}),/cannot_shorten/);
 const ext=await a.extendRetention({key:r.key,versionId:r.versionId,retainUntil:'2026-11-30T00:00:00Z'});assert.equal(ext.retainUntil,'2026-11-30T00:00:00.000Z');
});
