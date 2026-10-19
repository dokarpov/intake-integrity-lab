/**
 * Explicit, illustrative policy for a personalized-order production handoff.
 * NOT a Shopify integration or a statement of merchant workflow statuses.
 * A merchant/integrator must approve the required fields and authority model.
 */
export const personalizedOrderPolicy = Object.freeze({
  id:'example.personalized-order-pre-handoff',
  version:'testing-1',
  rules:[
    {id:'order_identity_proof',type:'compare',
      left:{source:'order',field:'id'},right:{source:'approvedProof',field:'orderId'}},
    {id:'order_identity_approval',type:'compare',
      left:{source:'order',field:'id'},right:{source:'approval',field:'orderId'}},
    {id:'order_identity_asset',type:'compare',
      left:{source:'order',field:'id'},right:{source:'productionAsset',field:'orderId'}},
    {id:'revision_at_approval',type:'compare',
      left:{source:'order',field:'revision'},right:{source:'approval',field:'orderRevision'}},
    {id:'approved_proof_version',type:'compare',
      left:{source:'approvedProof',field:'version'},right:{source:'approval',field:'proofVersion'}},
    {id:'approved_proof_digest',type:'compare',
      left:{source:'approvedProof',field:'contentDigest'},right:{source:'approval',field:'proofDigest'}},
    {id:'production_derived_version',type:'compare',
      left:{source:'approval',field:'proofVersion'},right:{source:'productionAsset',field:'basedOnProofVersion'}},
    {id:'order_vs_approved_text',type:'compare',
      left:{source:'order',field:'personalizationText'},right:{source:'approvedProof',field:'personalizationText'}},
    {id:'approved_vs_asset_text',type:'compare',
      left:{source:'approvedProof',field:'personalizationText'},right:{source:'productionAsset',field:'personalizationText'}},
    {id:'approved_vs_asset_font',type:'compare',
      left:{source:'approvedProof',field:'font'},right:{source:'productionAsset',field:'font'}},
    {id:'approved_vs_asset_placement',type:'compare',
      left:{source:'approvedProof',field:'placement'},right:{source:'productionAsset',field:'placement'}},
    {id:'production_asset_fingerprint',type:'required',target:{source:'productionAsset',field:'contentDigest'}},
    {id:'customer_approval_provenance',type:'attestation',source:'approval',verifierId:'proofing-adapter-v1'},
    {id:'production_asset_extraction',type:'coverage',source:'productionAsset',
      aspects:['text','font','placement'],verifierId:'production-extractor-v1'}
  ]
});

export function exampleAction() {
  return {type:'production_handoff',subjectRef:'ORDER-104'};
}
export function exampleEvidence() {
  return {
    order:{fields:{
      id:'ORDER-104',revision:'3',personalizationText:'SOFIA'
    }},
    approvedProof:{fields:{
      orderId:'ORDER-104',version:'proof-v3',contentDigest:'sha256:proof-v3-illustrative',
      personalizationText:'SOFIA',font:'Sans Regular',placement:'front-center'
    }},
    approval:{
      fields:{orderId:'ORDER-104',orderRevision:'3',proofVersion:'proof-v3',
        proofDigest:'sha256:proof-v3-illustrative'},
      attestation:{verifierId:'proofing-adapter-v1',evidenceRef:'approval-verified-104',
        actorRef:'buyer-authorized-104',recordedAt:'2026-10-18T10:00:00Z'}
    },
    productionAsset:{
      fields:{orderId:'ORDER-104',basedOnProofVersion:'proof-v3',
        personalizationText:'SOFIA',font:'Sans Regular',placement:'front-center',
        contentDigest:'sha256:production-vector-104'},
      verifiedAspects:{
        text:{verifierId:'production-extractor-v1',evidenceRef:'extract-text-104'},
        font:{verifierId:'production-extractor-v1',evidenceRef:'extract-font-104'},
        placement:{verifierId:'production-extractor-v1',evidenceRef:'extract-placement-104'}
      }
    }
  };
}
export function exampleTrustedEvidenceRefs() {
  // In a real integration these would be supplied only by authenticated server adapters.
  return [
    'approval.attestation:approval-verified-104',
    'productionAsset.verifiedAspects.text:extract-text-104',
    'productionAsset.verifiedAspects.font:extract-font-104',
    'productionAsset.verifiedAspects.placement:extract-placement-104'
  ];
}
