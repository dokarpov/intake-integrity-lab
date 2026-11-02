function identity(tenantId,intakeId,sealed) {
  if (!tenantId || !intakeId) throw new Error('pending_intake_scope_required');
  if (sealed && (sealed.v!==1 || !sealed.expiresAt || !sealed.ciphertext)) throw new Error('pending_intake_sealed_envelope_required');
}
function safeTable(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value||'')) throw new Error('unsafe_postgres_identifier');
  return value;
}
function active(row,now) {
  return row && row.status==='pending' && Date.parse(row.expiresAt)>Date.parse(now);
}
export class MemoryPendingIntakeStore {
  constructor({now=()=>new Date().toISOString()}={}) {this.records=new Map();this.now=now}
  _key(tenantId,intakeId){return JSON.stringify([tenantId,intakeId])}
  async save({tenantId,intakeId,sealed}) {
    identity(tenantId,intakeId,sealed);
    if (Date.parse(sealed.expiresAt)<=Date.parse(this.now())) throw new Error('pending_intake_expired');
    const key=this._key(tenantId,intakeId);
    if (this.records.has(key)) throw new Error('pending_intake_exists');
    this.records.set(key,{tenantId,intakeId,status:'pending',sealed:structuredClone(sealed),expiresAt:sealed.expiresAt});
    return {tenantId,intakeId,status:'pending',expiresAt:sealed.expiresAt};
  }
  async get({tenantId,intakeId}) {
    identity(tenantId,intakeId);
    const x=this.records.get(this._key(tenantId,intakeId));
    return active(x,this.now())?structuredClone(x):null;
  }
  async consume({tenantId,intakeId}) {
    const x=await this.get({tenantId,intakeId});if(!x) return false;
    this.records.set(this._key(tenantId,intakeId),{tenantId,intakeId,status:'consumed',sealed:null,expiresAt:x.expiresAt});
    return true;
  }
  async purgeExpired(){const now=this.now();let n=0;for(const [k,v] of this.records){if(Date.parse(v.expiresAt)<=Date.parse(now)){this.records.delete(k);n++}}return n}
}
export class PostgresPendingIntakeStore {
  constructor({pool,table='sales_pending_intakes',now=()=>new Date().toISOString()}={}) {
    if(!pool)throw new Error('postgres_pool_required');
    this.pool=pool;this.table=safeTable(table);this.now=now;
  }
  async save({tenantId,intakeId,sealed}) {
    identity(tenantId,intakeId,sealed);
    if(Date.parse(sealed.expiresAt)<=Date.parse(this.now()))throw new Error('pending_intake_expired');
    const q=await this.pool.query(
      'INSERT INTO '+this.table+'(tenant_id,intake_id,status,payload_json,expires_at,created_at) VALUES($1,$2,\'pending\',$3::jsonb,$4,$5) ON CONFLICT(tenant_id,intake_id) DO NOTHING RETURNING intake_id',
      [tenantId,intakeId,JSON.stringify(sealed),sealed.expiresAt,this.now()]);
    if(!q.rows[0])throw new Error('pending_intake_exists');
    return {tenantId,intakeId,status:'pending',expiresAt:sealed.expiresAt};
  }
  async get({tenantId,intakeId}) {
    identity(tenantId,intakeId);
    const q=await this.pool.query('SELECT payload_json,expires_at FROM '+this.table+' WHERE tenant_id=$1 AND intake_id=$2 AND status=\'pending\' AND expires_at>$3',[tenantId,intakeId,this.now()]);
    const r=q.rows[0];return r?{tenantId,intakeId,status:'pending',sealed:r.payload_json,expiresAt:new Date(r.expires_at).toISOString()}:null;
  }
  async consume({tenantId,intakeId}) {
    identity(tenantId,intakeId);
    const q=await this.pool.query('UPDATE '+this.table+' SET status=\'consumed\',payload_json=NULL,consumed_at=$3 WHERE tenant_id=$1 AND intake_id=$2 AND status=\'pending\' AND expires_at>$3 RETURNING intake_id',[tenantId,intakeId,this.now()]);
    return Boolean(q.rows[0]);
  }
  async purgeExpired({tenantId}={}) {
    if(!tenantId)throw new Error('pending_intake_scope_required');
    const q=await this.pool.query('DELETE FROM '+this.table+' WHERE tenant_id=$1 AND expires_at<=$2',[tenantId,this.now()]);
    return q.rowCount;
  }
}
