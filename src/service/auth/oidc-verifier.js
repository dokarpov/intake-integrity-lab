import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { rawEcdsaToDer } from '../../compliance/signing/pkcs11-hsm-signer.js';

function b64urlToBuffer(value='') {
  const normalized=value.replace(/-/g,'+').replace(/_/g,'/');
  const pad='='.repeat((4-normalized.length%4)%4);
  return Buffer.from(normalized+pad,'base64');
}
function decodeJson(part,label){
  try{return JSON.parse(b64urlToBuffer(part).toString('utf8'))}catch{throw new Error(`invalid_jwt_${label}`)}
}
function audienceMatches(actual, expected){
  if(!expected)return true;
  const allowed=Array.isArray(expected)?expected:[expected];
  const actuals=Array.isArray(actual)?actual:[actual];
  return allowed.some(x=>actuals.includes(x));
}

export class OidcJwtVerifier {
  constructor({issuer,audience,jwksUri,fetchFn=globalThis.fetch,allowedAlgorithms=['RS256','ES256'],cacheTtlMs=5*60_000,clockToleranceSec=60,now=()=>Date.now()}={}){
    if(!issuer||!audience||!jwksUri)throw new Error('oidc_issuer_audience_jwks_required');
    if(typeof fetchFn!=='function')throw new Error('oidc_fetch_required');
    Object.assign(this,{issuer:issuer.replace(/\/$/,''),audience,jwksUri,fetchFn,allowedAlgorithms:new Set(allowedAlgorithms),cacheTtlMs,clockToleranceSec,now});
    this.cache={expiresAt:0,keys:new Map()};
  }
  async _refresh(){
    const res=await this.fetchFn(this.jwksUri,{headers:{accept:'application/json'}});
    if(!res.ok)throw new Error(`jwks_fetch_failed:${res.status}`);
    const body=await res.json();
    if(!Array.isArray(body.keys))throw new Error('invalid_jwks');
    const keys=new Map();
    for(const jwk of body.keys){if(jwk.kid)keys.set(jwk.kid,jwk)}
    this.cache={expiresAt:this.now()+this.cacheTtlMs,keys};
  }
  async _key(kid){
    if(!kid)throw new Error('jwt_kid_required');
    if(this.now()>=this.cache.expiresAt)await this._refresh();
    let jwk=this.cache.keys.get(kid);
    if(!jwk){await this._refresh();jwk=this.cache.keys.get(kid)}
    if(!jwk)throw new Error('jwt_unknown_kid');
    return createPublicKey({key:jwk,format:'jwk'});
  }
  async verify(token){
    if(typeof token!=='string')throw new Error('bearer_token_required');
    const parts=token.split('.'); if(parts.length!==3)throw new Error('invalid_jwt_shape');
    const [h,p,s]=parts, header=decodeJson(h,'header'), claims=decodeJson(p,'payload');
    if(!this.allowedAlgorithms.has(header.alg))throw new Error('jwt_algorithm_not_allowed');
    const key=await this._key(header.kid), data=Buffer.from(`${h}.${p}`,'ascii');
    let signature=b64urlToBuffer(s), ok=false;
    if(header.alg==='RS256')ok=verifySignature('RSA-SHA256',data,key,signature);
    else if(header.alg==='ES256')ok=verifySignature('SHA256',data,{key,dsaEncoding:'der'},rawEcdsaToDer(signature));
    if(!ok)throw new Error('jwt_signature_invalid');
    const nowSec=Math.floor(this.now()/1000), tol=this.clockToleranceSec;
    if(String(claims.iss||'').replace(/\/$/,'')!==this.issuer)throw new Error('jwt_issuer_invalid');
    if(!audienceMatches(claims.aud,this.audience))throw new Error('jwt_audience_invalid');
    if(!Number.isFinite(claims.exp)||claims.exp<nowSec-tol)throw new Error('jwt_expired');
    if(Number.isFinite(claims.nbf)&&claims.nbf>nowSec+tol)throw new Error('jwt_not_yet_valid');
    if(!claims.sub)throw new Error('jwt_subject_required');
    return claims;
  }
}

export function bearerFromHeaders(headers={}){
  const raw=headers.authorization||headers.Authorization;
  if(!raw||!/^Bearer\s+/i.test(raw))throw new Error('bearer_token_required');
  return raw.replace(/^Bearer\s+/i,'').trim();
}
