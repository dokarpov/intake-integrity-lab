import { randomUUID } from 'node:crypto';
import { sha256 } from '../crypto.js';

export const CONTROLLED_ACTION = Object.freeze({
  LEGAL_HOLD_RELEASE: 'legal_hold_release',
  KEY_REVOKE: 'key_revoke',
  KEY_DESTROY: 'key_destroy',
  BREAK_GLASS_ACCESS: 'break_glass_access',
  RETENTION_POLICY_CHANGE: 'retention_policy_change',
  LARGE_AUDIT_EXPORT: 'large_audit_export',
  ARCHIVE_TARGET_CHANGE: 'archive_target_change'
});

export function controlledPayloadDigest(action, payload) {
  return `sha256:${sha256({ action, payload })}`;
}

/**
 * In-memory reference approval engine. Production deployments should use
 * PostgresTwoPersonControl; approvals are always bound to an exact payload digest.
 */
export class TwoPersonControl {
  constructor({ now = () => new Date().toISOString(), ttlMs = 15 * 60_000 } = {}) {
    this.now=now; this.ttlMs=ttlMs; this.requests=new Map();
  }
  request({ action, requestedBy, reason, payloadDigest }) {
    if(!Object.values(CONTROLLED_ACTION).includes(action))throw new Error('unsupported_controlled_action');
    if(!requestedBy||!reason||!payloadDigest)throw new Error('approval_request_identity_reason_payload_required');
    const createdAt=this.now();
    const record={id:`approval_${randomUUID()}`,action,requestedBy,reason,payloadDigest,createdAt,expiresAt:new Date(Date.parse(createdAt)+this.ttlMs).toISOString(),status:'pending',approvedBy:null};
    this.requests.set(record.id,record);return structuredClone(record);
  }
  approve(id,{approvedBy}){
    const r=this.requests.get(id);if(!r)throw new Error('approval_request_not_found');if(r.status!=='pending')throw new Error('approval_not_pending');if(!approvedBy||approvedBy===r.requestedBy)throw new Error('second_actor_required');if(Date.parse(this.now())>Date.parse(r.expiresAt)){r.status='expired';throw new Error('approval_expired');}r.status='approved';r.approvedBy=approvedBy;r.approvedAt=this.now();return structuredClone(r);
  }
  consume(id,{action,payloadDigest}={}){
    const r=this.requests.get(id);if(!r)throw new Error('approval_request_not_found');if(r.status!=='approved')throw new Error('approval_not_approved');if(action&&action!==r.action)throw new Error('approval_action_mismatch');if(!payloadDigest||payloadDigest!==r.payloadDigest)throw new Error('approval_payload_mismatch');r.status='consumed';r.consumedAt=this.now();return structuredClone(r);
  }
}
