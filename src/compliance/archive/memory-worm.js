import { createHash } from 'node:crypto';

export class MemoryWormArchive {
  constructor({name='memory-worm-test'}={}){this.name=name;this.objects=new Map();this.kind='memory-worm-test'}
  async preflight(){return{ok:true,testOnly:true}}
  async archive({key,bytes,now=new Date(),retainUntil,retentionDays=3650,legalHold=false}){
    if(this.objects.has(key))throw new Error('worm_overwrite_blocked');const body=Buffer.isBuffer(bytes)?Buffer.from(bytes):Buffer.from(bytes);const until=retainUntil?new Date(retainUntil):new Date(now.getTime()+retentionDays*86400000);const receipt={archiveKind:this.kind,bucket:this.name,key,versionId:`v-${this.objects.size+1}`,checksumSHA256Base64:createHash('sha256').update(body).digest('base64'),objectLockMode:'COMPLIANCE',retainUntil:until.toISOString(),legalHold,archivedAt:now.toISOString()};this.objects.set(key,{body,receipt});return structuredClone(receipt)
  }
}
