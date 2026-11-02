import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

function assertKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('review_envelope_32_byte_key_required');
}
function assertIdentity(tenantId,intakeId) {
  if (!tenantId || !intakeId || typeof tenantId!=='string' || typeof intakeId!=='string') throw new Error('review_envelope_identity_required');
}
function validatedExpiry(expiresAt,now) {
  const expires=Date.parse(expiresAt);
  if (!Number.isFinite(expires) || expires <= Date.parse(now)) throw new Error('review_envelope_expired_or_invalid');
}
function aad(tenantId,intakeId,expiresAt) {
  return Buffer.from(JSON.stringify({v:1,tenantId,intakeId,expiresAt}),'utf8');
}
export function sealReviewEnvelope(envelope,{key,tenantId,intakeId,expiresAt,keyId='review-k1',now=new Date().toISOString()}={}) {
  assertKey(key);assertIdentity(tenantId,intakeId);validatedExpiry(expiresAt,now);
  if (!envelope || envelope.intakeId!==intakeId) throw new Error('review_envelope_intake_mismatch');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(aad(tenantId,intakeId,expiresAt));
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(envelope),'utf8'),cipher.final()]);
  return {v:1,keyId,expiresAt,iv:iv.toString('base64url'),tag:cipher.getAuthTag().toString('base64url'),ciphertext:ciphertext.toString('base64url')};
}
export function unsealReviewEnvelope(sealed,{key,tenantId,intakeId,now=new Date().toISOString()}={}) {
  assertKey(key);assertIdentity(tenantId,intakeId);
  if (sealed?.v!==1 || typeof sealed.expiresAt!=='string') throw new Error('review_envelope_format_invalid');
  validatedExpiry(sealed.expiresAt,now);
  try {
    const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(sealed.iv,'base64url'));
    decipher.setAAD(aad(tenantId,intakeId,sealed.expiresAt));
    decipher.setAuthTag(Buffer.from(sealed.tag,'base64url'));
    const plaintext=Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext,'base64url')),decipher.final()]);
    const result=JSON.parse(plaintext.toString('utf8'));
    if (result.intakeId!==intakeId) throw new Error('review_envelope_intake_mismatch');
    return result;
  } catch {throw new Error('review_envelope_authentication_failed');}
}
