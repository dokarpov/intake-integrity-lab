const PROTECTED_FIELDS = new Set([
  'learnerName',
  'representativeName',
  'payerName',
  'phone',
  'birthDate',
  'role'
]);

export function planRecordUpdate(existing, incoming) {
  const safe = {};
  const review = {};

  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || value === null || value === '') continue;

    if (PROTECTED_FIELDS.has(key) && existing[key] && existing[key] !== value) {
      review[key] = { current: existing[key], proposed: value };
      continue;
    }

    safe[key] = value;
  }

  return { safe, review, requiresReview: Object.keys(review).length > 0 };
}
