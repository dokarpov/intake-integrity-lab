import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OidcJwtVerifier } from '../src/service/auth/oidc-verifier.js';
import { Authenticator } from '../src/service/auth/authenticator.js';
import { SlidingWindowRateLimiter } from '../src/service/http/rate-limit.js';
import { ServicePolicyRegistry } from '../src/service/policies.js';
import { TenantRuntimeRegistry } from '../src/service/runtime.js';
import { AwsKmsHmacPseudonymizer } from '../src/compliance/pseudonymizer-kms.js';
import { createApiHandler } from '../src/service/app.js';
import { PostgresSalesIntegrity } from '../src/sales-integrity/postgres-integrity.js';
import { HttpIdentityResolver } from '../src/integrations/identity/http-resolver.js';

const here=dirname(fileURLToPath(import.meta.url)), root=resolve(here,'..');
function loadJson(path){return JSON.parse(readFileSync(resolve(path),'utf8'))}
const configPath=process.env.SERVICE_CONFIG_FILE;
if(process.env.NODE_ENV==='production'&&!configPath)throw new Error('SERVICE_CONFIG_FILE_required_in_production');
const config=configPath?loadJson(configPath):{
  auth:{mode:'dev'},intake:{dedupMode:'off'},policies:{
    intake:{purpose:{code:'dev_sales_intake',version:'0'},legalBasis:{basis:'not_applicable',reference:'dev-only'},retention:{class:'short',policyVersion:'dev'}},
    review:{purpose:{code:'dev_review',version:'0'},legalBasis:{basis:'not_applicable',reference:'dev-only'},retention:{class:'short',policyVersion:'dev'}},
    audit:{purpose:{code:'dev_audit',version:'0'},legalBasis:{basis:'not_applicable',reference:'dev-only'},retention:{class:'short',policyVersion:'dev'}},
    dsr:{purpose:{code:'dev_dsr',version:'0'},legalBasis:{basis:'not_applicable',reference:'dev-only'},retention:{class:'short',policyVersion:'dev'}},
    policy:{purpose:{code:'dev_policy',version:'0'},legalBasis:{basis:'not_applicable',reference:'dev-only'},retention:{class:'short',policyVersion:'dev'}},
    controls:{purpose:{code:'dev_controls',version:'0'},legalBasis:{basis:'not_applicable',reference:'dev-only'},retention:{class:'short',policyVersion:'dev'}}
  }
};
if(process.env.NODE_ENV==='production'&&config.auth?.mode==='dev')throw new Error('dev_auth_forbidden_in_production');
let verifier=null;if(config.auth?.mode==='oidc')verifier=new OidcJwtVerifier({issuer:config.auth.issuer,audience:config.auth.audience,jwksUri:config.auth.jwksUri});
const authenticator=new Authenticator({mode:config.auth?.mode||'oidc',verifier,claimOptions:{rolesClaim:config.auth?.rolesClaim,tenantClaim:config.auth?.tenantClaim,nameClaim:config.auth?.nameClaim}});
let pool=null,mode='memory';if(process.env.DATABASE_URL){const {Pool}=await import('pg');pool=new Pool({connectionString:process.env.DATABASE_URL,max:Number(process.env.PG_POOL_MAX||10),statement_timeout:Number(process.env.PG_STATEMENT_TIMEOUT_MS||10000)});mode='postgres'}
if(process.env.NODE_ENV==='production'&&!process.env.DATABASE_URL)throw new Error('DATABASE_URL_required_in_production');
let subjectRefProvider=null;if(process.env.AWS_KMS_HMAC_KEY_ID)subjectRefProvider=await AwsKmsHmacPseudonymizer.fromDefault({keyId:process.env.AWS_KMS_HMAC_KEY_ID,region:process.env.AWS_REGION});
if(process.env.NODE_ENV==='production'&&!subjectRefProvider&&!process.env.SUBJECT_HMAC_SECRET)throw new Error('KMS_HMAC_or_SUBJECT_HMAC_SECRET_required_in_production');
const runtimes=new TenantRuntimeRegistry({mode,pool,strictLedger:true,subjectRefProvider,subjectHmacSecret:process.env.SUBJECT_HMAC_SECRET||'local-dev-subject-hmac-change-me'});
const policies=new ServicePolicyRegistry(config.policies);const limiter=new SlidingWindowRateLimiter({limit:Number(process.env.RATE_LIMIT_PER_MINUTE||120)});
const oneCConfig=process.env.ONE_C_CONFIG_FILE?loadJson(process.env.ONE_C_CONFIG_FILE):null;
const identityResolver=process.env.IDENTITY_RESOLVER_CONFIG_FILE?new HttpIdentityResolver(loadJson(process.env.IDENTITY_RESOLVER_CONFIG_FILE)):null;
// New transactional intake backend is intentionally disabled by default.
// A real external evidence verifier must be installed before decision routes
// can execute. This bootstrap does not claim verified approvals from raw JSON.
const integrityEnabled=process.env.INTEGRITY_PG_V2_ENABLED==='true';
if(integrityEnabled&&(!pool||!process.env.INTEGRITY_FINGERPRINT_HMAC_SECRET)){
  throw new Error('INTEGRITY_PG_V2_REQUIRES_DATABASE_AND_HMAC_SECRET');
}
const integrityStore=integrityEnabled?new PostgresSalesIntegrity({
  pool,fingerprintSecret:process.env.INTEGRITY_FINGERPRINT_HMAC_SECRET
}):null;
const api=createApiHandler({authenticator,runtimes,policies,rateLimiter:limiter,intakeConfig:config.intake||{},oneCConfig,identityResolver,integrityStore});
const consoleHtml=readFileSync(resolve(root,'demo/index.html'),'utf8');
const integrityTestHtml=integrityEnabled?readFileSync(resolve(root,'demo/integrity.html'),'utf8'):null;
const server=createServer(async(req,res)=>{
  if(req.method==='GET'&&(req.url==='/'||req.url==='/console')){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'x-frame-options':'DENY','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});return res.end(consoleHtml)}
  if(req.method==='GET'&&req.url==='/integrity'&&integrityTestHtml){
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store',
      'content-security-policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'x-frame-options':'DENY','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
    return res.end(integrityTestHtml);
  }
  return api(req,res);
});
const port=Number(process.env.PORT||8787),host=process.env.HOST||'127.0.0.1';server.listen(port,host,()=>process.stdout.write(`intake-integrity v0.6 listening on http://${host}:${port}\n`));
const shutdown=async()=>{server.close();if(pool)await pool.end();};process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
