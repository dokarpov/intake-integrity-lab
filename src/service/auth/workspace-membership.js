import {SERVICE_ROLE,permissionsFor} from './rbac.js';

const validRoles=new Set(Object.values(SERVICE_ROLE));
const denied=()=>Object.assign(new Error('workspace_membership_required'),{statusCode:403,code:'workspace_membership_required'});

// Apply AFTER verifying a user's OIDC token. The signed tenant claim selects a
// workspace, but never grants membership or permissions by itself.
export class WorkspaceMembershipAuthenticator {
 constructor({authenticator,pool}={}){
  if(typeof authenticator?.authenticate!=='function'||typeof pool?.query!=='function')
   throw new Error('workspace_auth_dependencies_required');
  this.authenticator=authenticator;
  this.pool=pool;
 }
 async authenticate(req){
  const principal=await this.authenticator.authenticate(req);
  const subject=principal?.id,tenantId=principal?.tenantId;
  if(typeof subject!=='string'||!subject.trim()||
     typeof tenantId!=='string'||!tenantId.trim()||
     principal.claims?.dev||principal.claims?.sandbox)throw denied();
  const result=await this.pool.query(
   `SELECT m.roles FROM intake_workspace_memberships m
    JOIN intake_workspaces w ON w.tenant_id=m.tenant_id
    WHERE m.tenant_id=$1 AND m.subject_id=$2
      AND m.status='active' AND w.status='active' LIMIT 1`,
   [tenantId,subject]
  );
  const roles=result.rows?.[0]?.roles;
  if(!Array.isArray(roles)||roles.length===0||roles.length>8||
     new Set(roles).size!==roles.length||roles.some(r=>!validRoles.has(r)))
   throw denied();
  // Database-administered membership roles OVERRIDE any OIDC token role claim.
  return {...principal,roles,permissions:permissionsFor(roles)};
 }
}
