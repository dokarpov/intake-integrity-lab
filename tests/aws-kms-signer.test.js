import test from 'node:test';import assert from 'node:assert/strict';
import { AwsKmsSigner } from '../src/compliance/signing/aws-kms-signer.js';

test('AWS KMS signer sends digest-mode sign request and returns provider metadata',async()=>{
 const client={async send(cmd){if(cmd.operation==='Sign'){assert.equal(cmd.input.MessageType,'DIGEST');assert.equal(cmd.input.SigningAlgorithm,'ECDSA_SHA_256');return{Signature:Buffer.from('sig'),KeyId:'arn:kms:key',SigningAlgorithm:'ECDSA_SHA_256'}} if(cmd.operation==='Verify')return{SignatureValid:true}; throw new Error(cmd.operation)}};
 const s=new AwsKmsSigner({client,keyId:'arn:kms:key',commands:{Sign:i=>({operation:'Sign',input:i}),Verify:i=>({operation:'Verify',input:i})}});const sig=await s.sign({a:1});assert.equal(sig.algorithm,'ECDSA_SHA_256');assert.equal(await s.verify({a:1},sig),true);assert.equal(s.securityBoundary,'aws-kms-hsm');
});
