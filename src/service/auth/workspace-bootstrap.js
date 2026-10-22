import {createHash,randomUUID} from 'node:crypto';

const required=(value,name,max)=>{
 if(typeof value!=='string'||!value.trim()||value.length>max)
  throw Object.assign(new Error('invalid_'+name),{statusCode:400});
 return value.trim();
};

// Trust boundary: pass only claims returned by a successful OIDC signature,
// issuer, audience and expiry verifier; never raw browser JSON or decoded JWT.
export class WorkspaceBootstrap {
 constructor({pool}={}){
  if(typeof pool?.connect!=='function')throw Error('workspace_bootstrap_pool_required');
  this.pool=pool;
 }
 async registerVerifiedIdentity({claims,displayName}={}){
  if(claims?.email_verified!==true)
   throw Object.assign(new Error('verified_email_required'),{statusCode:403});
  const issuer=required(claims.iss,'identity_issuer',300);
  const subject=required(claims.sub,'identity_subject',255);
  const name=required(displayName,'workspace_name',120);
  if(name.length<2)throw Object.assign(new Error('workspace_name_too_short'),{statusCode:400});
  const subjectHash=createHash('sha256').update(JSON.stringify([issuer,subject])).digest('hex');
  const conn=await this.pool.connect();
  try{
   await conn.query('BEGIN');
   await conn.query("SET LOCAL lock_timeout='5s'");
   // Serialize one initial organization per verified identity without
   // creating orphan workspaces during concurrent/replayed registration.
   await conn.query('SELECT pg_advisory_xact_lock(hashtext($1))',[subjectHash]);
   const previous=await conn.query(`SELECT b.tenant_id,w.display_name,
     w.status AS workspace_status,m.status AS membership_status
     FROM intake_workspace_bootstraps b
     JOIN intake_workspaces w ON w.tenant_id=b.tenant_id
     JOIN intake_workspace_memberships m
       ON m.tenant_id=b.tenant_id AND m.subject_id=$2
     WHERE b.subject_hash=$1`,[subjectHash,subject]);
   if(previous.rows.length){
    const row=previous.rows[0];
    if(row.workspace_status!=='active'||row.membership_status!=='active')
     throw Object.assign(new Error('workspace_not_active'),{statusCode:403});
    await conn.query('COMMIT');
    return {workspaceId:row.tenant_id,displayName:row.display_name,replayed:true};
   }
   const workspaceId=randomUUID();
   await conn.query('INSERT INTO intake_workspaces(tenant_id,display_name) VALUES($1,$2)',
     [workspaceId,name]);
   await conn.query(`INSERT INTO intake_workspace_memberships
     (tenant_id,subject_id,roles) VALUES($1,$2,$3::text[])`,
     [workspaceId,subject,['owner']]);
   await conn.query(`INSERT INTO intake_workspace_bootstraps
     (subject_hash,tenant_id) VALUES($1,$2)`,[subjectHash,workspaceId]);
   await conn.query('COMMIT');
   return {workspaceId,displayName:name,replayed:false};
  }catch(e){try{await conn.query('ROLLBACK')}catch{}throw e}
  finally{conn.release()}
 }
}
