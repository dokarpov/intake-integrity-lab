export const KEY_STATUS = Object.freeze({ ACTIVE: 'active', RETIRED: 'retired', REVOKED: 'revoked', DESTROYED: 'destroyed' });
export const KEY_PURPOSE = Object.freeze({ CHECKPOINT_SIGNING: 'checkpoint_signing', SUBJECT_HMAC: 'subject_hmac', ARCHIVE_ENCRYPTION: 'archive_encryption' });

export class KeyRegistry {
  constructor(entries = []) { this.entries = entries.map(x => structuredClone(x)); }

  register(entry) {
    if (!entry?.keyId || !entry?.purpose || !entry?.algorithm) throw new Error('invalid_key_registry_entry');
    if (this.entries.some(x => x.keyId === entry.keyId)) throw new Error('duplicate_key_id');
    const record = { status: KEY_STATUS.ACTIVE, createdAt: new Date().toISOString(), ...structuredClone(entry) };
    this.entries.push(record);
    return structuredClone(record);
  }

  setStatus(keyId, status, { at = new Date().toISOString(), reason } = {}) {
    if (!Object.values(KEY_STATUS).includes(status)) throw new Error('invalid_key_status');
    const entry = this.entries.find(x => x.keyId === keyId);
    if (!entry) throw new Error('unknown_key');
    entry.status = status;
    entry.statusChangedAt = at;
    entry.statusReason = reason;
    return structuredClone(entry);
  }

  activeFor(purpose) {
    const candidates = this.entries.filter(x => x.purpose === purpose && x.status === KEY_STATUS.ACTIVE);
    if (candidates.length !== 1) throw new Error(`active_key_cardinality:${purpose}:${candidates.length}`);
    return structuredClone(candidates[0]);
  }

  snapshot() { return this.entries.map(x => structuredClone(x)); }
}
