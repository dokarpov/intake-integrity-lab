const REQUIRED=['purpose','legalBasis','retention'];
export class ServicePolicyRegistry{
  constructor(config={}){this.config=config;for(const [name,p] of Object.entries(config)){for(const k of REQUIRED)if(!p?.[k])throw new Error(`service_policy_${name}_${k}_required`);if(!p.purpose.code||!p.purpose.version)throw new Error(`service_policy_${name}_purpose_version_required`);if(!p.legalBasis.basis)throw new Error(`service_policy_${name}_legal_basis_required`);if(!p.retention.class)throw new Error(`service_policy_${name}_retention_class_required`)}}
  get(name){const p=this.config[name];if(!p)throw new Error(`service_policy_missing:${name}`);return structuredClone(p)}
  auditContext(name,principal,subjectRef){const p=this.get(name);return{actor:{type:'human',id:principal.id},subjectRef,purpose:p.purpose,legalBasis:p.legalBasis,retention:p.retention,policyRefs:p.policyRefs||[]}}
}
