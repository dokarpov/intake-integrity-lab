// Run: node examples/run-evidence-checkpoint.mjs
// This is a fictional comparison only. It never releases, blocks or modifies an order.
import {evaluateEvidenceCheckpoint} from '../src/integrity/evidence-checkpoint.js';
import {personalizedOrderPolicy,exampleEvidence,exampleAction,exampleTrustedEvidenceRefs}
  from './personalized-production-policy.mjs';

const scenarios=[
  ['Identical, verified example', () => {}],
  ['SOFIA order, SOPHIA proof, SOFIA production', evidence => {
    evidence.approvedProof.fields.personalizationText='SOPHIA';
  }],
  ['Correct text, older production version', evidence => {
    evidence.productionAsset.fields.basedOnProofVersion='proof-v2';
  }],
  ['Correct text, altered placement', evidence => {
    evidence.productionAsset.fields.placement='back-left';
  }],
  ['Approval present but not independently verified',()=>{},[]],
  ['Artwork font extraction not independently verified',()=>{},
    ['approval.attestation:approval-verified-104',
     'productionAsset.verifiedAspects.text:extract-text-104',
     'productionAsset.verifiedAspects.placement:extract-placement-104']]
];
for(const [name,change,verifiedRefs] of scenarios){
  const evidence=exampleEvidence();
  change(evidence);
  const report=evaluateEvidenceCheckpoint({
    policy:personalizedOrderPolicy,
    evidence,
    proposedAction:exampleAction(),
    trustedEvidenceRefs:verifiedRefs??exampleTrustedEvidenceRefs()
  });
  console.log('\n'+name);
  for(const finding of report.findings.filter(x=>!['consistent','present','attestation_present','coverage_declared'].includes(x.observation))){
    console.log('  '+finding.ruleId+': '+finding.observation+' — '+finding.detail);
    if('leftValue' in finding)console.log('    Source values: '+JSON.stringify(finding.leftValue)+' / '+JSON.stringify(finding.rightValue));
  }
  if(!report.unresolvedRuleIds.length)console.log('  No differences in this policy scope (not production authorization).');
  console.log('  Business decision: '+String(report.businessDecision));
  console.log('  Workflow status change: '+String(report.workflowStatus));
}
