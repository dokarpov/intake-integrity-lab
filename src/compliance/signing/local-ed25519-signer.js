import { generateKeyPairSync, sign as nodeSign, verify as nodeVerify } from 'node:crypto';
import { canonicalize } from '../canonical-json.js';

export class LocalEd25519Signer {
  constructor({ keyId = 'local-ed25519-dev', privateKeyPem, publicKeyPem } = {}) {
    if (!privateKeyPem || !publicKeyPem) {
      const { publicKey, privateKey } = generateKeyPairSync('ed25519');
      publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
      privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    }
    this.keyId = keyId;
    this.algorithm = 'Ed25519';
    this.privateKeyPem = privateKeyPem;
    this.publicKeyPem = publicKeyPem;
    this.securityBoundary = 'process-memory-dev-only';
  }

  async sign(value) {
    const payload = Buffer.from(canonicalize(value), 'utf8');
    const signature = nodeSign(null, payload, this.privateKeyPem).toString('base64');
    return { keyId: this.keyId, algorithm: this.algorithm, signature, encoding: 'base64' };
  }

  async verify(value, signature) {
    const payload = Buffer.from(canonicalize(value), 'utf8');
    return nodeVerify(null, payload, this.publicKeyPem, Buffer.from(signature.signature || signature, 'base64'));
  }

  async getPublicKey() {
    return { keyId: this.keyId, algorithm: this.algorithm, publicKeyPem: this.publicKeyPem };
  }
}
