import {correlationId,errorBody,sendJson} from '../http/io.js';

// Publicly routable only when workspace directory auth is explicitly enabled.
// Authorization is via a verified bearer token; no workspace header is needed
// for discovery because membership itself determines all visible workspaces.
export function createWorkspaceDirectoryHandler({directory,rateLimiter}={}){
 if(typeof directory?.listForRequest!=='function')
  throw new Error('workspace_directory_handler_required');
 return async(req,res)=>{
  const requestId=correlationId(req);
  try{
   const ip=req.socket?.remoteAddress||'unknown';
   const limit=rateLimiter?.check('workspace-directory:'+ip,{limit:30,windowMs:60_000});
   if(limit&&!limit.allowed)throw Object.assign(new Error('rate_limit_exceeded'),{statusCode:429});
   const items=await directory.listForRequest(req);
   return sendJson(res,200,{items},{requestId});
  }catch(e){
   const status=e.statusCode||500;
   return sendJson(res,status,errorBody(status>=500?{statusCode:500,code:'internal_error'}:e,requestId),{requestId});
  }
 };
}
