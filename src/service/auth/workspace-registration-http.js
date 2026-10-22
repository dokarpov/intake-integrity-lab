import {bearerFromHeaders} from './oidc-verifier.js';
import {correlationId,errorBody,readJson,sendJson} from '../http/io.js';

export function createWorkspaceRegistrationHandler({verifier,bootstrap,rateLimiter}={}){
 if(typeof verifier?.verify!=='function'||typeof bootstrap?.registerVerifiedIdentity!=='function')
  throw Error('workspace_registration_dependencies_required');
 return async(req,res)=>{
  const requestId=correlationId(req);
  try{
   // This path intentionally does NOT require existing workspace membership:
   // it verifies signed OIDC identity directly, before creating the first one.
   const ip=req.socket?.remoteAddress||'unknown';
   const limit=rateLimiter?.check('workspace-registration:'+ip,{limit:5,windowMs:60_000});
   if(limit&&!limit.allowed)throw Object.assign(new Error('rate_limit_exceeded'),{statusCode:429});
   let claims;
   try{claims=await verifier.verify(bearerFromHeaders(req.headers))}
   catch{throw Object.assign(new Error('unauthorized'),{statusCode:401})}
   const data=await readJson(req,{maxBytes:4096});
   if(!data||typeof data!=='object'||Array.isArray(data)||
      Object.keys(data).some(k=>k!=='displayName'))
    throw Object.assign(new Error('invalid_workspace_registration_fields'),{statusCode:400});
   const result=await bootstrap.registerVerifiedIdentity({claims,displayName:data.displayName});
   return sendJson(res,result.replayed?200:201,result,{requestId});
  }catch(error){
   const status=error.statusCode||500;
   return sendJson(res,status,errorBody(status>=500?{statusCode:500,code:'internal_error'}:error,requestId),{requestId});
  }
 };
}
