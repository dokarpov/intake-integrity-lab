import test from 'node:test';
import assert from 'node:assert/strict';
import {SandboxDecisionEvidence} from '../src/sales-integrity/sandbox-evidence.js';

const person='e6c03d5d-d3f9-4b3a-a1ef-40e692300011';
let now=1782290000000;
const store={
 async getIntake({tenantId,intakeId}){return tenantId==='staging-demo'&&intakeId==='intake-1'
  ?{intakeId,state:'review_needed'}:null},
 async candidates(){return [{personId:person,name:'Demo customer'}]}
};
const make=()=>new SandboxDecisionEvidence({
 secret:'testing-only-signing-key-at-least-forty-characters',
 integrityStore:store,tenantId:'staging-demo',now:()=>now
});
const params=()=>({tenantId:'staging-demo',actorId:'reviewer-1',intakeId:'intake-1',
 action:'link_existing',personId:person,simulateEvidence:true,simulateConsent:true});
test('signed fictional evidence is bound to tenant, reviewer, intake, action and candidate',async()=>{
 const s=make();
 const refs=await s.issue(params());
 assert.equal(refs.simulation,true);
 assert.equal(await s.verifyDecision({...params(),...refs}),true);
 assert.equal(await s.verifyDecision({...params(),...refs,actorId:'attacker'}),false);
 assert.equal(await s.verifyDecision({...params(),...refs,tenantId:'another-tenant'}),false);
 assert.equal(await s.verifyDecision({...params(),...refs,personId:'different-person'}),false);
 assert.equal(await s.verifyDecision({...params(),...refs,action:'create_new',personId:null}),false);
 assert.equal(await s.verifyDecision({...params(),...refs,intakeId:'other-intake'}),false);
 assert.equal(await s.verifyDecision({...params(),...refs,consentEvidenceRef:refs.identityEvidenceRef}),false);
});
test('tampered, unsigned, missing or expired references never verify',async()=>{
 now=1782290000000;
 const s=make(),refs=await s.issue(params());
 assert.equal(await s.verifyDecision({...params(),...refs,identityEvidenceRef:refs.identityEvidenceRef+'tamper'}),false);
 assert.equal(await s.verifyDecision({...params(),...refs,identityEvidenceRef:'I confirmed this'}),false);
 assert.equal(await s.verifyDecision({...params(),...refs,identityEvidenceRef:null}),false);
 now+=600001;
 assert.equal(await s.verifyDecision({...params(),...refs}),false);
 now=1782290000000;
});
test('no raw approval checkbox can create evidence without acknowledgements',async()=>{
 const s=make();
 await assert.rejects(()=>s.issue({...params(),simulateEvidence:false}),/acknowledgement_required/);
 await assert.rejects(()=>s.issue({...params(),simulateConsent:false}),/consent_acknowledgement_required/);
 await assert.rejects(()=>s.issue({...params(),tenantId:'foreign'}),/sandbox_tenant_or_identity_invalid/);
 await assert.rejects(()=>s.issue({...params(),personId:'forged'}),/sandbox_selected_person_not_candidate/);
 await assert.rejects(()=>s.issue({...params(),intakeId:'not-found'}),/sandbox_intake_not_reviewable/);
});
test('fictional discard needs no contact evidence but still needs verified actor',async()=>{
 const s=make(),p={...params(),action:'discard',personId:null,simulateConsent:false};
 const refs=await s.issue(p);
 assert.equal(refs.consentEvidenceRef,null);
 assert.equal(await s.verifyDecision({...p,...refs}),true);
});
test('sandbox cannot initialize with NODE_ENV production',()=>{
 const prev=process.env.NODE_ENV;
 try{process.env.NODE_ENV='production';
 assert.throws(()=>make(),/sandbox_forbidden_in_production/)}
 finally{if(prev===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=prev}
});
