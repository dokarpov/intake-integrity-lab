import {correlationId,sendJson} from './io.js';

// Fail closed for shared/demo staging. A browser-supplied CSV, customer name,
// consent flag or token cannot prove data is fictional. Block every HTTP write
// rather than attempting imperfect regex-based PII detection.
// The sole exception is an isolated loopback-only GitHub Actions fixture job.
const loopback=address=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address);
export function allowIsolatedCiFixtureWrite(env={},remoteAddress=''){
 return env.NODE_ENV==='staging'&&env.CI==='true'&&
  env.STAGING_SYNTHETIC_TEST_WRITES==='true'&&
  env.STAGING_FIXTURES==='true'&&
  env.STAGING_TOKEN_AUTH_ENABLED!=='true'&&
  env.HOST==='127.0.0.1'&&loopback(remoteAddress);
}
export function shouldBlockStagingWrite({env={},method,remoteAddress}={}){
 if(env.NODE_ENV!=='staging')return false;
 if(['GET','HEAD','OPTIONS'].includes(String(method).toUpperCase()))return false;
 return !allowIsolatedCiFixtureWrite(env,remoteAddress);
}
export function createStagingWriteGate({env=process.env}={}){
 return (req,res)=>{
  if(!shouldBlockStagingWrite({env,method:req.method,remoteAddress:req.socket?.remoteAddress}))
   return false;
  const requestId=correlationId(req);
  sendJson(res,423,{error:{
   code:'staging_synthetic_only',message:'Shared staging is read-only. Use fictional demonstrations; customer imports require a separately authorized secure environment.',
   requestId
  }},{requestId});
  return true;
 };
}
