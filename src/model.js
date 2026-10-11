export const ROLE = Object.freeze({
  LEARNER: 'learner',
  REPRESENTATIVE: 'representative',
  PAYER: 'payer',
  SUBMITTER: 'submitter'
});

export const ROUTE = Object.freeze({
  EXISTING: 'existing',
  CHOICE: 'choice',
  REVIEW: 'review',
  NEW: 'new',
  ERROR: 'error'
});

export function normalizeText(value = '') {
  return String(value).trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizePhone(value = '') {
  let digits = String(value).replace(/\D/g, '');
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    digits = digits.slice(1);
  }
  return digits;
}

export function validateIntake(input) {
  const errors = [];
  if (normalizeText(input.submitterName).length < 2) errors.push('submitter_name');
  if (normalizePhone(input.phone).length !== 10) errors.push('phone');
  if (!input.consents?.privacy) errors.push('privacy_consent');
  if (!input.consents?.dataProcessing) errors.push('data_processing_consent');
  return { ok: errors.length === 0, errors };
}
