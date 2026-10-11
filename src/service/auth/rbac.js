export const SERVICE_ROLE=Object.freeze({
  SALES:'sales', REVIEWER:'reviewer', REVIEW_MANAGER:'review_manager',
  AUDITOR:'auditor', DPO:'dpo', SECURITY_ADMIN:'security_admin',
  POLICY_ADMIN:'policy_admin', INTEGRATION_ADMIN:'integration_admin'
});

const P={
  [SERVICE_ROLE.SALES]:['intake.submit','intake.read'],
  [SERVICE_ROLE.REVIEWER]:['review.read','review.claim','review.resolve'],
  [SERVICE_ROLE.REVIEW_MANAGER]:['review.read','review.claim','review.resolve','review.assign','review.bulk_assign','review.capacity'],
  [SERVICE_ROLE.AUDITOR]:['audit.read','audit.export'],
  [SERVICE_ROLE.DPO]:['audit.read','audit.export','subject.read','dsr.read','dsr.create','dsr.transition','dsr.export'],
  [SERVICE_ROLE.SECURITY_ADMIN]:['audit.read','controls.read','controls.verify','approval.read','approval.act'],
  [SERVICE_ROLE.POLICY_ADMIN]:['policy.read','policy.propose','policy.approve','policy.publish'],
  [SERVICE_ROLE.INTEGRATION_ADMIN]:['integration.read','integration.test','integration.retry']
};
export function permissionsFor(roles=[]){const out=new Set();for(const role of roles||[])for(const x of P[role]||[])out.add(x);return out}
export function requirePermission(principal,permission){if(!principal?.permissions?.has(permission))throw Object.assign(new Error('forbidden'),{statusCode:403,code:'forbidden',permission})}
export function principalFromClaims(claims,{rolesClaim='roles',tenantClaim='tenant_id',nameClaim='name'}={}){
  const rolesRaw=claims[rolesClaim]??claims.role??[];const roles=Array.isArray(rolesRaw)?rolesRaw:String(rolesRaw).split(/[ ,]+/).filter(Boolean);
  const tenantId=claims[tenantClaim]; if(!tenantId)throw new Error('tenant_claim_required');
  return {id:claims.sub,name:claims[nameClaim]||claims.preferred_username||claims.sub,tenantId:String(tenantId),roles,permissions:permissionsFor(roles),claims};
}
