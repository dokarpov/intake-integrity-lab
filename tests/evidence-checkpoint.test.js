import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateEvidenceCheckpoint as evaluate} from '../src/integrity/evidence-checkpoint.js';
import {personalizedOrderPolicy,exampleEvidence,exampleAction,exampleTrustedEvidenceRefs} from '../examples/personalized-production-policy.mjs';

const assessment=(evidence=exampleEvidence(),{trustedRefs=exampleTrustedEvidenceRefs(),policy=personalizedOrderPolicy}={})=>
  evaluate({policy,evidence,proposedAction:exampleAction(),trustedEvidenceRefs:trustedRefs});
const byId=(result,id)=>result.findings.find(f=>f.ruleId===id);
const isUnresolved=(result,id)=>result.unresolvedRuleIds.includes(id);

test('same data and authenticated claims produce only observations, never a business decision',()=>{
  const evidence=exampleEvidence(),before=structuredClone(evidence),r=assessment(evidence);
  assert.deepEqual(evidence,before,'evaluator must not mutate input records');
  assert.equal(r.unresolvedRuleIds.length,0);
  assert.equal(r.suggestsHumanReview,false);
  assert.equal(r.businessDecision,null);
  assert.equal(r.workflowStatus,null);
  assert.equal(r.actionExecuted,false);
  assert.equal(byId(r,'approved_vs_asset_text').observation,'consistent');
  assert.equal('ready' in r,false);
  assert.equal('hold' in r,false);
});

test('SOFIA order, SOPHIA approved proof, SOFIA asset exposes both differences without choosing a winner',()=>{
  const evidence=exampleEvidence();
  evidence.approvedProof.fields.personalizationText='SOPHIA';
  const r=assessment(evidence);
  assert.equal(byId(r,'order_vs_approved_text').observation,'difference');
  assert.equal(byId(r,'approved_vs_asset_text').observation,'difference');
  assert.equal(byId(r,'approved_vs_asset_text').leftValue,'SOPHIA');
  assert.equal(byId(r,'approved_vs_asset_text').rightValue,'SOFIA');
  assert.equal(r.suggestsHumanReview,true);
  assert.equal(r.businessDecision,null);
});

test('approved proof matches order but production asset text differs',()=>{
  const e=exampleEvidence();e.productionAsset.fields.personalizationText='SOPHIA';
  const r=assessment(e);
  assert.equal(byId(r,'order_vs_approved_text').observation,'consistent');
  assert.equal(byId(r,'approved_vs_asset_text').observation,'difference');
});
test('order edited after the proof was approved',()=>{
  const e=exampleEvidence();e.order.fields.revision='4';
  const r=assessment(e);assert.equal(byId(r,'revision_at_approval').observation,'difference');
  assert.equal(r.businessDecision,null);
});
test('production derived from an older version despite text matching',()=>{
  const e=exampleEvidence();e.productionAsset.fields.basedOnProofVersion='proof-v2';
  const r=assessment(e);assert.equal(byId(r,'production_derived_version').observation,'difference');
});
test('same filename cannot substitute approval proof digest',()=>{
  const e=exampleEvidence();e.approval.fields.proofDigest='sha256:other-artwork';
  const r=assessment(e);assert.equal(byId(r,'approved_proof_digest').observation,'difference');
});
test('approval belongs to another customer order',()=>{
  const e=exampleEvidence();e.approval.fields.orderId='ORDER-999';
  const r=assessment(e);assert.equal(byId(r,'order_identity_approval').observation,'difference');
});
test('production file belongs to another order',()=>{
  const e=exampleEvidence();e.productionAsset.fields.orderId='ORDER-777';
  const r=assessment(e);assert.equal(byId(r,'order_identity_asset').observation,'difference');
});
test('matching text is not enough if font or placement differs',()=>{
  const e=exampleEvidence();e.productionAsset.fields.font='Serif Bold';e.productionAsset.fields.placement='back-left';
  const r=assessment(e);
  assert.equal(byId(r,'approved_vs_asset_text').observation,'consistent');
  assert.equal(byId(r,'approved_vs_asset_font').observation,'difference');
  assert.equal(byId(r,'approved_vs_asset_placement').observation,'difference');
});
test('visual confusables, case and whitespace remain distinct by policy',()=>{
  for(const altered of ['SΟFIA','sofia','SOFIA ']) {
    const e=exampleEvidence();e.productionAsset.fields.personalizationText=altered;
    assert.equal(byId(assessment(e),'approved_vs_asset_text').observation,'difference',altered);
  }
});
test('missing proof/approval is uncertainty, not an inferred workflow status',()=>{
  const e=exampleEvidence();delete e.approvedProof;delete e.approval;
  const r=assessment(e);
  assert.equal(byId(r,'order_identity_proof').observation,'missing_evidence');
  assert.equal(byId(r,'customer_approval_provenance').observation,'unverifiable');
  assert.equal(r.suggestsHumanReview,true);
  assert.equal(r.workflowStatus,null);
});
test('empty values never count as matching proof',()=>{
  const e=exampleEvidence();
  e.approvedProof.fields.personalizationText='';e.productionAsset.fields.personalizationText='';
  const r=assessment(e);
  assert.equal(byId(r,'approved_vs_asset_text').observation,'missing_evidence');
});
test('missing production fingerprint makes apparent agreement incomplete',()=>{
  const e=exampleEvidence();delete e.productionAsset.fields.contentDigest;
  const r=assessment(e);
  assert.equal(byId(r,'production_asset_fingerprint').observation,'missing_evidence');
  assert.equal(r.suggestsHumanReview,true);
});
test('claimed approval metadata without trusted server ref cannot authenticate itself',()=>{
  const r=assessment(exampleEvidence(),{trustedRefs:[]});
  assert.equal(byId(r,'customer_approval_provenance').observation,'unverifiable');
  assert.equal(byId(r,'production_asset_extraction').observation,'unverifiable');
  assert.deepEqual(byId(r,'production_asset_extraction').missingAspects,['text','font','placement']);
  assert.equal(r.suggestsHumanReview,true);
});
test('partial asset extraction does not imply full artwork comparison',()=>{
  const r=assessment(exampleEvidence(),{trustedRefs:['approval.attestation:approval-verified-104',
    'productionAsset.verifiedAspects.text:extract-text-104']});
  assert.deepEqual(byId(r,'production_asset_extraction').missingAspects,['font','placement']);
  assert.equal(byId(r,'approved_vs_asset_text').observation,'consistent');
  assert.equal(r.suggestsHumanReview,true);
});
test('incorrect verifier ID is not independently trusted',()=>{
  const e=exampleEvidence();e.approval.attestation.verifierId='unknown-integration';
  const r=assessment(e);
  assert.equal(byId(r,'customer_approval_provenance').observation,'unverifiable');
});
test('downstream source unavailable gives uncertainty, not blind success',()=>{
  const e=exampleEvidence();delete e.productionAsset;
  const r=assessment(e);
  assert.equal(byId(r,'production_derived_version').observation,'missing_evidence');
  assert.equal(byId(r,'production_asset_extraction').observation,'unverifiable');
  assert.equal(r.actionExecuted,false);
});
test('non-personalized workflow can have a separate approved, explicit limited policy',()=>{
  const limitedPolicy={id:'example.stock-order',version:'testing-1',
    rules:[{id:'bound_order',type:'compare',left:{source:'order',field:'id'},right:{source:'productionAsset',field:'orderId'}}]};
  const r=assessment({order:{fields:{id:'STOCK-1'}},productionAsset:{fields:{orderId:'STOCK-1'}}},{policy:limitedPolicy,trustedRefs:[]});
  assert.equal(r.unresolvedRuleIds.length,0);
  assert.equal(r.businessDecision,null,'a limited policy must not grant authorization');
  assert.equal(r.policyRef.id,'example.stock-order');
});
test('invalid/empty/unrecognized policies fail before producing misleading findings',()=>{
  const e=exampleEvidence(), proposedAction=exampleAction();
  assert.throws(()=>evaluate({policy:{id:'x',version:'1',rules:[]},evidence:e,proposedAction}),/invalid_evidence_policy/);
  assert.throws(()=>evaluate({policy:{id:'x',version:'1',rules:[{id:'a',type:'auto_release'}]},evidence:e,proposedAction}),/invalid_or_duplicate_rule/);
  assert.throws(()=>evaluate({policy:{id:'x',version:'1',rules:[
    {id:'a',type:'required',target:{source:'order',field:'id'}},
    {id:'a',type:'required',target:{source:'order',field:'revision'}}
  ]},evidence:e,proposedAction}),/invalid_or_duplicate_rule/);
  assert.throws(()=>evaluate({policy:personalizedOrderPolicy,evidence:e,proposedAction:{type:'',subjectRef:'ORDER-104'}}),/proposed_action_context_required/);
});

test('the same evaluator detects invoice-versus-approved-terms differences without an invoicing status',()=>{
  const policy={id:'example.invoice-check',version:'testing-1',rules:[
    {id:'scope',type:'compare',left:{source:'quote',field:'orderId'},right:{source:'invoice',field:'orderId'}},
    {id:'amount',type:'compare',left:{source:'quote',field:'amount'},right:{source:'invoice',field:'amount'}},
    {id:'currency',type:'compare',left:{source:'quote',field:'currency'},right:{source:'invoice',field:'currency'}}
  ]};
  const evidence={quote:{fields:{orderId:'A17',amount:190,currency:'EUR'}},
    invoice:{fields:{orderId:'A17',amount:200,currency:'EUR',status:'Draft'}}};
  const result=evaluate({policy,evidence,proposedAction:{type:'issue_invoice',subjectRef:'A17'}});
  assert.equal(result.findings[1].observation,'difference');
  assert.equal(result.findings[2].observation,'consistent');
  assert.equal(result.businessDecision,null);
  assert.equal(result.workflowStatus,null);
  assert.equal(evidence.invoice.fields.status,'Draft');
});
test('merchant-specific order states are preserved verbatim, never replaced by checkpoint statuses',()=>{
  const e=exampleEvidence();
  e.order.fields.productionStage='Awaiting engraving';
  e.productionAsset.fields.personalizationText='SOPHIA';
  const before=structuredClone(e);
  const r=assessment(e);
  assert.deepEqual(e,before);
  assert.equal(e.order.fields.productionStage,'Awaiting engraving');
  assert.equal(r.workflowStatus,null);
  assert.equal(r.actionExecuted,false);
});
