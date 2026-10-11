import { bearerFromHeaders } from './oidc-verifier.js';
import { principalFromClaims, permissionsFor } from './rbac.js';

export class Authenticator{
  constructor({mode='oidc',verifier,devAllowedHosts=['127.0.0.1','::1','localhost'],claimOptions}={}){Object.assign(this,{mode,verifier,devAllowedHosts:new Set(devAllowedHosts),claimOptions})}
  async authenticate(req){
    if(this.mode==='oidc'){
      if(!this.verifier)throw new Error('oidc_verifier_required');
      return principalFromClaims(await this.verifier.verify(bearerFromHeaders(req.headers)),this.claimOptions);
    }
    if(this.mode==='dev'){
      const host=(req.socket?.remoteAddress||'').replace(/^::ffff:/,''); if(!this.devAllowedHosts.has(host))throw Object.assign(new Error('dev_auth_localhost_only'),{statusCode:401});
      const id=req.headers['x-dev-user']; const tenantId=req.headers['x-dev-tenant']; if(!id||!tenantId)throw Object.assign(new Error('dev_auth_headers_required'),{statusCode:401});
      const roles=String(req.headers['x-dev-roles']||'').split(',').map(x=>x.trim()).filter(Boolean);
      return {id,name:req.headers['x-dev-name']||id,tenantId,roles,permissions:permissionsFor(roles),claims:{dev:true}};
    }
    throw new Error('unsupported_auth_mode');
  }
}
