import { randomUUID } from 'node:crypto';
import { canonicalize } from '../compliance/canonical-json.js';
import { sha256 } from '../compliance/crypto.js';
import { scanSensitiveMetadataValues } from '../compliance/metadata-policy.js';
export const POLICY_CHANGE_STATUS=Object.freeze({PROPOSED:'proposed',APPROVED:'approved',PUBLISHED:'published',REJECTED:'rejected',CANCELLED:'cancelled'});
export class PolicyChangeManager{
  constructor({now=()=>new Date().toISOString()}={}){this.now=now;this.items=new Map()}
  propose({policyId,fromVersion,toVersion,changes,requestedBy,reason,risk='normal'}){if(!policyId||!toVersion||!Array.isArray(changes)||!changes.length||!requestedBy||!reason)throw new Error('policy_change_fields_required');const sensitive=scanSensitiveMetadataValues(changes,'changes');if(sensitive.length)throw new Error(`policy_change_sensitive_value_forbidden:${sensitive.join('|')}`);const id=`policy_${randomUUID()}`,createdAt=this.now(),payload={policyId,fromVersion:fromVersion||null,toVersion,changes,risk};const item={id,...payload,payloadDigest:sha256(canonicalize(payload)),requestedBy,reason,status:POLICY_CHANGE_STATUS.PROPOSED,requiredApprovals:risk==='high'?2:1,approvals:[],createdAt,publishedAt:null,rejectedAt:null};this.items.set(id,item);return structuredClone(item)}
  list({status,policyId,limit=200}={}){return[...this.items.values()].filter(x=>!status||x.status===status).filter(x=>!policyId||x.policyId===policyId).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,limit).map(structuredClone)}
  get(id){const x=this.items.get(id);return x?structuredClone(x):null}
  approve(id,{actor,note}){const x=this._get(id);if(x.status!==POLICY_CHANGE_STATUS.PROPOSED)throw new Error('policy_change_not_proposed');if(!actor||actor===x.requestedBy||x.approvals.some(a=>a.actor===actor))throw new Error('independent_approver_required');x.approvals.push({actor,note:note||'approved',at:this.now()});if(x.approvals.length>=x.requiredApprovals)x.status=POLICY_CHANGE_STATUS.APPROVED;return structuredClone(x)}
  reject(id,{actor,reason}){const x=this._get(id);if(!actor||!reason)throw new Error('policy_rejection_actor_reason_required');if(x.status===POLICY_CHANGE_STATUS.PUBLISHED)throw new Error('published_policy_change_immutable');x.status=POLICY_CHANGE_STATUS.REJECTED;x.rejectedAt=this.now();x.rejectedBy=actor;x.rejectionReason=reason;return structuredClone(x)}
  publish(id,{actor}){const x=this._get(id);if(x.status!==POLICY_CHANGE_STATUS.APPROVED)throw new Error('policy_change_not_approved');if(!actor)throw new Error('publisher_required');x.status=POLICY_CHANGE_STATUS.PUBLISHED;x.publishedAt=this.now();x.publishedBy=actor;return structuredClone(x)}
  _get(id){const x=this.items.get(id);if(!x)throw new Error('policy_change_not_found');return x}
}
