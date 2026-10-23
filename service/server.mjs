import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OidcJwtVerifier } from '../src/service/auth/oidc-verifier.js';
import { Authenticator } from '../src/service/auth/authenticator.js';
import { StagingAccessAuthenticator } from '../src/service/auth/staging-access.js';
import { WorkspaceMembershipAuthenticator } from '../src/service/auth/workspace-membership.js';
import { VerifiedWorkspaceDirectoryAuthenticator } from '../src/service/auth/workspace-directory.js';
import { createWorkspaceDirectoryHandler } from '../src/service/auth/workspace-directory-http.js';
import { WorkspaceBootstrap } from '../src/service/auth/workspace-bootstrap.js';
import { assertProductionWorkspaceBoundary } from '../src/service/auth/workspace-production-boundary.js';
import { createWorkspaceRegistrationHandler } from '../src/service/auth/workspace-registration-http.js';
import { SlidingWindowRateLimiter } from '../src/service/http/rate-limit.js';
import { createStagingWriteGate } from '../src/service/http/staging-write-gate.js';
import { ServicePolicyRegistry } from '../src/service/policies.js';
import { TenantRuntimeRegistry } from '../src/service/runtime.js';
import { AwsKmsHmacPseudonymizer } from '../src/compliance/pseudonymizer-kms.js';
import { createApiHandler } from '../src/service/app.js';
import { PostgresSalesIntegrity } from '../src/sales-integrity/postgres-integrity.js';
import { SandboxDecisionEvidence } from '../src/sales-integrity/sandbox-evidence.js';
import { SandboxCrmSimulator } from '../src/sales-integrity/sandbox-crm.js';
import { PostgresSourceComparison } from '../src/sales-integrity/source-comparison.js';
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
const stagingTokenAuth=process.env.NODE_ENV==='staging'&&process.env.STAGING_TOKEN_AUTH_ENABLED==='true';
const identityAuthenticator=stagingTokenAuth
  ?new StagingAccessAuthenticator({token:process.env.STAGING_ACCESS_TOKEN,tenantId:'staging-demo'})
  :new Authenticator({mode:config.auth?.mode||'oidc',verifier,claimOptions:{
    rolesClaim:config.auth?.rolesClaim,tenantClaim:config.auth?.tenantClaim,nameClaim:config.auth?.nameClaim
  }});
let pool=null,mode='memory';if(process.env.DATABASE_URL){const {Pool}=await import('pg');pool=new Pool({connectionString:process.env.DATABASE_URL,max:Number(process.env.PG_POOL_MAX||10),statement_timeout:Number(process.env.PG_STATEMENT_TIMEOUT_MS||10000)});mode='postgres'}
if(process.env.NODE_ENV==='production'&&!process.env.DATABASE_URL)throw new Error('DATABASE_URL_required_in_production');
const workspaceMembershipEnforced=process.env.WORKSPACE_MEMBERSHIP_ENFORCED==='true';
if(process.env.NODE_ENV==='production'&&!workspaceMembershipEnforced)
  throw new Error('workspace_membership_enforcement_required_in_production');
if(workspaceMembershipEnforced&&(!pool||config.auth?.mode!=='oidc'||stagingTokenAuth))
  throw new Error('workspace_membership_requires_postgres_oidc');
const workspaceDirectoryEnabled=process.env.WORKSPACE_DIRECTORY_AUTH_ENABLED==='true';
if(process.env.NODE_ENV==='production'&&!workspaceDirectoryEnabled)
  throw new Error('verified_workspace_directory_auth_required_in_production');
if(workspaceDirectoryEnabled&&(!workspaceMembershipEnforced||!pool||!verifier||
   config.auth?.mode!=='oidc'||stagingTokenAuth))
  throw new Error('workspace_directory_requires_oidc_and_membership');
if(process.env.NODE_ENV==='production'&&workspaceDirectoryEnabled)
 await assertProductionWorkspaceBoundary({pool});
const directoryAuthenticator=workspaceDirectoryEnabled
  ?new VerifiedWorkspaceDirectoryAuthenticator({verifier,pool}):null;
const authenticator=workspaceDirectoryEnabled
  ?directoryAuthenticator
  :workspaceMembershipEnforced
    ?new WorkspaceMembershipAuthenticator({authenticator:identityAuthenticator,pool})
    :identityAuthenticator;
let subjectRefProvider=null;if(process.env.AWS_KMS_HMAC_KEY_ID)subjectRefProvider=await AwsKmsHmacPseudonymizer.fromDefault({keyId:process.env.AWS_KMS_HMAC_KEY_ID,region:process.env.AWS_REGION});
if(process.env.NODE_ENV==='production'&&!subjectRefProvider&&!process.env.SUBJECT_HMAC_SECRET)throw new Error('KMS_HMAC_or_SUBJECT_HMAC_SECRET_required_in_production');
const runtimes=new TenantRuntimeRegistry({mode,pool,strictLedger:true,subjectRefProvider,subjectHmacSecret:process.env.SUBJECT_HMAC_SECRET||'local-dev-subject-hmac-change-me'});
const policies=new ServicePolicyRegistry(config.policies);const limiter=new SlidingWindowRateLimiter({limit:Number(process.env.RATE_LIMIT_PER_MINUTE||120)});
const workspaceDirectoryHandler=directoryAuthenticator
  ?createWorkspaceDirectoryHandler({directory:directoryAuthenticator,rateLimiter:limiter}):null;
const workspaceSelfSignupEnabled=process.env.WORKSPACE_SELF_SIGNUP_ENABLED==='true';
if(workspaceSelfSignupEnabled&&
   (!workspaceMembershipEnforced||!pool||!verifier||stagingTokenAuth||
    config.auth?.mode!=='oidc'||process.env.NODE_ENV==='staging'))
  throw new Error('workspace_self_signup_requires_verified_oidc_and_membership');
// Bootstrap credentials are deliberately separate from the regular API pool.
// The authenticated app role must not be able to grant its own memberships.
if(workspaceSelfSignupEnabled&&
   (!process.env.WORKSPACE_BOOTSTRAP_DATABASE_URL||
    process.env.WORKSPACE_BOOTSTRAP_DATABASE_URL===process.env.DATABASE_URL))
  throw new Error('separate_workspace_bootstrap_database_identity_required');
let workspaceBootstrapPool=null;
if(workspaceSelfSignupEnabled){
  const {Pool}=await import('pg');
  workspaceBootstrapPool=new Pool({
    connectionString:process.env.WORKSPACE_BOOTSTRAP_DATABASE_URL,max:3,
    statement_timeout:Number(process.env.PG_STATEMENT_TIMEOUT_MS||10000)
  });
  const appRole=await pool.query(`SELECT current_user AS name,
    has_table_privilege(current_user,'intake_workspace_memberships','INSERT') AS can_insert,
    has_table_privilege(current_user,'intake_workspace_memberships','UPDATE') AS can_update,
    has_table_privilege(current_user,'intake_workspace_memberships','DELETE') AS can_delete`);
  const bootstrapRole=await workspaceBootstrapPool.query(`SELECT current_user AS name,
    r.rolsuper,r.rolbypassrls
    FROM pg_roles r WHERE r.rolname=current_user`);
  const a=appRole.rows[0],b=bootstrapRole.rows[0];
  if(!a||!b||a.name===b.name||a.can_insert||a.can_update||a.can_delete||
     b.rolsuper||b.rolbypassrls)
    throw new Error('workspace_bootstrap_database_role_boundary_invalid');
}
const workspaceRegistration=workspaceSelfSignupEnabled
  ?createWorkspaceRegistrationHandler({
     verifier,bootstrap:new WorkspaceBootstrap({pool:workspaceBootstrapPool}),rateLimiter:limiter
   }):null;
const oneCConfig=process.env.ONE_C_CONFIG_FILE?loadJson(process.env.ONE_C_CONFIG_FILE):null;
const identityResolver=process.env.IDENTITY_RESOLVER_CONFIG_FILE?new HttpIdentityResolver(loadJson(process.env.IDENTITY_RESOLVER_CONFIG_FILE)):null;
// New transactional intake backend is intentionally disabled by default.
// A real external evidence verifier must be installed before decision routes
// can execute. This bootstrap does not claim verified approvals from raw JSON.
const integrityEnabled=process.env.INTEGRITY_PG_V2_ENABLED==='true';
if(integrityEnabled&&(!pool||!process.env.INTEGRITY_FINGERPRINT_HMAC_SECRET)){
  throw new Error('INTEGRITY_PG_V2_REQUIRES_DATABASE_AND_HMAC_SECRET');
}
const sourceComparisonStore=integrityEnabled?new PostgresSourceComparison({pool}):null;
const integrityStore=integrityEnabled?new PostgresSalesIntegrity({
  pool,fingerprintSecret:process.env.INTEGRITY_FINGERPRINT_HMAC_SECRET
}):null;
const sandboxEnabled=integrityEnabled&&process.env.NODE_ENV==='staging'&&process.env.INTEGRITY_SANDBOX_ENABLED==='true';
if(sandboxEnabled&&!process.env.SANDBOX_EVIDENCE_HMAC_SECRET)throw new Error('sandbox_evidence_secret_required');
const sandboxEvidenceProvider=sandboxEnabled?new SandboxDecisionEvidence({
  secret:process.env.SANDBOX_EVIDENCE_HMAC_SECRET,integrityStore,tenantId:'staging-demo'
}):null;
const sandboxCrmSimulator=sandboxEnabled?new SandboxCrmSimulator({pool,integrity:integrityStore,tenantId:'staging-demo'}):null;
const api=createApiHandler({
  authenticator,runtimes,policies,rateLimiter:limiter,intakeConfig:config.intake||{},
  oneCConfig,identityResolver,integrityStore,
  integrityEvidenceVerifier:sandboxEvidenceProvider,sandboxEvidenceProvider,sandboxCrmSimulator,sourceComparisonStore
});
const consoleHtml=readFileSync(resolve(root,'demo/index.html'),'utf8');
const integrityTestHtml=integrityEnabled?readFileSync(resolve(root,'demo/integrity.html'),'utf8'):null;
const onboardingTestHtml=integrityEnabled?readFileSync(resolve(root,'demo/onboarding.html'),'utf8'):null;
const scrollStoryHtml=integrityEnabled?readFileSync(resolve(root,'demo/scroll-story.html'),'utf8'):null;
const sourceTestHtml=integrityEnabled?readFileSync(resolve(root,'demo/source-comparison.html'),'utf8'):null;
const stagingWriteGate=createStagingWriteGate();
const server=createServer(async(req,res)=>{
  if(stagingWriteGate(req,res))return;
  if(req.method==='POST'&&req.url==='/api/workspaces/registration'&&workspaceRegistration)
    return workspaceRegistration(req,res);
  if(req.method==='GET'&&req.url==='/api/workspaces'&&workspaceDirectoryHandler)
    return workspaceDirectoryHandler(req,res);
  if(req.method==='GET'&&(req.url==='/'||req.url==='/console')){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'x-frame-options':'DENY','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});return res.end(consoleHtml)}
  if(req.method==='GET'&&req.url==='/testing/story'&&scrollStoryHtml){
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store',
      'content-security-policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'x-frame-options':'DENY','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
    return res.end(scrollStoryHtml);
  }
  if(req.method==='GET'&&req.url==='/welcome'&&onboardingTestHtml){
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store',
      'content-security-policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'x-frame-options':'DENY','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
    return res.end(onboardingTestHtml);
  }
  if(req.method==='GET'&&req.url==='/integrity'&&integrityTestHtml){
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store',
      'content-security-policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'x-frame-options':'DENY','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
    return res.end(integrityTestHtml);
  }
  if(req.method==='GET'&&req.url==='/sources'&&sourceTestHtml){
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store',
     'content-security-policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
     'x-frame-options':'DENY','x-content-type-options':'nosniff'});
    return res.end(sourceTestHtml);
  }
  return api(req,res);
});
const port=Number(process.env.PORT||8787),host=process.env.HOST||'127.0.0.1';server.listen(port,host,()=>process.stdout.write(`intake-integrity v0.6 listening on http://${host}:${port}\n`));
const shutdown=async()=>{server.close();if(workspaceBootstrapPool)await workspaceBootstrapPool.end();if(pool)await pool.end();};process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
