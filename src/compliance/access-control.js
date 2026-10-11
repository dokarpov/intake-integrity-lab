import { AUDIT_ACTION, RESULT } from './event-catalog.js';

export const AUDIT_ROLE = Object.freeze({ AUDITOR:'auditor', DPO:'dpo', SECURITY_ADMIN:'security_admin', SUPPORT:'support' });
const PERMISSIONS = Object.freeze({
  [AUDIT_ROLE.AUDITOR]: new Set(['audit.read','audit.export']),
  [AUDIT_ROLE.DPO]: new Set(['audit.read','audit.export','subject.read']),
  [AUDIT_ROLE.SECURITY_ADMIN]: new Set(['audit.read','audit.export','integrity.verify']),
  [AUDIT_ROLE.SUPPORT]: new Set([])
});

export function isAllowed(role, permission) { return Boolean(PERMISSIONS[role]?.has(permission)); }

export class AuditReader {
  constructor({ ledger, purpose, legalBasis, retention }) { Object.assign(this,{ledger,purpose,legalBasis,retention}); }

  async query({ actor, role, tenantId, intakeId, subjectRef, reasonCode='authorized_audit_review', afterSequence=0, limit=100 }) {
    if (!actor?.id) throw new Error('authenticated_actor_required');
    if (tenantId && tenantId !== this.ledger.tenantId) throw new Error('cross_tenant_audit_access_denied');
    const subjectQuery=Boolean(subjectRef), permission=subjectQuery?'subject.read':'audit.read';
    const object={type:subjectQuery?'subject_audit_view':'audit_view',ref:subjectQuery?'subject-scope':(intakeId||'ledger')};
    if(!isAllowed(role,permission)){
      await this.ledger.append({actor,action:AUDIT_ACTION.ACCESS_DENIED,result:RESULT.BLOCKED,reasonCode:'rbac_denied',purpose:this.purpose,legalBasis:this.legalBasis,retention:this.retention,object,dataClasses:['audit_metadata'],metadata:{role,permission}});
      throw new Error('audit_access_denied');
    }
    await this.ledger.append({actor,action:AUDIT_ACTION.ACCESS_GRANTED,result:RESULT.SUCCESS,reasonCode,purpose:this.purpose,legalBasis:this.legalBasis,retention:this.retention,object,dataClasses:['audit_metadata'],metadata:{role,permission}});
    if (this.ledger.query) return this.ledger.query({intakeId,subjectRef,afterSequence,limit});
    const all = this.ledger.events || [];
    const ref = typeof subjectRef === 'string' ? subjectRef : subjectRef?.ref;
    return all.filter(e => e.sequence > afterSequence)
      .filter(e => !intakeId || e.intakeId === intakeId)
      .filter(e => !ref || (typeof e.subjectRef === 'string' ? e.subjectRef : e.subjectRef?.ref) === ref)
      .slice(0, limit);
  }
}
