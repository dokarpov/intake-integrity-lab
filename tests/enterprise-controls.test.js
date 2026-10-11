import test from 'node:test';
import assert from 'node:assert/strict';
import { merkleRoot, merkleProof, verifyMerkleProof } from '../src/compliance/integrity/merkle.js';
import { TwoPersonControl, CONTROLLED_ACTION, controlledPayloadDigest } from '../src/compliance/approvals/two-person-control.js';
import { BreakGlassGrant } from '../src/compliance/approvals/break-glass.js';
import { KeyRegistry, KEY_PURPOSE } from '../src/compliance/signing/key-registry.js';
import { ControlMonitor } from '../src/compliance/monitoring/control-monitor.js';

test('Merkle inclusion proof verifies and rejects tampering',()=>{
  const leaves=['a','b','c','d','e']; const root=merkleRoot(leaves); const proof=merkleProof(leaves,3);
  assert.equal(proof.root,root); assert.equal(verifyMerkleProof(proof),true); assert.equal(verifyMerkleProof({...proof,leaf:'x'}),false);
});

test('two-person control forbids self approval and binds payload',()=>{
  const ctl=new TwoPersonControl({now:()=> '2026-10-02T14:00:00.000Z'});
  const req=ctl.request({action:CONTROLLED_ACTION.KEY_REVOKE,requestedBy:'alice',reason:'incident',payloadDigest:'sha256:x'});
  assert.throws(()=>ctl.approve(req.id,{approvedBy:'alice'}),/second_actor_required/);
  const approved=ctl.approve(req.id,{approvedBy:'bob'}); assert.equal(approved.status,'approved');
  assert.throws(()=>ctl.consume(req.id,{action:CONTROLLED_ACTION.KEY_REVOKE,payloadDigest:'sha256:y'}),/payload_mismatch/);
  assert.equal(ctl.consume(req.id,{action:CONTROLLED_ACTION.KEY_REVOKE,payloadDigest:'sha256:x'}).status,'consumed');
});

test('break glass expires and only grants named permissions',()=>{
  let now='2026-10-02T14:00:00.000Z'; const ctl=new TwoPersonControl({now:()=>now});
  const pd=controlledPayloadDigest(CONTROLLED_ACTION.BREAK_GLASS_ACCESS,{subject:'alice',permissions:['audit.read']}); const req=ctl.request({action:CONTROLLED_ACTION.BREAK_GLASS_ACCESS,requestedBy:'alice',reason:'incident',payloadDigest:pd}); const approved=ctl.approve(req.id,{approvedBy:'bob'});
  const grant=new BreakGlassGrant({subject:'alice',permissions:['audit.read'],approvedRequest:approved,now:()=>now,ttlMs:60000});
  assert.equal(grant.allows('audit.read'),true); assert.equal(grant.allows('audit.export'),false); now='2026-10-02T14:02:00.000Z'; assert.equal(grant.allows('audit.read'),false);
});

test('key registry enforces one active key per purpose',()=>{
  const r=new KeyRegistry(); r.register({keyId:'k1',purpose:KEY_PURPOSE.CHECKPOINT_SIGNING,algorithm:'ECDSA_SHA_256'});
  assert.equal(r.activeFor(KEY_PURPOSE.CHECKPOINT_SIGNING).keyId,'k1');
  r.setStatus('k1','retired'); assert.throws(()=>r.activeFor(KEY_PURPOSE.CHECKPOINT_SIGNING),/active_key_cardinality/);
});

test('control monitor reports stale/missing anchors and key expiry',()=>{
  const m=new ControlMonitor({now:()=> '2026-10-02T14:00:00.000Z',maxCheckpointAgeMs:1000,maxArchiveAgeMs:1000,keyExpiryWarningMs:100000});
  const r=m.evaluate({ledgerIntegrity:{ok:true,errors:[]},checkpoints:[{createdAt:'2026-10-02T13:00:00.000Z'}],archiveReceipts:[],keys:[{keyId:'k',status:'active',notAfter:'2026-10-02T14:00:01.000Z'}]});
  assert.equal(r.ok,false); assert.ok(r.alerts.some(x=>x.code==='checkpoint_overdue')); assert.ok(r.alerts.some(x=>x.code==='immutable_anchor_missing'));
});
