function getPath(object, path) {
  return path.split('.').reduce((value, key) => value == null ? undefined : value[key], object);
}

export function mapFields(envelope, fieldMap = {}) {
  const output = {};
  for (const [targetField, sourcePath] of Object.entries(fieldMap)) {
    const value = getPath(envelope, sourcePath);
    if (value !== undefined && value !== '') output[targetField] = value;
  }
  return output;
}

export function defaultCanonicalView(envelope) {
  return {
    intakeId: envelope.intakeId,
    submittedAt: envelope.submittedAt,
    source: envelope.source,
    primaryContact: envelope.primaryContact,
    sales: envelope.sales,
    consents: envelope.consents,
    notes: envelope.notes
  };
}
