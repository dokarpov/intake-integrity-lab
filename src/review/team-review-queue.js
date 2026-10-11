import { makeId } from '../util.js';

export const REVIEW_STATUS=Object.freeze({OPEN:'open',ASSIGNED:'assigned',IN_PROGRESS:'in_progress',RESOLVED:'resolved'});
export const REVIEW_PRIORITY=Object.freeze({LOW:'low',NORMAL:'normal',HIGH:'high',URGENT:'urgent'});

export class TeamReviewQueue{
  constructor({now=()=>new Date().toISOString(),defaultSlaMs=2*60*60_000,leaseMs=15*60_000}={}){Object.assign(this,{now,defaultSlaMs,leaseMs});this.items=new Map()}
  enqueue({id,intakeId,reason,candidateRefs=[],context={},priority=REVIEW_PRIORITY.NORMAL,queue='identity',slaMs=this.defaultSlaMs,tags=[]}){
    const createdAt=this.now(), item={id:id||makeId('review'),intakeId,status:REVIEW_STATUS.OPEN,reason,candidateRefs:[...candidateRefs],context:{...context},priority,queue,tags:[...new Set(tags)],createdAt,slaDueAt:new Date(Date.parse(createdAt)+slaMs).toISOString(),assignedTo:null,assignedAt:null,claimedBy:null,leaseUntil:null,resolvedAt:null,resolution:null,version:1};
    if(this.items.has(item.id))throw new Error('review_item_exists');this.items.set(item.id,item);return structuredClone(item)
  }
  get(id){const x=this.items.get(id);return x?structuredClone(x):null}
  list({status,assignee,queue,priority,limit=200}={}){return [...this.items.values()].filter(x=>!status||x.status===status).filter(x=>!assignee||x.assignedTo===assignee||x.claimedBy===assignee).filter(x=>!queue||x.queue===queue).filter(x=>!priority||x.priority===priority).sort((a,b)=>Date.parse(a.slaDueAt)-Date.parse(b.slaDueAt)||Date.parse(a.createdAt)-Date.parse(b.createdAt)).slice(0,limit).map(structuredClone)}
  assign(id,{actor,assignee,reason}){const x=this._open(id);if(!actor||!assignee||!reason)throw new Error('review_assignment_actor_assignee_reason_required');x.assignedTo=assignee;x.assignedAt=this.now();x.status=REVIEW_STATUS.ASSIGNED;x.version++;return structuredClone(x)}
  bulkAssign(ids,{actor,assignee,reason}){if(!Array.isArray(ids)||!ids.length)throw new Error('review_ids_required');return ids.map(id=>this.assign(id,{actor,assignee,reason}))}
  claim(id,{actor,leaseMs=this.leaseMs}={}){const x=this._open(id);if(!actor)throw new Error('review_claim_actor_required');const now=this.now();if(x.leaseUntil&&Date.parse(x.leaseUntil)>Date.parse(now)&&x.claimedBy!==actor)throw new Error('review_already_claimed');x.claimedBy=actor;x.leaseUntil=new Date(Date.parse(now)+leaseMs).toISOString();x.status=REVIEW_STATUS.IN_PROGRESS;x.version++;return structuredClone(x)}
  resolve(id,{actor,decision,targetRef,note}){const x=this._open(id);if(!actor||!decision||!note)throw new Error('review_resolution_actor_decision_note_required');if(x.claimedBy&&x.claimedBy!==actor&&Date.parse(x.leaseUntil||0)>Date.parse(this.now()))throw new Error('review_claimed_by_another_actor');x.status=REVIEW_STATUS.RESOLVED;x.resolvedAt=this.now();x.resolution={actor,decision,targetRef:targetRef||null,note};x.version++;return structuredClone(x)}
  stats({now=this.now()}={}){const open=this.list({}).filter(x=>x.status!==REVIEW_STATUS.RESOLVED);const overdue=open.filter(x=>Date.parse(x.slaDueAt)<Date.parse(now));return{open:open.length,overdue:overdue.length,unassigned:open.filter(x=>!x.assignedTo&&!x.claimedBy).length,urgent:open.filter(x=>x.priority===REVIEW_PRIORITY.URGENT).length}}
  _open(id){const x=this.items.get(id);if(!x)throw new Error('review_item_not_found');if(x.status===REVIEW_STATUS.RESOLVED)throw new Error('review_item_already_resolved');return x}
}
