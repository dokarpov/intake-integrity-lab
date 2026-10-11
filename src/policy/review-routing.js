/**
 * Review routing policy for sales intake.
 *
 * Product rule (aligned with Decision Systems + Agentic Approval):
 * - Ambiguous identity / high-consequence intake → person, high priority
 * - Clear low-consequence → system may proceed without review
 * - Irreversible CRM/1C writes always escalate when ambiguous
 *
 * This module does not replace the ReviewQueue. It classifies *why* and
 * *how urgently* a human should see an item.
 */

export const PRIORITY = {
  P0: 'P0', // identity / compliance / irreversible write risk
  P1: 'P1', // consequential but reversible or policy edge
  P2: 'P2'  // low urgency clarification
};

/**
 * @param {{
 *   reason: string,
 *   clear?: boolean,
 *   consequential?: boolean,
 *   reversible?: boolean,
 *   hasPersonalData?: boolean,
 *   deliveryTarget?: 'crm'|'1c'|'none'
 * }} signal
 */
export function classifyReview(signal = {}) {
  const {
    reason = 'unspecified',
    clear = false,
    consequential = true,
    reversible = false,
    hasPersonalData = true,
    deliveryTarget = 'crm'
  } = signal;

  const traits = { clear, consequential, reversible, hasPersonalData, deliveryTarget };

  // Identity / dedup ambiguity is always human + high priority
  if (/identity|dedup|duplicate|match/i.test(reason)) {
    return {
      decider: 'person',
      priority: PRIORITY.P0,
      reasonCode: 'identity_ambiguity',
      traits,
      slaHintHours: 4
    };
  }

  // Consent / legal basis / DSR-related
  if (/consent|legal.?basis|dsr|erasure|privacy/i.test(reason)) {
    return {
      decider: 'person',
      priority: PRIORITY.P0,
      reasonCode: 'privacy_gate',
      traits,
      slaHintHours: 8
    };
  }

  // Irreversible delivery to system of record
  if (!reversible && (deliveryTarget === '1c' || deliveryTarget === 'crm')) {
    if (!clear || consequential) {
      return {
        decider: 'person',
        priority: PRIORITY.P0,
        reasonCode: 'irreversible_delivery',
        traits,
        slaHintHours: 4
      };
    }
  }

  if (!clear && consequential) {
    return {
      decider: 'person',
      priority: PRIORITY.P1,
      reasonCode: 'ambiguous_and_consequential',
      traits,
      slaHintHours: 24
    };
  }

  if (!clear) {
    return {
      decider: 'person',
      priority: PRIORITY.P2,
      reasonCode: 'ambiguous',
      traits,
      slaHintHours: 48
    };
  }

  // Clear + low consequence → system path (no review required)
  if (clear && !consequential) {
    return {
      decider: 'system',
      priority: null,
      reasonCode: 'clear_low_consequence',
      traits,
      slaHintHours: null
    };
  }

  return {
    decider: 'person',
    priority: PRIORITY.P1,
    reasonCode: 'consequential',
    traits,
    slaHintHours: 24
  };
}

/**
 * Enrich a queue item with routing classification before enqueue.
 */
export function enrichForQueue(item, signal) {
  const routing = classifyReview(signal);
  return {
    ...item,
    routing,
    priority: routing.priority,
    slaHintHours: routing.slaHintHours
  };
}
