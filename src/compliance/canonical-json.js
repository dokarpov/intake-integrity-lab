function normalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical_json_non_finite_number');
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const v = value[key];
      if (v !== undefined) out[key] = normalize(v);
    }
    return out;
  }
  throw new TypeError(`canonical_json_unsupported_type:${typeof value}`);
}

export function canonicalize(value) {
  return JSON.stringify(normalize(value));
}
