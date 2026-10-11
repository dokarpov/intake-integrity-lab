import { newId, sha256, signCanonical, verifyCanonical } from './crypto.js';

export function createSignedCheckpoint(events, {
  keyId,
  privateKeyPem,
  now = () => new Date().toISOString(),
  checkpointId = newId('checkpoint')
} = {}) {
  if (!events.length) throw new Error('checkpoint_requires_events');
  if (!keyId || !privateKeyPem) throw new Error('checkpoint_signing_key_required');
  const first = events[0];
  const last = events.at(-1);
  const checkpoint = {
    schemaVersion: '1.0',
    checkpointId,
    keyId,
    createdAt: now(),
    fromSequence: first.sequence,
    toSequence: last.sequence,
    eventCount: events.length,
    firstEventHash: first.eventHash,
    terminalEventHash: last.eventHash,
    eventsDigest: sha256(events.map(e => ({ sequence: e.sequence, eventHash: e.eventHash })))
  };
  return { ...checkpoint, signature: signCanonical(checkpoint, privateKeyPem) };
}

export function verifyCheckpoint(checkpoint, events, publicKeyPem) {
  const { signature, ...unsigned } = checkpoint;
  if (!signature || !verifyCanonical(unsigned, signature, publicKeyPem)) return false;
  const selected = events.filter(e => e.sequence >= checkpoint.fromSequence && e.sequence <= checkpoint.toSequence);
  if (selected.length !== checkpoint.eventCount) return false;
  if (!selected.length) return false;
  if (selected[0].eventHash !== checkpoint.firstEventHash) return false;
  if (selected.at(-1).eventHash !== checkpoint.terminalEventHash) return false;
  return sha256(selected.map(e => ({ sequence: e.sequence, eventHash: e.eventHash }))) === checkpoint.eventsDigest;
}
