import { CONTROLLED_ACTION, controlledPayloadDigest } from '../approvals/two-person-control.js';
import { AUDIT_ACTION, DATA_CLASS, LEGAL_BASIS, RESULT } from '../event-catalog.js';

export class ControlledWormAdmin {
  constructor({archive,approvals,ledger,purpose={code:'records_retention_control',version:'1.0'},legalBasis={basis:LEGAL_BASIS.LEGAL_OBLIGATION,reference:'retention-policy'},retention}={}){
    if(!archive||!approvals)throw new Error('controlled_worm_admin_config_required');Object.assign(this,{archive,approvals,ledger,purpose,legalBasis,retention});
  }
  async releaseLegalHold({approvalId,key,versionId,actor}){
    const payloadDigest=controlledPayloadDigest(CONTROLLED_ACTION.LEGAL_HOLD_RELEASE,{key,versionId,on:false});
    const approval=await this.approvals.consume(approvalId,{action:CONTROLLED_ACTION.LEGAL_HOLD_RELEASE,payloadDigest});
    const result=await this.archive.setLegalHold({key,versionId,on:false});
    if(this.ledger)await this.ledger.append({actor,action:AUDIT_ACTION.LEGAL_HOLD_RELEASED,result:RESULT.SUCCESS,reasonCode:'two_person_approved_release',purpose:this.purpose,legalBasis:this.legalBasis,retention:this.retention,object:{type:'worm_object_version',ref:`${key}@${versionId}`},dataClasses:[DATA_CLASS.AUDIT_METADATA],metadata:{approvalId:approval.id}});
    return result;
  }
  async extendRetention({key,versionId,retainUntil,actor}){
    const result=await this.archive.extendRetention({key,versionId,retainUntil});
    if(this.ledger)await this.ledger.append({actor,action:AUDIT_ACTION.RETENTION_ASSIGNED,result:RESULT.SUCCESS,reasonCode:'worm_retention_extended',purpose:this.purpose,legalBasis:this.legalBasis,retention:this.retention,object:{type:'worm_object_version',ref:`${key}@${versionId}`},dataClasses:[DATA_CLASS.AUDIT_METADATA],metadata:{retainUntil:result.retainUntil}});
    return result;
  }
}
