import { createSignedCheckpoint, verifyCheckpoint } from './checkpoint.js';

export class CheckpointManager {
  constructor({ ledger, store, keyId, privateKeyPem, publicKeyPem, now = () => new Date().toISOString() }) {
    if (!ledger || !store || !keyId || !privateKeyPem || !publicKeyPem) throw new Error('checkpoint_manager_config_required');
    this.ledger = ledger;
    this.store = store;
    this.keyId = keyId;
    this.privateKeyPem = privateKeyPem;
    this.publicKeyPem = publicKeyPem;
    this.now = now;
  }

  seal({ fromSequence } = {}) {
    const existing = this.store.all();
    const start = fromSequence ?? (existing.at(-1)?.toSequence ? existing.at(-1).toSequence + 1 : 1);
    const events = this.ledger.events.filter(e => e.sequence >= start);
    if (!events.length) return null;
    const checkpoint = createSignedCheckpoint(events, {
      keyId: this.keyId,
      privateKeyPem: this.privateKeyPem,
      now: this.now
    });
    this.store.append(checkpoint);
    return checkpoint;
  }

  verifyAll() {
    return this.store.all().map(cp => ({ checkpointId: cp.checkpointId, ok: verifyCheckpoint(cp, this.ledger.events, this.publicKeyPem) }));
  }
}
