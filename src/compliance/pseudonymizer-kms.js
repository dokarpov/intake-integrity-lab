import { canonicalize } from './canonical-json.js';

export class AwsKmsHmacPseudonymizer {
  constructor({ client, keyId, macAlgorithm = 'HMAC_SHA_256', prefix = 'sub', commands } = {}) {
    if (!client || !keyId) throw new Error('aws_kms_hmac_config_required');
    this.client=client; this.keyId=keyId; this.macAlgorithm=macAlgorithm; this.prefix=prefix; this.commands=commands||null;
  }
  static async fromDefault({ keyId, region, macAlgorithm='HMAC_SHA_256', prefix='sub' }) {
    const sdk=await import('@aws-sdk/client-kms');
    return new AwsKmsHmacPseudonymizer({client:new sdk.KMSClient({region}),keyId,macAlgorithm,prefix,commands:{GenerateMac:i=>new sdk.GenerateMacCommand(i)}});
  }
  cmd(name,input){return this.commands?.[name]?this.commands[name](input):{operation:name,input};}
  async subjectRef(value,namespace='default'){
    if(value==null||value==='')throw new Error('subject_value_required');
    const message=Buffer.from(canonicalize({namespace,value:String(value)}),'utf8');
    const r=await this.client.send(this.cmd('GenerateMac',{KeyId:this.keyId,MacAlgorithm:this.macAlgorithm,Message:message}));
    if(!r?.Mac)throw new Error('kms_mac_missing');
    return {ref:`${this.prefix}_${Buffer.from(r.Mac).toString('hex').slice(0,40)}`,keyId:r.KeyId||this.keyId,namespace,algorithm:r.MacAlgorithm||this.macAlgorithm};
  }
}
