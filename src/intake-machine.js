import { ROUTE, validateIntake } from './model.js';
import { resolveIdentity } from './matcher.js';

export const STATE = Object.freeze({
  START: 'start',
  CHECKING: 'checking',
  EXISTING: 'existing',
  CHOICE: 'choice',
  REVIEW: 'review',
  NEW: 'new',
  ERROR: 'error',
  COMPLETE: 'complete'
});

export class IntakeSession {
  constructor() {
    this.reset();
  }

  reset() {
    this.state = STATE.START;
    this.local = {
      input: null,
      result: null,
      selectedCandidateId: null
    };
    this.audit = [];
  }

  check(input, candidates, options = {}) {
    const validation = validateIntake(input);
    if (!validation.ok) return { ok: false, validation };

    this.local.input = structuredClone(input);
    this.state = STATE.CHECKING;

    const result = resolveIdentity(input, candidates, options);
    this.local.result = result;

    if (result.route === ROUTE.EXISTING) this.state = STATE.EXISTING;
    if (result.route === ROUTE.CHOICE) this.state = STATE.CHOICE;
    if (result.route === ROUTE.REVIEW) this.state = STATE.REVIEW;
    if (result.route === ROUTE.NEW) this.state = STATE.NEW;
    if (result.route === ROUTE.ERROR) this.state = STATE.ERROR;

    this.audit.push({
      type: 'identity_resolution',
      route: result.route,
      reason: result.reason,
      candidateCount: result.candidates.length,
      timestamp: new Date().toISOString()
    });

    return { ok: true, result, state: this.state };
  }

  select(candidateId) {
    if (this.state !== STATE.CHOICE) throw new Error('selection_not_allowed');
    const exists = this.local.result.candidates.some(x => x.candidate.id === candidateId);
    if (!exists) throw new Error('unknown_candidate');
    this.local.selectedCandidateId = candidateId;
    this.audit.push({
      type: 'manual_resolution',
      decision: 'use_existing',
      candidateId,
      timestamp: new Date().toISOString()
    });
  }

  chooseNew() {
    if (this.state !== STATE.CHOICE) throw new Error('new_case_choice_not_allowed');
    this.local.selectedCandidateId = 'new';
    this.audit.push({
      type: 'manual_resolution',
      decision: 'create_new',
      timestamp: new Date().toISOString()
    });
  }

  canContinue() {
    if (this.state === STATE.EXISTING || this.state === STATE.NEW) return true;
    if (this.state === STATE.CHOICE) return Boolean(this.local.selectedCandidateId);
    if (this.state === STATE.REVIEW) return false;
    return false;
  }

  complete() {
    if (!this.canContinue()) throw new Error('cannot_complete');
    this.state = STATE.COMPLETE;
    this.audit.push({ type: 'session_complete', timestamp: new Date().toISOString() });

    // Shared-device privacy invariant: personally entered values must not remain in local UI state.
    this.local.input = null;
    this.local.result = null;
    this.local.selectedCandidateId = null;
  }
}
