/**
 * Evidence checkpoint: an advisory, deterministic, read-only rules evaluator.
 *
 * This module NEVER decides whether a real-world action may execute. It cannot
 * modify an external workflow status, manufacture consent or verify signatures.
 * Callers must authenticate sources and authorize decisions outside this module.
 */
const TYPES = new Set(['compare', 'required', 'attestation', 'coverage']);
const scalar = value => ['string', 'number', 'boolean'].includes(typeof value) && (typeof value !== 'number' || Number.isFinite(value));
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const owned = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const text = value => typeof value === 'string' ? value.trim() : '';
const maxRules = 100;

function validLocator(v) {
  return v && typeof v === 'object' && nonempty(v.source) && nonempty(v.field) &&
    !['__proto__', 'constructor', 'prototype'].includes(v.source) &&
    !['__proto__', 'constructor', 'prototype'].includes(v.field);
}
function validatePolicy(policy) {
  if (!policy || !nonempty(policy.id) || !nonempty(policy.version) ||
      !Array.isArray(policy.rules) || !policy.rules.length || policy.rules.length > maxRules) {
    throw new TypeError('invalid_evidence_policy');
  }
  const ids = new Set();
  for (const rule of policy.rules) {
    if (!rule || !nonempty(rule.id) || ids.has(rule.id) || !TYPES.has(rule.type)) {
      throw new TypeError('invalid_or_duplicate_rule');
    }
    ids.add(rule.id);
    if (rule.type === 'compare' && (!validLocator(rule.left) || !validLocator(rule.right))) {
      throw new TypeError('compare_requires_two_locators');
    }
    if (rule.type === 'required' && !validLocator(rule.target)) {
      throw new TypeError('required_rule_needs_locator');
    }
    if (rule.type === 'attestation' &&
        (!nonempty(rule.source) || !nonempty(rule.verifierId))) {
      throw new TypeError('attestation_needs_source_and_verifier');
    }
    if (rule.type === 'coverage' &&
        (!nonempty(rule.source) || !nonempty(rule.verifierId) ||
          !Array.isArray(rule.aspects) || !rule.aspects.length ||
          !rule.aspects.every(nonempty) || new Set(rule.aspects).size !== rule.aspects.length)) {
      throw new TypeError('coverage_needs_aspects_and_verifier');
    }
  }
}
function readField(evidence, locator) {
  const source = evidence?.[locator.source];
  const obj = source?.fields;
  if (!obj || typeof obj !== 'object' || !owned(obj, locator.field)) return {exists:false};
  const value = obj[locator.field];
  return scalar(value) && (typeof value !== 'string' || value.length > 0)
    ? {exists:true,value}
    : {exists:false};
}
function reference(locator) { return locator.source + '.' + locator.field; }
function attestationFor(evidence, rule, trustedRefs) {
  const att = evidence?.[rule.source]?.attestation;
  return att && att.verifierId === rule.verifierId && nonempty(att.evidenceRef) &&
    nonempty(att.actorRef) && nonempty(att.recordedAt) &&
    trustedRefs.has(rule.source+'.attestation:'+att.evidenceRef);
}
/**
 * @param {{policy:object, evidence:object, proposedAction:{type:string,subjectRef:string}}} input
 * @returns {{findings:object[], unresolvedRuleIds:string[], suggestsHumanReview:boolean,
 *            businessDecision:null, workflowStatus:null, actionExecuted:false}}
 *
 * 'consistent' is a comparison observation, never production authorization.
 * 'unverifiable' indicates missing or untrusted evidence, not a false statement.
 * For authenticated claims, the adapter must validate verifierId, actorRef and
 * evidenceRef server-side and pass trustedEvidenceRefs as a separate, trusted
 * argument. Raw user JSON, even with matching verifierId, cannot attest itself.
 * This function is advisory even if every comparison agrees.
 */
export function evaluateEvidenceCheckpoint({ policy, evidence = {}, proposedAction, trustedEvidenceRefs = [] } = {}) {
  validatePolicy(policy);
  if (!proposedAction || !nonempty(proposedAction.type) || !nonempty(proposedAction.subjectRef)) {
    throw new TypeError('proposed_action_context_required');
  }
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new TypeError('evidence_must_be_named_records');
  }
  if (!Array.isArray(trustedEvidenceRefs) || !trustedEvidenceRefs.every(nonempty)) {
    throw new TypeError('trusted_evidence_refs_must_be_list');
  }
  // The authenticated server/adapter, not an end-user, must supply these refs.
  const trustedRefs = new Set(trustedEvidenceRefs);
  const findings = policy.rules.map(rule => {
    const base = {ruleId:rule.id, ruleType:rule.type};
    if (rule.type === 'required') {
      const found = readField(evidence, rule.target);
      return {...base, observation:found.exists?'present':'missing_evidence',
        references:[reference(rule.target)],
        detail:found.exists?'Required field was supplied.':'Required field is absent or empty.'};
    }
    if (rule.type === 'compare') {
      const left = readField(evidence,rule.left),right = readField(evidence,rule.right);
      const references=[reference(rule.left),reference(rule.right)];
      if (!left.exists || !right.exists) {
        return {...base,observation:'missing_evidence',references,
          detail:'Cannot compare: at least one required value is absent.'};
      }
      // Exact comparison: case, whitespace, Unicode confusables and type matter.
      const same=typeof left.value === typeof right.value && left.value === right.value;
      return {...base,observation:same?'consistent':'difference',references,
        leftValue:left.value,rightValue:right.value,
        detail:same?'Supplied values are identical; no action is authorized by this observation.':
          'Supplied values differ. The evaluator cannot select an authoritative value.'};
    }
    if (rule.type === 'attestation') {
      const verified=attestationFor(evidence,rule,trustedRefs);
      return {...base,observation:verified?'attestation_present':'unverifiable',
        references:[rule.source+'.attestation'],
        detail:verified?'Attestation metadata matches the configured verifier (adapter validation required).':
          'Required attestation metadata is missing or does not match the configured verifier.'};
    }
    const claims=evidence[rule.source]?.verifiedAspects;
    const missing=rule.aspects.filter(aspect => {
      const claim=claims?.[aspect];
      return !claim || claim.verifierId !== rule.verifierId || !nonempty(claim.evidenceRef) ||
        !trustedRefs.has(rule.source+'.verifiedAspects.'+aspect+':'+claim.evidenceRef);
    });
    return {...base,observation:missing.length?'unverifiable':'coverage_declared',
      references:rule.aspects.map(x=>rule.source+'.verifiedAspects.'+x),
      missingAspects:missing,
      detail:missing.length?'No verified extraction claim for: '+missing.join(', ')+'.':
        'All required aspects have claims from the configured verifier (adapter validation required).'};
  });
  const unresolvedRuleIds=findings.filter(x=>!['consistent','present','attestation_present','coverage_declared'].includes(x.observation))
    .map(x=>x.ruleId);
  return {
    policyRef:{id:policy.id,version:policy.version},
    proposedAction:{type:proposedAction.type,subjectRef:proposedAction.subjectRef},
    findings,
    unresolvedRuleIds,
    suggestsHumanReview:unresolvedRuleIds.length>0,
    // Explicitly NOT a permission-to-produce, order state or business approval.
    businessDecision:null,
    workflowStatus:null,
    actionExecuted:false
  };
}
