import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export class LocalDataKeyProvider {
  constructor({ masterKey = randomBytes(32), keyId = 'local-dev-kek' } = {}) { this.masterKey = masterKey; this.keyId = keyId; }
  async generateDataKey() {
    const dataKey = randomBytes(32), iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.masterKey, iv);
    const wrapped = Buffer.concat([c.update(dataKey), c.final()]);
    const tag = c.getAuthTag();
    return { plaintextKey: dataKey, wrappedKey: Buffer.concat([iv, tag, wrapped]), keyId: this.keyId, provider: 'local-dev' };
  }
  async decryptDataKey(blob) {
    const b = Buffer.from(blob), iv = b.subarray(0,12), tag = b.subarray(12,28), wrapped=b.subarray(28);
    const d = createDecipheriv('aes-256-gcm', this.masterKey, iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(wrapped), d.final()]);
  }
}
