import { AUDIT_ACTION, DATA_CLASS, LEGAL_BASIS, RESULT } from '../event-catalog.js';

export class RotationManager {
  constructor({ registry, ledger, purpose={code:'cryptographic_key_management',version:'1.0'}, legalBasis={basis:LEGAL_BASIS.NOT_APPLICABLE,reference:'security-control'} }={}) {
    if(!registry)throw new Error('key_registry_required'); Object.assign(this,{registry,ledger,purpose,legalBasis});
  }
  rotate({ oldKeyId, newKey, actor, reason='scheduled_rotation' }) {
    const registered=this.registry.register(newKey); this.registry.setStatus(oldKeyId,'retired',{reason});
    if(this.ledger) this.ledger.append({actor,action:AUDIT_ACTION.KEY_ROTATED,result:RESULT.SUCCESS,reasonCode:reason,purpose:this.purpose,legalBasis:this.legalBasis,object:{type:'cryptographic_key',ref:oldKeyId},dataClasses:[DATA_CLASS.AUDIT_METADATA],metadata:{newKeyId:registered.keyId,newAlgorithm:registered.algorithm}});
    return registered;
  }
}
