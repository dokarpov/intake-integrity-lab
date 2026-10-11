import { normalizePhone, normalizeText, ROUTE } from './model.js';

function signalMatch(a, b) {
  return normalizeText(a) && normalizeText(a) === normalizeText(b);
}

function candidateEvidence(input, candidate) {
  const phone = normalizePhone(input.phone) === normalizePhone(candidate.phone);
  const representative = signalMatch(input.representativeName, candidate.representativeName);
  const learner = signalMatch(input.learnerName, candidate.learnerName);
  const city = signalMatch(input.city, candidate.city);

  return { phone, representative, learner, city };
}

function conflicts(input, candidate) {
  const samePhone = normalizePhone(input.phone) === normalizePhone(candidate.phone);
  const learnerProvided = Boolean(normalizeText(input.learnerName));
  const differentLearner = learnerProvided && normalizeText(candidate.learnerName) &&
    normalizeText(input.learnerName) !== normalizeText(candidate.learnerName);

  const representativeProvided = Boolean(normalizeText(input.representativeName));
  const differentRepresentative = representativeProvided && normalizeText(candidate.representativeName) &&
    normalizeText(input.representativeName) !== normalizeText(candidate.representativeName);

  return {
    samePhoneDifferentLearner: samePhone && differentLearner,
    samePhoneDifferentRepresentative: samePhone && differentRepresentative
  };
}

/**
 * Public reference policy, not a recovered production algorithm.
 * The original discovery left numeric auto-match thresholds unresolved,
 * so this implementation deliberately uses explainable categorical rules.
 */
export function resolveIdentity(input, candidates, { backendAvailable = true } = {}) {
  if (!backendAvailable) {
    return {
      route: ROUTE.ERROR,
      reason: 'identity_check_unavailable',
      candidates: []
    };
  }

  const evaluated = candidates.map(candidate => ({
    candidate,
    evidence: candidateEvidence(input, candidate),
    conflicts: conflicts(input, candidate)
  }));

  const exact = evaluated.filter(x =>
    x.evidence.phone &&
    (!normalizeText(input.learnerName) || x.evidence.learner) &&
    (!normalizeText(input.representativeName) || x.evidence.representative) &&
    (!normalizeText(input.city) || x.evidence.city)
  );

  if (exact.length === 1) {
    return {
      route: ROUTE.EXISTING,
      reason: 'single_consistent_candidate',
      candidates: exact
    };
  }

  if (exact.length > 1) {
    return {
      route: ROUTE.CHOICE,
      reason: 'multiple_consistent_candidates',
      candidates: exact
    };
  }

  const plausible = evaluated.filter(x =>
    x.evidence.phone || x.evidence.learner || x.evidence.representative
  );

  const hasConflict = plausible.some(x =>
    x.conflicts.samePhoneDifferentLearner || x.conflicts.samePhoneDifferentRepresentative
  );

  if (hasConflict) {
    return {
      route: ROUTE.REVIEW,
      reason: 'identity_role_conflict',
      candidates: plausible
    };
  }

  if (plausible.length > 1) {
    return {
      route: ROUTE.CHOICE,
      reason: 'multiple_plausible_candidates',
      candidates: plausible
    };
  }

  if (plausible.length === 1) {
    return {
      route: ROUTE.REVIEW,
      reason: 'insufficient_evidence_for_auto_match',
      candidates: plausible
    };
  }

  return {
    route: ROUTE.NEW,
    reason: 'no_plausible_candidate',
    candidates: []
  };
}
