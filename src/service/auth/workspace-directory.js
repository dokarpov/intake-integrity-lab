import {bearerFromHeaders} from './oidc-verifier.js';
import {SERVICE_ROLE,permissionsFor} from './rbac.js';

const validRoles=new Set(Object.values(SERVICE_ROLE));
const fail=(code,statusCode)=>Object.assign(new Error(code),{code,statusCode});
const membershipDenied=()=>fail('workspace_membership_required',403);

// Only claims from a signature/issuer/audience/expiry-verifying OIDC verifier
// may reach this class. JWT tenant_id and roles claims are NEVER authoritative.
// A browser header can select a workspace, never grant access to it.
export class VerifiedWorkspaceDirectoryAuthenticator {
 constructor({verifier,pool}={}){
  if(typeof verifier?.verify!=='function'||typeof pool?.query!=='function')
   throw new Error('workspace_directory_dependencies_required');
  this.verifier=verifier;
  this.pool=pool; // readonly SELECT on directory tables; no provisioning rights
 }
 async verifiedIdentity(req){
  let claims;
  try{claims=await this.verifier.verify(bearerFromHeaders(req.headers||{}))}
  catch{throw fail('unauthorized',401)}
  if(typeof claims?.sub!=='string'||!claims.sub.trim()||
     typeof claims?.iss!=='string'||!claims.iss.trim()||
     claims.email_verified!==true||claims.dev||claims.sandbox)
   throw fail('verified_identity_required',403);
  return claims;
 }
 validateRoles(roles){
  if(!Array.isArray(roles)||roles.length===0||roles.length>8||
     new Set(roles).size!==roles.length||roles.some(x=>!validRoles.has(x)))
   throw membershipDenied();
  return roles;
 }
 async listForRequest(req){
  const claims=await this.verifiedIdentity(req);
  const list=await this.pool.query(`SELECT m.tenant_id AS "workspaceId",
      w.display_name AS "displayName",m.roles
    FROM intake_workspace_memberships m
    JOIN intake_workspaces w ON w.tenant_id=m.tenant_id
    WHERE m.subject_id=$1 AND m.status='active' AND w.status='active'
    ORDER BY w.display_name,m.tenant_id LIMIT 101`,[claims.sub]);
  if(list.rows.length>100)throw fail('workspace_directory_limit',403);
  return list.rows.map(({workspaceId,displayName,roles})=>({
   workspaceId,displayName,roles:this.validateRoles(roles)
  }));
 }
 async authenticate(req){
  const claims=await this.verifiedIdentity(req);
  const h=req.headers?.['x-workspace-id'];
  if(h!==undefined&&(typeof h!=='string'||!h.trim()||h.length>160||h!==h.trim()))
   throw fail('invalid_workspace_selection',400);
  const selected=h||null;
  const result=selected
   ?await this.pool.query(`SELECT m.tenant_id,m.roles
     FROM intake_workspace_memberships m
     JOIN intake_workspaces w ON w.tenant_id=m.tenant_id
     WHERE m.subject_id=$1 AND m.tenant_id=$2
       AND m.status='active' AND w.status='active' LIMIT 1`,[claims.sub,selected])
   :await this.pool.query(`SELECT m.tenant_id,m.roles
     FROM intake_workspace_memberships m
     JOIN intake_workspaces w ON w.tenant_id=m.tenant_id
     WHERE m.subject_id=$1
       AND m.status='active' AND w.status='active'
     ORDER BY m.tenant_id LIMIT 2`,[claims.sub]);
  if(!selected&&result.rows.length>1)throw fail('workspace_selection_required',409);
  const row=result.rows[0];
  if(!row)throw membershipDenied();
  const roles=this.validateRoles(row.roles);
  return {id:claims.sub,name:claims.name||claims.preferred_username||claims.sub,
   tenantId:row.tenant_id,roles,permissions:permissionsFor(roles),claims};
 }
}
