// Restricted read-only provider adapters. Configuration is resolved from a
// server-side tenant credential vault, NEVER supplied by a browser/AI request.
// Outbound network policy must additionally restrict DNS/IP and destinations.
const PAGE=100,MAX_BYTES=2_000_000,MAX_PAGES=20_000,MAX_ROWS=1_000_000;
const deniedHostname=h=>/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(h)||
 /^(127\.|10\.|192\.168\.|169\.254\.|0\.|::1$|fc[0-9a-f]{2}:|fe80:)/i.test(h)||
 /^172\.(1[6-9]|2[0-9]|3[01])\./.test(h);
function bad(code){return Object.assign(new Error(code),{code});}
function required(x,key,max=120){
 if(typeof x!=='string'||!x.trim()||x.length>max)throw bad('provider_invalid_'+key);
 return x.trim();
}
export function approvedOrigin(url,allowHosts){
 let u;try{u=new URL(url)}catch{throw bad('provider_invalid_origin')}
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||
   u.pathname!=='/'||u.port||deniedHostname(u.hostname)||
   !Array.isArray(allowHosts)||!allowHosts.includes(u.hostname))
  throw bad('provider_origin_not_approved');
 return u.origin;
}
async function readBoundedJson(res){
 const length=Number(res.headers?.get?.('content-length')||0);
 if(length>MAX_BYTES)throw bad('provider_response_too_large');
 if(!res.body){if(typeof res.json==='function')return res.json();throw bad('provider_empty_response')}
 const parts=[];let size=0;
 for await(const part of res.body){
  size+=part.length;if(size>MAX_BYTES)throw bad('provider_response_too_large');
  parts.push(part);
 }
 try{return JSON.parse(Buffer.concat(parts).toString('utf8'))}
 catch{throw bad('provider_malformed_json')}
}
export async function providerJson({url,method='GET',headers={},body=null,
 fetchFn=globalThis.fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),signal}={}){
 if(!['GET','POST'].includes(method))throw bad('provider_read_only_method_required');
 for(let attempt=0;attempt<4;attempt++){
  let res;
  try{
   res=await fetchFn(url,{method,headers,body:body?JSON.stringify(body):undefined,
    redirect:'error',signal:signal||AbortSignal.timeout(20_000)});
  }catch{throw bad('provider_network_unavailable')}
  if([429,503].includes(res.status)){
   if(attempt===3)throw bad('provider_rate_limited');
   let seconds=Number(res.headers?.get?.('retry-after')||0);
   if(!Number.isFinite(seconds)||seconds<0)seconds=0;
   await sleep(Math.min(3000,Math.max(150,seconds*1000,250*(2**attempt))));
   continue;
  }
  if(res.status===401)throw bad('provider_authentication_expired');
  if(res.status===403)throw bad('provider_permission_denied');
  if(!res.ok)throw bad('provider_http_unavailable');
  const data=await readBoundedJson(res);
  if(data?.error){
   if(/expired|token|auth/i.test(String(data.error)))throw bad('provider_authentication_expired');
   if(/access_denied|permission/i.test(String(data.error)))throw bad('provider_permission_denied');
   if(/query_limit|operation_time_limit/i.test(String(data.error)))throw bad('provider_rate_limited');
   throw bad('provider_api_unavailable');
  }
  return data;
 }
 throw bad('provider_rate_limited');
}
function pick(x,key,max=120){
 if(!key)return null;
 const v=x?.[key];
 if(v===null||v===undefined||v==='')return null;
 if(typeof v!=='string'&&typeof v!=='number')throw bad('provider_mapping_type_invalid');
 return required(String(v),'mapped_field',max);
}
function makeRow(record,{source,idField,nameField,sharedKeyField,counterpartyTypeField,
 contactRefField,ownerRefField,statusField,versionField}){
 const sourceRecordId=pick(record,idField,120);
 const company=pick(record,nameField,200);
 if(!sourceRecordId||!company)throw bad('provider_required_mapping_missing');
 return {sourceRecordId,sharedKey:pick(record,sharedKeyField,120),company,
  counterpartyType:pick(record,counterpartyTypeField,60),
  contactRef:pick(record,contactRefField,120),
  ownerRef:pick(record,ownerRefField,120),originalStatus:pick(record,statusField,120),
  upstreamVersion:pick(record,versionField,160),observedAt:new Date().toISOString()};
}
const assertMapping=(m,expected)=>{
 if(!m||m.source!==expected||!/^mapping-[a-zA-Z0-9._-]{1,80}$/.test(m.version))
  throw bad('provider_mapping_not_approved');
 for(const field of ['idField','nameField']){
  if(typeof m[field]!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(m[field]))
   throw bad('provider_mapping_not_approved');
 }
 for(const field of ['sharedKeyField','counterpartyTypeField','contactRefField',
  'ownerRefField','statusField','versionField']){
  if(m[field]!==undefined&&m[field]!==null&&
     (typeof m[field]!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(m[field])))
   throw bad('provider_mapping_not_approved');
 }
 return m;
};
// Bitrix REST list methods return 50 records/page. Full scans are best-effort,
// NOT an authoritative point-in-time database snapshot.
export async function* bitrixCompanyPages({connection,mapping,fetchFn,sleep,signal}={}){
 const m=assertMapping(mapping,'bitrix24');
 const origin=approvedOrigin(connection?.origin,connection?.allowHosts);
 const accessToken=required(connection?.accessToken,'token',4000);
 const endpoint=origin+'/rest/crm.company.list.json';
 let cursor=0,total=0,lastNext=null;
 const seenIds=new Set();
 for(let page=0;page<MAX_PAGES;page++){
  const data=await providerJson({url:endpoint,method:'POST',fetchFn,sleep,signal,
   headers:{'authorization':'Bearer '+accessToken,'content-type':'application/json',
    'accept':'application/json'},body:{select:[
     ...new Set([m.idField,m.nameField,m.sharedKeyField,m.counterpartyTypeField,
      m.contactRefField,m.ownerRefField,m.statusField,m.versionField].filter(Boolean))
    ],order:{ID:'ASC'},start:cursor}});
  if(!Array.isArray(data.result)||data.result.length>50)
   throw bad('bitrix_unexpected_page');
  const rows=data.result.map(x=>makeRow(x,m));
  for(const row of rows){
   if(seenIds.has(row.sourceRecordId))throw bad('bitrix_duplicate_or_unstable_page');
   seenIds.add(row.sourceRecordId);
  }
  total+=rows.length;
  if(total>MAX_ROWS)throw bad('provider_record_limit_exceeded');
  yield {source:'bitrix24',rows,complete:false};
  if(data.next===undefined||data.next===null){
   if(Number.isInteger(data.total)&&data.total!==total)throw bad('bitrix_inconsistent_full_scan');
   yield {source:'bitrix24',rows:[],complete:true,total,quality:'best_effort_full_scan'};
   return;
  }
  const next=Number(data.next);
  if(!Number.isInteger(next)||next<=cursor||next>MAX_ROWS||next===lastNext)
   throw bad('bitrix_pagination_loop');
  lastNext=cursor;cursor=next;
 }
 throw bad('bitrix_page_limit_exceeded');
}
// 1C Enterprise 8.3 standard OData 3 endpoint. Entity is an explicit
// vetted Catalog_* configuration key, not an arbitrary URL or SQL expression.
// No universal 1C schema is assumed. No fallback to privileged default creds.
export async function* onecOdataPages({connection,mapping,fetchFn,sleep,signal}={}){
 const m=assertMapping(mapping,'1c');
 const origin=approvedOrigin(connection?.origin,connection?.allowHosts);
 const entity=required(connection?.entity,'entity',100);
 if(!/^Catalog_[A-Za-z0-9_]+$/.test(entity))throw bad('onec_entity_not_approved');
 const username=required(connection?.username,'username',255);
 const password=required(connection?.password,'password',2000);
 const base=origin+'/odata/standard.odata/'+entity;
 const fields=[...new Set([m.idField,m.nameField,m.sharedKeyField,
  m.counterpartyTypeField,m.contactRefField,m.ownerRefField,m.statusField,
  m.versionField].filter(Boolean))];
 const encoded=Buffer.from(username+':'+password,'utf8').toString('base64');
 let offset=0;const seen=new Set(),seenLinks=new Set();
 let nextUrl=null;
 for(let page=0;page<MAX_PAGES;page++){
  const q=new URL(base);
  q.searchParams.set('$format','json');q.searchParams.set('$top',String(PAGE));
  q.searchParams.set('$skip',String(offset));q.searchParams.set('$orderby',m.idField+' asc');
  q.searchParams.set('$select',fields.join(','));
  const requested=nextUrl||q.toString();
  const data=await providerJson({url:requested,method:'GET',fetchFn,sleep,signal,
   headers:{authorization:'Basic '+encoded,accept:'application/json'}});
  const rowsRaw=data?.value??data?.d?.results;
  if(!Array.isArray(rowsRaw)||rowsRaw.length>PAGE)throw bad('onec_unexpected_page');
  const rows=rowsRaw.map(x=>makeRow(x,m));
  for(const row of rows){
   if(seen.has(row.sourceRecordId))throw bad('onec_duplicate_or_unstable_page');
   seen.add(row.sourceRecordId);
  }
  offset+=rows.length;
  if(offset>MAX_ROWS)throw bad('provider_record_limit_exceeded');
  yield {source:'1c',rows,complete:false};
  const link=data?.['@odata.nextLink']||data?.['odata.nextLink']||data?.d?.__next;
  if(link!==undefined&&link!==null){
   if(typeof link!=='string'||link.length>1600)throw bad('onec_unsafe_next_link');
   let u;try{u=new URL(link,requested)}catch{throw bad('onec_unsafe_next_link')}
   const allowed=new Set(['$format','$top','$skip','$skiptoken','$select','$orderby']);
   if(u.origin!==origin||u.pathname!==new URL(base).pathname||u.hash||
      u.username||u.password||u.port||[...u.searchParams.keys()].some(k=>!allowed.has(k))||
      u.searchParams.get('$select')&&u.searchParams.get('$select')!==fields.join(',')||
      u.searchParams.get('$orderby')&&u.searchParams.get('$orderby')!==m.idField+' asc'||
      seenLinks.has(u.toString())||u.toString()===requested)
    throw bad('onec_unsafe_next_link');
   // OData continuation tokens are provider-originated but must never redirect
   // to a new host, entity, field selection or a token-leaking URL.
   seenLinks.add(u.toString());
   nextUrl=u.toString();
   continue;
  }
  nextUrl=null;
  const reported=Number(data?.d?.__count??data?.['@odata.count']);
  if(Number.isInteger(reported)&&reported>offset&&rows.length<PAGE)
   throw bad('onec_incomplete_scan');
  if(rows.length<PAGE){
   yield {source:'1c',rows:[],complete:true,total:offset,quality:'best_effort_full_scan'};
   return;
  }
 }
 throw bad('onec_page_limit_exceeded');
}
