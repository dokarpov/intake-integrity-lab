import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, signCanonical, verifyCanonical } from './crypto.js';
import { verifyCheckpoint } from './checkpoint.js';

export function buildAuditBundle({ ledger, checkpoints = [], publicKeys = {}, processingActivity, policySnapshot, createdAt = new Date().toISOString() }) {
  const events = ledger.events;
  const integrity = ledger.verifyIntegrity();
  const checkpointResults = checkpoints.map(cp => ({
    checkpointId: cp.checkpointId,
    ok: Boolean(publicKeys[cp.keyId]) && verifyCheckpoint(cp, events, publicKeys[cp.keyId])
  }));
  const manifest = {
    schemaVersion: '1.0',
    createdAt,
    ledgerId: ledger.ledgerId,
    eventCount: events.length,
    terminalEventHash: integrity.terminalEventHash,
    integrityOk: integrity.ok,
    checkpointResults,
    files: {
      events: `sha256:${sha256(events)}`,
      checkpoints: `sha256:${sha256(checkpoints)}`,
      processingActivity: processingActivity ? `sha256:${sha256(processingActivity)}` : null,
      policySnapshot: policySnapshot ? `sha256:${sha256(policySnapshot)}` : null
    }
  };
  return { manifest, events, checkpoints, processingActivity, policySnapshot, integrity };
}

export function signAuditBundle(bundle, { keyId, privateKeyPem }) {
  const signaturePayload = { ...bundle.manifest, signingKeyId: keyId };
  return {
    ...bundle,
    manifest: signaturePayload,
    manifestSignature: signCanonical(signaturePayload, privateKeyPem)
  };
}

export function verifyAuditBundle(bundle, publicKeyPem) {
  if (!bundle.manifestSignature) return false;
  if (!verifyCanonical(bundle.manifest, bundle.manifestSignature, publicKeyPem)) return false;
  if (bundle.manifest.files.events !== `sha256:${sha256(bundle.events)}`) return false;
  if (bundle.manifest.files.checkpoints !== `sha256:${sha256(bundle.checkpoints)}`) return false;
  if (bundle.processingActivity && bundle.manifest.files.processingActivity !== `sha256:${sha256(bundle.processingActivity)}`) return false;
  if (bundle.policySnapshot && bundle.manifest.files.policySnapshot !== `sha256:${sha256(bundle.policySnapshot)}`) return false;
  return true;
}

export function writeAuditBundle(bundle, directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const files = {
    'manifest.json': bundle.manifest,
    'events.json': bundle.events,
    'checkpoints.json': bundle.checkpoints,
    'integrity-report.json': bundle.integrity,
    'processing-activity.json': bundle.processingActivity || null,
    'policy-snapshot.json': bundle.policySnapshot || null,
    'manifest-signature.txt': bundle.manifestSignature || ''
  };
  for (const [name, value] of Object.entries(files)) {
    writeFileSync(join(directory, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  }
  return Object.keys(files);
}

export function markAuditExport(ledger, { exportId, actor, role, purpose, legalBasis, scope = 'ledger', reasonCode = 'authorized_audit_export' }) {
  return ledger.append({
    actor,
    action: 'audit.bundle_exported',
    result: 'success',
    reasonCode,
    purpose,
    legalBasis,
    object: { type: 'audit_export', ref: exportId },
    dataClasses: ['audit_metadata'],
    metadata: { role, scope }
  });
}
