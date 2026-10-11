import { randomUUID } from 'node:crypto';
import { CONTROLLED_ACTION } from './two-person-control.js';

export class PostgresTwoPersonControl {
  constructor({ pool, table='compliance_control_approvals', now=()=>new Date().toISOString(), ttlMs=15*60_000 }={}){
    if(!pool)throw new Error('postgres_pool_required');
    if(!/^[a-z_][a-z0-9_]*$/i.test(table))throw new Error('unsafe_postgres_identifier');
    Object.assign(this,{pool,table,now,ttlMs});
  }
  async request({action,requestedBy,reason,payloadDigest}){
    if(!Object.values(CONTROLLED_ACTION).includes(action))throw new Error('unsupported_controlled_action');
    if(!requestedBy||!reason||!payloadDigest)throw new Error('approval_request_identity_reason_payload_required');
    const createdAt=this.now(), id=`approval_${randomUUID()}`, expiresAt=new Date(Date.parse(createdAt)+this.ttlMs).toISOString();
    const q=await this.pool.query(`INSERT INTO ${this.table}(id,action,requested_by,reason,payload_digest,created_at,expires_at,status) VALUES($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING *`,[id,action,requestedBy,reason,payloadDigest,createdAt,expiresAt]);
    return this._map(q.rows[0]);
  }
  async approve(id,{approvedBy}){
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const q=await client.query(`SELECT * FROM ${this.table} WHERE id=$1 FOR UPDATE`,[id]);
      const r=q.rows[0]; if(!r)throw new Error('approval_request_not_found'); if(r.status!=='pending')throw new Error('approval_not_pending'); if(!approvedBy||approvedBy===r.requested_by)throw new Error('second_actor_required'); if(Date.parse(this.now())>Date.parse(r.expires_at)) { await client.query(`UPDATE ${this.table} SET status='expired' WHERE id=$1`,[id]); throw new Error('approval_expired'); }
      const u=await client.query(`UPDATE ${this.table} SET status='approved',approved_by=$2,approved_at=$3 WHERE id=$1 RETURNING *`,[id,approvedBy,this.now()]);
      await client.query('COMMIT'); return this._map(u.rows[0]);
    }catch(e){try{await client.query('ROLLBACK')}catch{} throw e}finally{client.release()}
  }
  async consume(id,{action,payloadDigest}={}){
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const q=await client.query(`SELECT * FROM ${this.table} WHERE id=$1 FOR UPDATE`,[id]); const r=q.rows[0];
      if(!r)throw new Error('approval_request_not_found'); if(r.status!=='approved')throw new Error('approval_not_approved'); if(action&&action!==r.action)throw new Error('approval_action_mismatch'); if(!payloadDigest||payloadDigest!==r.payload_digest)throw new Error('approval_payload_mismatch');
      const u=await client.query(`UPDATE ${this.table} SET status='consumed',consumed_at=$2 WHERE id=$1 RETURNING *`,[id,this.now()]); await client.query('COMMIT'); return this._map(u.rows[0]);
    }catch(e){try{await client.query('ROLLBACK')}catch{} throw e}finally{client.release()}
  }
  _map(r){return{id:r.id,action:r.action,requestedBy:r.requested_by,reason:r.reason,payloadDigest:r.payload_digest,createdAt:new Date(r.created_at).toISOString(),expiresAt:new Date(r.expires_at).toISOString(),status:r.status,approvedBy:r.approved_by||null,approvedAt:r.approved_at?new Date(r.approved_at).toISOString():null,consumedAt:r.consumed_at?new Date(r.consumed_at).toISOString():null}}
}
