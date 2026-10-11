import { AUDIT_ACTION, DATA_CLASS, RESULT } from './event-catalog.js';
import { sha256 } from './crypto.js';

export async function recordDeliveryAttempt(ledger, { envelope, request, actor, purpose, legalBasis, retention, destination = '1c' }) {
  return ledger.append({
    intakeId: envelope.intakeId,
    actor,
    action: AUDIT_ACTION.DELIVERY_ATTEMPTED,
    result: RESULT.PENDING,
    reasonCode: 'outbound_delivery',
    purpose,
    legalBasis,
    retention,
    object: { type: 'sales_intake', ref: envelope.intakeId },
    dataClasses: [DATA_CLASS.CONTACT, DATA_CLASS.SALES],
    recipient: { system: destination, endpointRef: sha256(request.url).slice(0, 24) },
    evidenceRefs: [`request:${sha256(request.body)}`],
    metadata: { method: request.method, destination }
  });
}

export async function recordDeliveryResult(ledger, { envelope, actor, purpose, legalBasis, retention, destination = '1c', ok, statusCode, externalRecordRef, responseBody }) {
  return ledger.append({
    intakeId: envelope.intakeId,
    actor,
    action: ok ? AUDIT_ACTION.DELIVERY_SUCCEEDED : AUDIT_ACTION.DELIVERY_FAILED,
    result: ok ? RESULT.SUCCESS : RESULT.FAILURE,
    reasonCode: ok ? 'receiver_acknowledged' : 'receiver_rejected_or_unavailable',
    purpose,
    legalBasis,
    retention,
    object: { type: 'sales_intake', ref: envelope.intakeId },
    dataClasses: [DATA_CLASS.AUDIT_METADATA],
    recipient: { system: destination, externalRecordRef },
    evidenceRefs: responseBody === undefined ? [] : [`response:${sha256(responseBody)}`],
    metadata: { destination, statusCode: statusCode ?? null }
  });
}
