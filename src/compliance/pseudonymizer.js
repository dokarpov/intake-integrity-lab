import { hmacSha256 } from './crypto.js';

export class Pseudonymizer {
  constructor({ secret, keyId = 'subject-hmac-v1', prefix = 'sub' }) {
    if (!secret) throw new Error('pseudonymizer_secret_required');
    this.secret = secret;
    this.keyId = keyId;
    this.prefix = prefix;
  }

  subjectRef(value, namespace = 'default') {
    if (value == null || value === '') throw new Error('subject_value_required');
    return {
      ref: `${this.prefix}_${hmacSha256({ namespace, value: String(value) }, this.secret).slice(0, 40)}`,
      keyId: this.keyId,
      namespace
    };
  }
}
