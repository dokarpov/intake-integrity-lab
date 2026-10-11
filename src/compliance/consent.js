import { AUDIT_ACTION, DATA_CLASS, RESULT } from './event-catalog.js';
import { sha256 } from './crypto.js';

export function recordConsent(ledger, {
  intakeId,
  subjectRef,
  actor,
  purpose,
  legalBasis,
  consentType,
  documentId,
  documentVersion,
  documentText,
  granted = true,
  channel = 'web'
}) {
  if (!documentId || !documentVersion) throw new Error('consent_document_version_required');
  const policyRef = `${documentId}@${documentVersion}`;
  return ledger.append({
    intakeId,
    subjectRef,
    actor,
    action: granted ? AUDIT_ACTION.CONSENT_GRANTED : AUDIT_ACTION.CONSENT_WITHDRAWN,
    result: RESULT.SUCCESS,
    reasonCode: granted ? 'explicit_user_action' : 'withdrawal_request',
    purpose,
    legalBasis,
    object: { type: 'consent', ref: consentType },
    dataClasses: [DATA_CLASS.CONSENT],
    policyRefs: [policyRef],
    evidenceRefs: documentText ? [`sha256:${sha256(documentText)}`] : [],
    metadata: { consentType, channel, documentVersion }
  });
}
