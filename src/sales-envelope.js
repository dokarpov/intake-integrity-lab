import { normalizePhone, normalizeText } from './model.js';
import { makeId } from './util.js';

export const PARTY_ROLE = Object.freeze({
  PRIMARY_CONTACT: 'primary_contact',
  BUYER: 'buyer',
  BILLING_CONTACT: 'billing_contact',
  AUTHORIZED_REPRESENTATIVE: 'authorized_representative',
  BENEFICIARY: 'beneficiary',
  OTHER: 'other'
});

function clean(value) {
  const v = value == null ? '' : String(value).trim();
  return v || undefined;
}

function normaliseParty(party) {
  return {
    role: party.role || PARTY_ROLE.OTHER,
    name: clean(party.name),
    phone: party.phone ? normalizePhone(party.phone) : undefined,
    email: clean(party.email)?.toLowerCase(),
    company: clean(party.company),
    externalId: clean(party.externalId)
  };
}

export function buildSalesEnvelope(input, {
  intakeId = makeId('intake'),
  now = () => new Date().toISOString()
} = {}) {
  const primary = normaliseParty({
    role: PARTY_ROLE.PRIMARY_CONTACT,
    name: input.primaryContact?.name ?? input.submitterName,
    phone: input.primaryContact?.phone ?? input.phone,
    email: input.primaryContact?.email ?? input.email,
    company: input.primaryContact?.company ?? input.company
  });

  const additional = (input.parties || []).map(normaliseParty);
  const parties = [primary, ...additional].filter(p => p.name || p.phone || p.email || p.externalId);

  return {
    schemaVersion: '1.0',
    intakeId,
    submittedAt: now(),
    source: {
      channel: clean(input.source?.channel) || 'unknown',
      campaign: clean(input.source?.campaign),
      location: clean(input.source?.location)
    },
    primaryContact: primary,
    parties,
    sales: {
      productCode: clean(input.sales?.productCode),
      offerCode: clean(input.sales?.offerCode),
      amount: Number.isFinite(input.sales?.amount) ? input.sales.amount : undefined,
      currency: clean(input.sales?.currency),
      managerExternalId: clean(input.sales?.managerExternalId),
      pipeline: clean(input.sales?.pipeline),
      stage: clean(input.sales?.stage)
    },
    consents: {
      privacy: Boolean(input.consents?.privacy),
      dataProcessing: Boolean(input.consents?.dataProcessing),
      marketing: Boolean(input.consents?.marketing)
    },
    notes: clean(input.notes),
    metadata: { ...(input.metadata || {}) }
  };
}

export function validateSalesEnvelope(envelope) {
  const errors = [];
  const contact = envelope.primaryContact || {};
  if (!normalizeText(contact.name) && !normalizePhone(contact.phone) && !contact.email) {
    errors.push('primary_contact_required');
  }
  if (!envelope.consents?.privacy) errors.push('privacy_consent');
  if (!envelope.consents?.dataProcessing) errors.push('data_processing_consent');
  if (!envelope.intakeId) errors.push('intake_id');
  return { ok: errors.length === 0, errors };
}
