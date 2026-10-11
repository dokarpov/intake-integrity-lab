import {
  createHash,
  createHmac,
  generateKeyPairSync,
  randomUUID,
  sign as nodeSign,
  verify as nodeVerify
} from 'node:crypto';
import { canonicalize } from './canonical-json.js';

export function sha256(value) {
  const data = typeof value === 'string' ? value : canonicalize(value);
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

export function hmacSha256(value, secret) {
  if (!secret) throw new Error('hmac_secret_required');
  const data = typeof value === 'string' ? value : canonicalize(value);
  return createHmac('sha256', secret).update(data, 'utf8').digest('hex');
}

export function newId(prefix = 'evt') {
  return `${prefix}_${randomUUID()}`;
}

export function generateSigningKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' })
  };
}

export function signCanonical(value, privateKeyPem) {
  const payload = Buffer.from(canonicalize(value), 'utf8');
  return nodeSign(null, payload, privateKeyPem).toString('base64');
}

export function verifyCanonical(value, signatureBase64, publicKeyPem) {
  const payload = Buffer.from(canonicalize(value), 'utf8');
  return nodeVerify(null, payload, publicKeyPem, Buffer.from(signatureBase64, 'base64'));
}
