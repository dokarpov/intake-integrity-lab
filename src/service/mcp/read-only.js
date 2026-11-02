import {randomUUID} from 'node:crypto';
import {requirePermission} from '../auth/rbac.js';

// Stateless 2025-11-25 Streamable HTTP (JSON responses). All calls must carry
// an independently verified SaaS OIDC bearer. This is NOT an OAuth issuer.
// ChatGPT/Claude interactive account connection requires separately reviewed
// OAuth authorization-server metadata, consent, token delegation and revocation.
const VERSION='2025-11-25';
const MAX_BODY=16_384;
const MAX_OBSERVATIONS=30;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tools=[
 {name:'list_source_snapshots',description:'List versioned 1C and Bitrix24 snapshot metadata in the currently authenticated workspace. No source-system writes.',inputSchema:{type:'object',properties:{},additionalProperties:false},
  annotations:{title:'List source evidence',readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},
 {name:'get_latest_discrepancies',description:'Read the latest persisted 1C vs Bitrix24 comparison. Findings are observations, not identity matches or source-of-truth decisions. Returns at most 30 observations. Raw field values require audit.read in addition to review.read.',inputSchema:{type:'object',properties:{includeValues:{type:'boolean',description:'Include original field values and identifiers; requires audit.read. Default false.'}},additionalProperties:false},
  annotations:{title:'Read discrepancies',readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},
 {name:'list_comparison_assessments',description:'Read existing human assessments for one comparison. Requires both review.read and audit.read. Never modifies an assessment.',inputSchema:{type:'object',properties:{comparisonId:{type:'string',pattern:'^[0-9a-fA-F-]{36}$'}},required:['comparisonId'],additionalProperties:false},
  annotations:{title:'Read review evidence',readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}}
];
const toolMap=new Map(tools.map(t=>[t.name,t]));
function output(res,status,body){
 const bytes=JSON.stringify(body);
 res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(bytes),
  'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
  'x-frame-options':'DENY','vary':'authorization'});
 res.end(bytes);
}
function rpc(id,result){return {jsonrpc:'2.0',id,result}}
function rpcError(id,code,message){return {jsonrpc:'2.0',id,error:{code,message}}}
function reject(res,code,message){return output(res,code,{error:message})}
function shape(x){return x&&typeof x==='object'&&!Array.isArray(x)}
async function parseBody(req){
 const len=Number(req.headers['content-length']||0);
 if(!Number.isFinite(len)||len>MAX_BODY||len<0)throw Object.assign(new Error('payload_too_large'),{statusCode:413});
 let size=0,parts=[];
 for await(const part of req){
  size+=part.length;
  if(size>MAX_BODY)throw Object.assign(new Error('payload_too_large'),{statusCode:413});
  parts.push(part);
 }
 let value;
 try{value=JSON.parse(Buffer.concat(parts).toString('utf8'))}
 catch{throw Object.assign(new Error('invalid_json'),{statusCode:400})}
 if(!shape(value))throw Object.assign(new Error('invalid_rpc_object'),{statusCode:400});
 return value;
}
function limitSnapshotRows(rows){
 return (rows||[]).map(({source,snapshotId,recordCount,createdAt})=>
  ({source,snapshotId,recordCount,createdAt}));
}
function summarizeComparison(report,includeValues){
 if(!report)return {status:'not_available',reason:'no_persisted_comparison'};
 const observations=Array.isArray(report.observations)?report.observations:[];
 const selected=observations.slice(0,MAX_OBSERVATIONS).map(item=>includeValues?{
   code:item.code,field:item.field,sharedKey:item.sharedKey,
   sourceRecord1c:item.sourceRecord1c,sourceRecordBitrix24:item.sourceRecordBitrix24,
   value1c:item.value1c,valueBitrix24:item.valueBitrix24
  }:{code:item.code,field:item.field});
 return {status:'available',comparisonId:report.comparisonId,
  createdAt:report.createdAt,policyVersion:report.policyVersion,
  snapshots:report.snapshots,counts:report.counts,
  observations:selected,observationCount:observations.length,
  truncated:observations.length>MAX_OBSERVATIONS,
  valuesIncluded:includeValues,
  caveat:'Read-only evidence. No field authority, identity merge, consent grant, or CRM write is implied.'};
}
function argumentsFor(name,args){
 if(!shape(args))throw Object.assign(new Error('invalid_arguments'),{statusCode:400});
 if(name==='list_source_snapshots'&&Object.keys(args).length)return null;
 if(name==='get_latest_discrepancies'&&
  (Object.keys(args).some(k=>k!=='includeValues')||
    (args.includeValues!==undefined&&typeof args.includeValues!=='boolean')))return null;
 if(name==='list_comparison_assessments'&&
  (Object.keys(args).length!==1||typeof args.comparisonId!=='string'||!uuid.test(args.comparisonId)))return null;
 return args;
}
export function createReadOnlyMcpHandler({authenticator,sourceComparisonStore,rateLimiter,allowedOrigins=[]}={}){
 if(typeof authenticator?.authenticate!=='function'||!sourceComparisonStore)
  throw Error('mcp_authenticated_store_required');
 const origins=new Set(allowedOrigins);
 return async(req,res)=>{
  if(req.method!=='POST')return reject(res,405,'mcp_post_only');
  // A normal remote MCP client has no browser Origin header. Cross-origin browser
  // requests and DNS rebinding must not be able to turn a bearer into a CSRF call.
  if(req.headers.origin&&!origins.has(req.headers.origin))return reject(res,403,'untrusted_origin');
  if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))
   return reject(res,415,'application_json_required');
  if(req.headers.accept&&!String(req.headers.accept).includes('application/json')&&req.headers.accept!=='*/*')
   return reject(res,406,'application_json_accept_required');
  // Refuse anonymous and shared token users. Called on EVERY request: no global
  // session can retain a stale workspace or revoked role.
  let principal;
  try{principal=await authenticator.authenticate(req)}
  catch(e){return reject(res,e?.statusCode===403?403:401,'mcp_authentication_required')}
  if(!principal?.tenantId||!principal?.id||!principal?.permissions?.has('review.read')||
     principal.claims?.dev||principal.claims?.sandbox||
     typeof principal.claims?.iss!=='string'||
     principal.claims.iss==='urn:intake:legacy:unverified'){
   return reject(res,403,'mcp_verified_reviewer_required');
  }
  const rl=rateLimiter?.check('mcp:'+principal.tenantId+':'+principal.id,{limit:30,windowMs:60_000});
  if(rl&&!rl.allowed)return reject(res,429,'rate_limit_exceeded');
  let request;
  try{request=await parseBody(req)}
  catch(e){return reject(res,e.statusCode||400,'invalid_mcp_request')}
  const id=request.id;
  if(request.jsonrpc!=='2.0'||typeof request.method!=='string'||
     (id!==undefined&&!(typeof id==='string'||typeof id==='number'&&Number.isFinite(id))))
   return output(res,400,rpcError(id??null,-32600,'Invalid Request'));
  if(id===undefined){
   if(request.method==='notifications/initialized')return res.writeHead(202,{'cache-control':'no-store'}).end();
   return output(res,400,rpcError(null,-32600,'Unexpected notification'));
  }
  if(request.method==='initialize'){
   const proposed=request.params?.protocolVersion;
   if(typeof proposed!=='string')return output(res,200,rpcError(id,-32602,'Protocol version required'));
   return output(res,200,rpc(id,{protocolVersion:VERSION,capabilities:{tools:{listChanged:false}},
     serverInfo:{name:'intake-integrity-readonly',version:'0.1.0'},
     instructions:'Read-only evidence for the authenticated workspace. Never infer authority, approval or permission to write from discrepancies.'}));
  }
  if(req.headers['mcp-protocol-version']&&req.headers['mcp-protocol-version']!==VERSION)
   return reject(res,400,'unsupported_mcp_version');
  if(request.method==='ping')return output(res,200,rpc(id,{}));
  if(request.method==='tools/list')return output(res,200,rpc(id,{tools}));
  if(request.method!=='tools/call')return output(res,200,rpcError(id,-32601,'Method not found'));
  const name=request.params?.name;
  if(typeof name!=='string'||!toolMap.has(name))
   return output(res,200,rpcError(id,-32602,'Unknown tool'));
  let args;try{args=argumentsFor(name,request.params?.arguments??{})}catch{args=null}
  if(args===null)return output(res,200,rpcError(id,-32602,'Invalid tool arguments'));
  const hasAudit=principal.permissions.has('audit.read');
  if((name==='list_comparison_assessments'||args.includeValues===true)&&!hasAudit)
   return output(res,200,{...rpc(id,{content:[{type:'text',text:'Additional audit.read permission required.'}],isError:true})});
  try{
   let data;
   if(name==='list_source_snapshots'){
    const snapshots=await sourceComparisonStore.latest({tenantId:principal.tenantId});
    data={sources:limitSnapshotRows(snapshots.sources)};
   }else if(name==='get_latest_discrepancies'){
    data=summarizeComparison(await sourceComparisonStore.latestComparison({tenantId:principal.tenantId}),args.includeValues===true);
   }else if(name==='list_comparison_assessments'){
    const items=await sourceComparisonStore.assessments({tenantId:principal.tenantId,comparisonId:args.comparisonId});
    data={comparisonId:args.comparisonId,assessments:items.slice(0,50),truncated:items.length>50};
   }
   return output(res,200,rpc(id,{content:[{type:'text',text:JSON.stringify(data)}],
    structuredContent:data,isError:false}));
  }catch{
   // Do not leak SQL, provider, database, auth or customer details in MCP errors.
   return output(res,200,rpc(id,{content:[{type:'text',text:'Evidence temporarily unavailable.'}],isError:true}));
  }
 };
}
