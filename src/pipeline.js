import { buildSalesEnvelope, validateSalesEnvelope } from './sales-envelope.js';
import { resolveIdentity } from './matcher.js';
import { ROUTE } from './model.js';

export const DEDUP_MODE = Object.freeze({
  OFF: 'off',
  LOCAL: 'local',
  EXTERNAL: 'external'
});

const EXTERNAL_ROUTES = new Set(Object.values(ROUTE));

function localInputFromEnvelope(envelope) {
  const primary = envelope.primaryContact || {};
  const beneficiary = envelope.parties?.find(p => p.role === 'beneficiary');
  const representative = envelope.parties?.find(p => p.role === 'authorized_representative');
  return {
    submitterName: primary.name,
    phone: primary.phone,
    learnerName: beneficiary?.name,
    representativeName: representative?.name,
    city: envelope.source?.location,
    consents: envelope.consents
  };
}

/**
 * Universal intake pipeline.
 * - off: no semantic dedup; validate + normalise + continue.
 * - local: use the reference matcher and route ambiguity to review.
 * - external: consume a decision from CRM/1C/another identity service.
 */
export function processSalesIntake(rawInput, {
  dedupMode = DEDUP_MODE.OFF,
  candidates = [],
  externalDecision,
  history,
  reviewQueue,
  envelopeOptions
} = {}) {
  const envelope = buildSalesEnvelope(rawInput, envelopeOptions);
  const validation = validateSalesEnvelope(envelope);
  if (!validation.ok) {
    history?.append({ intakeId: envelope.intakeId, type: 'validation', decision: 'blocked', reason: validation.errors.join(',') });
    return { ok: false, validation, envelope };
  }

  let resolution = { route: ROUTE.NEW, reason: 'dedup_disabled', candidates: [] };

  if (dedupMode === DEDUP_MODE.LOCAL) {
    resolution = resolveIdentity(localInputFromEnvelope(envelope), candidates);
  } else if (dedupMode === DEDUP_MODE.EXTERNAL) {
    if (!externalDecision || !EXTERNAL_ROUTES.has(externalDecision.route)) {
      resolution = { route: ROUTE.ERROR, reason: 'external_dedup_decision_missing_or_invalid', candidates: [] };
    } else {
      resolution = {
        route: externalDecision.route,
        reason: externalDecision.reason || 'external_identity_decision',
        candidates: externalDecision.candidates || []
      };
    }
  }

  history?.append({
    intakeId: envelope.intakeId,
    type: 'routing',
    decision: resolution.route,
    reason: resolution.reason,
    payloadRef: { source: envelope.source, candidateCount: resolution.candidates.length }
  });

  let reviewItem = null;
  if (resolution.route === ROUTE.REVIEW) {
    reviewItem = reviewQueue?.enqueue({
      intakeId: envelope.intakeId,
      reason: resolution.reason,
      candidateRefs: resolution.candidates.map(x => x.candidate?.id || x.id).filter(Boolean),
      context: { source: envelope.source.channel }
    }) || null;
    history?.append({ intakeId: envelope.intakeId, type: 'review_queue', decision: 'enqueued', reason: resolution.reason });
  }

  const deliverable = ![ROUTE.ERROR, ROUTE.REVIEW].includes(resolution.route);
  return { ok: true, envelope, dedupMode, resolution, reviewItem, deliverable };
}
