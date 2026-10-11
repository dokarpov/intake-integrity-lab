import test from 'node:test';import assert from 'node:assert/strict';import { rawEcdsaToDer } from '../src/compliance/signing/pkcs11-hsm-signer.js';
test('PKCS11 raw ECDSA signature is encoded as DER',()=>{const raw=Buffer.concat([Buffer.alloc(32,1),Buffer.alloc(32,2)]);const der=rawEcdsaToDer(raw);assert.equal(der[0],0x30);assert.ok(der.length>64)});
