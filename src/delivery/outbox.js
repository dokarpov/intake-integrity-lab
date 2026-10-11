import { newId } from '../compliance/crypto.js';

export const OUTBOX_STATUS=Object.freeze({PENDING:'pending',IN_FLIGHT:'in_flight',SUCCEEDED:'succeeded',RETRY:'retry',DEAD:'dead'});

const SENSITIVE_HEADERS=new Set(['authorization','proxy-authorization','cookie','set-cookie','x-api-key']);
export function sanitizeOutboxRequest(request={}){
  const headers={};for(const [k,v] of Object.entries(request.headers||{})){if(!SENSITIVE_HEADERS.has(k.toLowerCase()))headers[k]=v}
  return {method:request.method||'POST',url:request.url,headers,body:structuredClone(request.body),authRef:request.authRef||null};
}

export function backoffMs(attempt,{baseMs=1000,maxMs=15*60_000}={}){return Math.min(maxMs,baseMs*Math.pow(2,Math.max(0,attempt-1)))}

export class MemoryOutboxStore{
  constructor({now=()=>new Date().toISOString()}={}){this.items=new Map();this.now=now}
  async enqueue(item){const timestamp=this.now();const safe=structuredClone(item);if(safe.request)safe.request=sanitizeOutboxRequest(safe.request);const record={id:item.id||newId('outbox'),status:OUTBOX_STATUS.PENDING,attempts:0,nextAttemptAt:item.nextAttemptAt||timestamp,createdAt:timestamp,...safe};if(this.items.has(record.id))throw new Error('duplicate_outbox_id');this.items.set(record.id,record);return structuredClone(record)}
  async claimDue({now=new Date().toISOString(),limit=20}={}){const due=[...this.items.values()].filter(x=>[OUTBOX_STATUS.PENDING,OUTBOX_STATUS.RETRY].includes(x.status)&&Date.parse(x.nextAttemptAt)<=Date.parse(now)).sort((a,b)=>Date.parse(a.nextAttemptAt)-Date.parse(b.nextAttemptAt)).slice(0,limit);for(const x of due){x.status=OUTBOX_STATUS.IN_FLIGHT;x.claimedAt=now}return due.map(x=>structuredClone(x))}
  async complete(id,{externalRecordRef,statusCode}={}){const x=this.items.get(id);if(!x)throw new Error('outbox_not_found');x.status=OUTBOX_STATUS.SUCCEEDED;x.completedAt=this.now();x.externalRecordRef=externalRecordRef;x.statusCode=statusCode;return structuredClone(x)}
  async fail(id,{error,statusCode,maxAttempts=6,now=new Date().toISOString(),backoff={}}={}){const x=this.items.get(id);if(!x)throw new Error('outbox_not_found');x.attempts+=1;x.lastError=String(error?.message||error);x.statusCode=statusCode??null;if(x.attempts>=maxAttempts){x.status=OUTBOX_STATUS.DEAD;x.deadAt=now}else{x.status=OUTBOX_STATUS.RETRY;x.nextAttemptAt=new Date(Date.parse(now)+backoffMs(x.attempts,backoff)).toISOString()}return structuredClone(x)}
  async get(id){const x=this.items.get(id);return x?structuredClone(x):null}
  async stats(){const all=[...this.items.values()];return{pending:all.filter(x=>x.status==='pending'||x.status==='retry').length,inFlight:all.filter(x=>x.status==='in_flight').length,succeeded:all.filter(x=>x.status==='succeeded').length,dead:all.filter(x=>x.status==='dead').length}}
}

export class DeliveryWorker{
  constructor({store,sender,audit,maxAttempts=6,backoff}={}){if(!store||!sender)throw new Error('delivery_worker_config_required');Object.assign(this,{store,sender,audit,maxAttempts,backoff})}
  async runOnce({now=new Date().toISOString(),limit=20}={}){const items=await this.store.claimDue({now,limit}),results=[];for(const item of items){try{await this.audit?.attempt?.(item);const response=await this.sender(item);if(!response?.ok)throw Object.assign(new Error(`delivery_http_${response?.status??'unknown'}`),{statusCode:response?.status});const done=await this.store.complete(item.id,{externalRecordRef:response.externalRecordRef,statusCode:response.status});await this.audit?.result?.(item,{ok:true,statusCode:response.status,externalRecordRef:response.externalRecordRef,responseBody:response.body});results.push(done)}catch(error){const failed=await this.store.fail(item.id,{error,statusCode:error.statusCode,maxAttempts:this.maxAttempts,now,backoff:this.backoff});await this.audit?.result?.(item,{ok:false,statusCode:error.statusCode,responseBody:error.message});results.push(failed)}}return results}
}
