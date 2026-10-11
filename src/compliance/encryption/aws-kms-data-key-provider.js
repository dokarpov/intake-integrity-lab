export class AwsKmsDataKeyProvider {
  constructor({ client, keyId, commands, contextBase = {} } = {}) {
    if (!client || !keyId) throw new Error('aws_kms_data_key_config_required');
    this.client=client; this.keyId=keyId; this.commands=commands||null; this.contextBase={...contextBase};
  }
  static async fromDefault({ keyId, region, contextBase }) {
    const sdk=await import('@aws-sdk/client-kms');
    return new AwsKmsDataKeyProvider({client:new sdk.KMSClient({region}),keyId,contextBase,commands:{GenerateDataKey:i=>new sdk.GenerateDataKeyCommand(i),Decrypt:i=>new sdk.DecryptCommand(i)}});
  }
  cmd(name,input){return this.commands?.[name]?this.commands[name](input):{operation:name,input}}
  async generateDataKey({ context = {} } = {}) {
    const EncryptionContext={...this.contextBase,...context};
    const r=await this.client.send(this.cmd('GenerateDataKey',{KeyId:this.keyId,KeySpec:'AES_256',EncryptionContext}));
    if(!r?.Plaintext||!r?.CiphertextBlob)throw new Error('kms_data_key_missing');
    return{plaintextKey:Buffer.from(r.Plaintext),wrappedKey:Buffer.from(r.CiphertextBlob),keyId:r.KeyId||this.keyId,provider:'aws-kms',encryptionContext:EncryptionContext};
  }
  async decryptDataKey(wrappedKey,{ context = {}, keyId }={}){
    const EncryptionContext={...this.contextBase,...context};
    const r=await this.client.send(this.cmd('Decrypt',{CiphertextBlob:wrappedKey,KeyId:keyId||this.keyId,EncryptionContext}));
    if(!r?.Plaintext)throw new Error('kms_decrypt_missing_plaintext');return Buffer.from(r.Plaintext);
  }
}
