import { createHash } from 'node:crypto';
import { canonicalize } from '../canonical-json.js';

function sha256Bytes(value) {
  return createHash('sha256').update(Buffer.from(canonicalize(value), 'utf8')).digest();
}

function derSpkiFromBase64(der) {
  const b64 = Buffer.from(der).toString('base64');
  return `-----BEGIN PUBLIC KEY-----\n${b64.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----\n`;
}

export class AwsKmsSigner {
  constructor({ client, keyId, signingAlgorithm = 'ECDSA_SHA_256', commands } = {}) {
    if (!client || !keyId) throw new Error('aws_kms_signer_config_required');
    this.client = client;
    this.keyId = keyId;
    this.algorithm = signingAlgorithm;
    this.commands = commands || null;
    this.securityBoundary = 'aws-kms-hsm';
  }

  static async fromDefault({ keyId, region, signingAlgorithm = 'ECDSA_SHA_256' }) {
    const sdk = await import('@aws-sdk/client-kms');
    const client = new sdk.KMSClient({ region });
    return new AwsKmsSigner({
      client,
      keyId,
      signingAlgorithm,
      commands: {
        Sign: input => new sdk.SignCommand(input),
        Verify: input => new sdk.VerifyCommand(input),
        GetPublicKey: input => new sdk.GetPublicKeyCommand(input)
      }
    });
  }

  cmd(name, input) {
    return this.commands?.[name] ? this.commands[name](input) : { operation: name, input };
  }

  async sign(value) {
    const digest = sha256Bytes(value);
    const result = await this.client.send(this.cmd('Sign', {
      KeyId: this.keyId,
      Message: digest,
      MessageType: 'DIGEST',
      SigningAlgorithm: this.algorithm
    }));
    if (!result?.Signature) throw new Error('aws_kms_signature_missing');
    return {
      keyId: result.KeyId || this.keyId,
      algorithm: result.SigningAlgorithm || this.algorithm,
      signature: Buffer.from(result.Signature).toString('base64'),
      encoding: 'base64-der',
      messageType: 'DIGEST',
      digestAlgorithm: 'SHA-256'
    };
  }

  async verify(value, signature) {
    const digest = sha256Bytes(value);
    const result = await this.client.send(this.cmd('Verify', {
      KeyId: this.keyId,
      Message: digest,
      MessageType: 'DIGEST',
      Signature: Buffer.from(signature.signature || signature, 'base64'),
      SigningAlgorithm: signature.algorithm || this.algorithm
    }));
    return Boolean(result?.SignatureValid);
  }

  async getPublicKey() {
    const result = await this.client.send(this.cmd('GetPublicKey', { KeyId: this.keyId }));
    if (!result?.PublicKey) throw new Error('aws_kms_public_key_missing');
    return {
      keyId: result.KeyId || this.keyId,
      algorithm: this.algorithm,
      publicKeyPem: derSpkiFromBase64(result.PublicKey),
      keyUsage: result.KeyUsage,
      keySpec: result.KeySpec
    };
  }

}
