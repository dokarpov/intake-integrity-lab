import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto';

const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function validString(x){return typeof x==='string'&&x.length>0&&x.length<260}
function safeEq(a,b){
 const x=Buffer.from(a),y=Buffer.from(b);
 return x.length===y.length&&timingSafeEqual(x,y);
}
/**
 * TESTING ONLY. An authenticated reviewer can simulate evidence about fictional
 * records. This never verifies a real person's identity or consent.
 * Do not enable in production or expose to real customer data.
 */
export class SandboxDecisionEvidence {
 constructor({secret,integrityStore,tenantId='staging-demo',now=()=>Date.now()}={}){
  if(process.env.NODE_ENV==='production')throw new Error('sandbox_forbidden_in_production');
  if(typeof secret!=='string'||secret.length<40)throw new Error('sandbox_secret_too_short');
  if(!integrityStore?.getIntake||!integrityStore?.candidates)throw new Error('sandbox_integrity_store_required');
  Object.assign(this,{secret,integrityStore,tenantId,now});
 }
 signed(kind,context){
  const payload=enc({...context,kind,nonce:randomBytes(12).toString('hex'),expiresAt:this.now()+10*60*1000});
  const mac=createHmac('sha256',this.secret).update(payload).digest('base64url');
  return 'demo-v1.'+payload+'.'+mac;
 }
 inspect(token){
  if(typeof token!=='string'||token.length<30||token.length>2500) return null;
  const parts=token.split('.');
  if(parts.length!==3||parts[0]!=='demo-v1')return null;
  const expected=createHmac('sha256',this.secret).update(parts[1]).digest('base64url');
  if(!safeEq(parts[2],expected))return null;
  let payload;
  try{payload=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'))}catch{return null}
  if(!payload||payload.expiresAt<=this.now()||payload.expiresAt>this.now()+10*60*1000)return null;
  return payload;
 }
 async issue({tenantId,actorId,intakeId,action,personId=null,
   simulateEvidence=false,simulateConsent=false}={}){
  if(tenantId!==this.tenantId||!validString(actorId)||!validString(intakeId))throw new Error('sandbox_tenant_or_identity_invalid');
  if(!simulateEvidence)throw new Error('sandbox_evidence_acknowledgement_required');
  if(!['link_existing','create_new','discard'].includes(action))throw new Error('sandbox_action_invalid');
  if(action==='link_existing'&&!validString(personId))throw new Error('sandbox_person_selection_required');
  if(action!=='link_existing'&&personId!==null)throw new Error('sandbox_person_not_allowed');
  if(action!=='discard'&&!simulateConsent)throw new Error('sandbox_consent_acknowledgement_required');
  const intake=await this.integrityStore.getIntake({tenantId,intakeId});
  if(!intake||!['received','review_needed'].includes(intake.state))throw new Error('sandbox_intake_not_reviewable');
  if(action==='link_existing'){
    const candidates=await this.integrityStore.candidates({tenantId,intakeId});
    if(!candidates.some(x=>x.personId===personId))throw new Error('sandbox_selected_person_not_candidate');
  }
  const ctx={tenantId,actorId,intakeId,action,personId};
  return {identityEvidenceRef:this.signed('identity',ctx),
    consentEvidenceRef:action==='discard'?null:this.signed('consent',ctx),
    expiresInSeconds:600,simulation:true};
 }
 async verifyDecision({tenantId,actorId,intakeId,action,personId=null,
   identityEvidenceRef,consentEvidenceRef}={}){
  if(tenantId!==this.tenantId)return false;
  const expected={tenantId,actorId,intakeId,action,personId};
  const same=(token,kind)=>{
    const parsed=this.inspect(token);
    return Boolean(parsed&&parsed.kind===kind&&Object.entries(expected)
      .every(([key,value])=>parsed[key]===value));
  };
  return same(identityEvidenceRef,'identity')&&
    (action==='discard'||same(consentEvidenceRef,'consent'));
 }
}
