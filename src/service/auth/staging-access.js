import {timingSafeEqual} from 'node:crypto';
import {permissionsFor} from './rbac.js';

// Isolated demo accounts ONLY. Never use for real PII or production traffic.
export class StagingAccessAuthenticator {
 constructor({token,tenantId='staging-demo'}={}){
  if(process.env.NODE_ENV!=='staging')throw new Error('staging_access_forbidden_outside_staging');
  if(typeof token!=='string'||token.length<40)throw new Error('staging_access_secret_too_short');
  if(!tenantId||tenantId!=='staging-demo')throw new Error('staging_access_tenant_invalid');
  this.token=Buffer.from(token);
  this.tenantId=tenantId;
 }
 async authenticate(req){
  const header=req?.headers?.authorization||'';
  const match=/^Bearer ([^\s]+)$/.exec(header);
  const candidate=match?Buffer.from(match[1]):Buffer.alloc(0);
  if(candidate.length!==this.token.length||!timingSafeEqual(candidate,this.token))
   throw Object.assign(new Error('staging_access_denied'),{statusCode:401});
  const roles=['sales','reviewer','auditor','integration_admin'];
  return {id:'sandbox.operator',name:'Sandbox operator',tenantId:this.tenantId,
    roles,permissions:permissionsFor(roles),claims:{sandbox:true}};
 }
}
