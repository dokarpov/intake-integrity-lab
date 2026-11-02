import {createHash,randomUUID} from 'node:crypto';
import {PostgresSourceComparison} from './source-comparison.js';
import {bitrixCompanyPages,onecOdataPages} from './provider-readers.js';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=code=>Object.assign(new Error(code),{code});
const validTenant=s=>typeof s==='string'&&s.length>0&&s.length<=160;
const codeOnly=e=>typeof e?.code==='string'&&/^[a-z][a-z0-9_]{2,70}$/.test(e.code)
 ?e.code:'source_sync_unavailable';
const maxRows=1000000;
const fieldNames=['sourceRecordId','sharedKey','company','counterpartyType','contactRef','ownerRef',
 'originalStatus','upstreamVersion','observedAt'];
const statusSql="SELECT * FROM sales_source_sync_runs WHERE tenant_id=$1 AND run_id=$2 FOR UPDATE";
const openRun=(run,workerId)=>run&&run.status==='collecting'&&run.lease_owner===workerId&&
 new Date(run.lease_until).getTime()>Date.now();
const findingSql=`
WITH scope AS (
 SELECT * FROM sales_source_sync_staging
 WHERE tenant_id=$1 AND run_id=$2
), groups AS (
 SELECT shared_key,
 count(*) FILTER(WHERE source='1c')::integer AS nl,
 count(*) FILTER(WHERE source='bitrix24')::integer AS nr,
 min(source_record_id) FILTER(WHERE source='1c') AS il,
 min(source_record_id) FILTER(WHERE source='bitrix24') AS ir
 FROM scope WHERE shared_key IS NOT NULL GROUP BY shared_key
), pairs AS (
 SELECT g.shared_key, l.source_record_id AS id_l, r.source_record_id AS id_r,
 l.company AS company_l,r.company AS company_r,
 l.counterparty_type AS type_l,r.counterparty_type AS type_r,
 l.contact_ref AS contact_l,r.contact_ref AS contact_r,
 l.owner_ref AS owner_l,r.owner_ref AS owner_r
 FROM groups g
 JOIN scope l ON l.shared_key=g.shared_key AND l.source='1c'
 JOIN scope r ON r.shared_key=g.shared_key AND r.source='bitrix24'
 WHERE g.nl=1 AND g.nr=1
), observations AS (
 SELECT 'unmapped_source_record'::text AS code,null::text AS shared_key,
 null::text AS field,
 CASE WHEN s.source='1c' THEN s.source_record_id END::text AS il,
 CASE WHEN s.source='bitrix24' THEN s.source_record_id END::text AS ir,
 null::text AS vl,null::text AS vr
 FROM scope s WHERE s.shared_key IS NULL
 UNION ALL
 SELECT CASE WHEN nl>1 OR nr>1 THEN 'ambiguous_shared_key'
   WHEN nl=0 THEN 'missing_in_1c' ELSE 'missing_in_bitrix24' END,
   shared_key,null::text,il,ir,null::text,null::text
 FROM groups WHERE nl<>1 OR nr<>1
 UNION ALL
 SELECT CASE WHEN v.left_value IS NULL OR v.right_value IS NULL THEN
   'field_not_comparable' ELSE 'field_difference' END,
   p.shared_key,v.field,p.id_l,p.id_r,v.left_value,v.right_value
 FROM pairs p CROSS JOIN LATERAL (VALUES
   ('company',p.company_l,p.company_r),
   ('counterpartyType',p.type_l,p.type_r),
   ('contactRef',p.contact_l,p.contact_r),
   ('ownerRef',p.owner_l,p.owner_r)
 ) AS v(field,left_value,right_value)
 WHERE v.left_value IS DISTINCT FROM v.right_value
  OR v.left_value IS NULL OR v.right_value IS NULL
)
INSERT INTO sales_source_sync_findings
 (tenant_id,run_id,code,shared_key,field,source_record_1c,
  source_record_bitrix24,value_1c,value_bitrix24)
SELECT $1,$2,code,shared_key,field,il,ir,vl,vr FROM observations`;

export class PostgresSourcePairSync {
 constructor({pool}={}){
  if(!pool?.connect||!pool?.query)throw fail('source_sync_pool_required');
  this.pool=pool;this.db=new PostgresSourceComparison({pool});
 }
 transaction(tenantId,fn){
  if(!validTenant(tenantId))throw fail('invalid_tenant');
  return this.db.transaction(tenantId,fn);
 }
 async enqueue({tenantId,actorRef,mappingVersion}={}){
  if(typeof actorRef!=='string'||!actorRef.trim()||actorRef.length>255||
     typeof mappingVersion!=='string'||!/^mapping-[\w.-]{1,80}$/.test(mappingVersion))
   throw fail('sync_authorization_or_mapping_required');
  return this.transaction(tenantId,async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[tenantId+':source-sync']);
   const busy=await c.query(`SELECT run_id,status FROM sales_source_sync_runs
      WHERE tenant_id=$1 AND status IN ('queued','collecting')
      ORDER BY started_at LIMIT 1`,[tenantId]);
   if(busy.rows[0])return {runId:busy.rows[0].run_id,status:busy.rows[0].status,replayed:true};
   const id=randomUUID(),key=randomUUID();
   await c.query(`INSERT INTO sales_source_sync_runs
    (tenant_id,run_id,run_key,mapping_version,actor_ref)
    VALUES($1,$2,$3,$4,$5)`,[tenantId,id,key,mappingVersion,actorRef]);
   return {runId:id,status:'queued',replayed:false};
  });
 }
 async claim({tenantId,workerId}={}){
  if(typeof workerId!=='string'||!workerId||workerId.length>160)
   throw fail('sync_worker_required');
  return this.transaction(tenantId,async c=>{
   // Expired leases must NOT silently resume, as a previous attempt may have
   // produced untrustworthy partial snapshots and stale provider credentials.
   await c.query(`UPDATE sales_source_sync_runs SET status='failed',
      failure_code='source_sync_lease_expired',completed_at=clock_timestamp(),
      lease_owner=NULL,lease_until=NULL
     WHERE tenant_id=$1 AND status='collecting' AND lease_until<clock_timestamp()`,[tenantId]);
   const claimed=await c.query(`UPDATE sales_source_sync_runs SET
     status='collecting',lease_owner=$2,lease_until=clock_timestamp()+interval '5 minutes'
     WHERE (tenant_id,run_id) IN (
      SELECT tenant_id,run_id FROM sales_source_sync_runs
      WHERE tenant_id=$1 AND status='queued'
      ORDER BY started_at,run_id LIMIT 1 FOR UPDATE SKIP LOCKED
     ) RETURNING run_id,mapping_version`,[tenantId,workerId]);
   const r=claimed.rows[0];
   return r?{runId:r.run_id,mappingVersion:r.mapping_version}:null;
  });
 }
 async stagePage({tenantId,runId,workerId,source,pageIndex,rows}={}){
  if(!['1c','bitrix24'].includes(source)||!Number.isInteger(pageIndex)||
    pageIndex<0||pageIndex>=20000||!Array.isArray(rows)||rows.length>100)
   throw fail('sync_page_invalid');
  // Serialization of the canonical allowlisted row contract is part of the
  // content proof. Secrets, network URLs and extra fields never enter SQL.
  const page=rows.map(x=>{
   if(!x||typeof x!=='object')throw fail('sync_record_invalid');
   const result={};for(const field of fieldNames)result[field]=x[field]??null;
   if(typeof result.sourceRecordId!=='string'||!result.sourceRecordId||
      typeof result.company!=='string'||!result.company||
      !Number.isFinite(Date.parse(result.observedAt)))throw fail('sync_record_invalid');
   return result;
  });
  return this.transaction(tenantId,async c=>{
   const r=await c.query(statusSql,[tenantId,runId]),run=r.rows[0];
   if(!openRun(run,workerId))throw fail('sync_lease_or_owner_invalid');
   if(source==='1c'?run.onec_complete:run.bitrix_complete)throw fail('sync_source_already_complete');
   const expected=await c.query(`SELECT count(*)::integer AS n FROM sales_source_sync_pages
     WHERE tenant_id=$1 AND run_id=$2 AND source=$3`,[tenantId,runId,source]);
   if(pageIndex!==expected.rows[0].n)throw fail('sync_page_out_of_order');
   const total=(source==='1c'?run.onec_count:run.bitrix_count)+page.length;
   if(total>maxRows)throw fail('provider_record_limit_exceeded');
   await c.query(`INSERT INTO sales_source_sync_pages
     (tenant_id,run_id,source,page_index,content_sha256,record_count)
     VALUES($1,$2,$3,$4,$5,$6)`,
     [tenantId,runId,source,pageIndex,sha(page),page.length]);
   if(page.length)await c.query(`INSERT INTO sales_source_sync_staging
     (tenant_id,run_id,source,source_record_id,shared_key,company,counterparty_type,
      contact_ref,owner_ref,original_status,upstream_version,observed_at)
     SELECT $1,$2,$3,x."sourceRecordId",x."sharedKey",x.company,
      x."counterpartyType",x."contactRef",x."ownerRef",x."originalStatus",
      x."upstreamVersion",x."observedAt"::timestamptz
     FROM jsonb_to_recordset($4::jsonb) AS x(
      "sourceRecordId" text,"sharedKey" text,company text,
      "counterpartyType" text,"contactRef" text,"ownerRef" text,
      "originalStatus" text,"upstreamVersion" text,"observedAt" text)`,
     [tenantId,runId,source,JSON.stringify(page)]);
   const col=source==='1c'?'onec_count':'bitrix_count';
   await c.query(`UPDATE sales_source_sync_runs SET ${col}=$3,
    lease_until=clock_timestamp()+interval '5 minutes'
    WHERE tenant_id=$1 AND run_id=$2`,[tenantId,runId,total]);
   return {accepted:page.length,total};
  });
 }
 async completeSource({tenantId,runId,workerId,source,expectedCount}={}){
  if(!['1c','bitrix24'].includes(source)||!Number.isInteger(expectedCount))
   throw fail('sync_completion_invalid');
  return this.transaction(tenantId,async c=>{
   const r=await c.query(statusSql,[tenantId,runId]);const run=r.rows[0];
   if(!openRun(run,workerId))throw fail('sync_lease_or_owner_invalid');
   if(expectedCount!==(source==='1c'?run.onec_count:run.bitrix_count))
    throw fail('sync_incomplete_provider_scan');
   await c.query(`UPDATE sales_source_sync_runs SET
     ${source==='1c'?'onec_complete':'bitrix_complete'}=true,
     lease_until=clock_timestamp()+interval '5 minutes'
     WHERE tenant_id=$1 AND run_id=$2`,[tenantId,runId]);
  });
 }
 async publish({tenantId,runId,workerId}={}){
  return this.transaction(tenantId,async c=>{
   const rs=await c.query(statusSql,[tenantId,runId]),run=rs.rows[0];
   if(!openRun(run,workerId)||!run.onec_complete||!run.bitrix_complete)
    throw fail('sync_pair_not_fully_verified');
   const ids={};
   for(const [source,count] of [['1c',run.onec_count],['bitrix24',run.bitrix_count]]){
    const proof=await c.query(`SELECT page_index,record_count,content_sha256
      FROM sales_source_sync_pages
      WHERE tenant_id=$1 AND run_id=$2 AND source=$3 ORDER BY page_index`,
      [tenantId,runId,source]);
    if(proof.rows.reduce((sum,x)=>sum+x.record_count,0)!==count||
       proof.rows.some((x,i)=>x.page_index!==i))throw fail('sync_page_proof_incomplete');
    const digest=sha(proof.rows.map(x=>[x.page_index,x.record_count,x.content_sha256]));
    const id=randomUUID();ids[source]=id;
    await c.query(`INSERT INTO sales_source_snapshots
     (tenant_id,snapshot_id,source,import_key,content_sha256,policy_version,
      record_count,actor_ref,mapping_version,observed_from,observed_until,collection_quality)
     VALUES($1,$2,$3,$4,$5,'cross-source-v1',$6,$7,$8,
      $9,clock_timestamp(),'best_effort_full_scan')`,
     [tenantId,id,source,'sync:'+runId+':'+source,digest,count,run.actor_ref,
      run.mapping_version,run.started_at]);
    await c.query(`INSERT INTO sales_source_records
     (tenant_id,snapshot_id,source_record_id,shared_key,company,counterparty_type,
      contact_ref,owner_ref,original_status,upstream_version,upstream_observed_at)
     SELECT tenant_id,$3,source_record_id,shared_key,company,counterparty_type,
      contact_ref,owner_ref,original_status,upstream_version,observed_at
     FROM sales_source_sync_staging
     WHERE tenant_id=$1 AND run_id=$2 AND source=$4`,
     [tenantId,runId,id,source]);
   }
   await c.query(findingSql,[tenantId,runId]);
   const stats=await c.query(`SELECT code,count(*)::integer AS n
     FROM sales_source_sync_findings WHERE tenant_id=$1 AND run_id=$2 GROUP BY code`,[tenantId,runId]);
   const counts={onecRecords:run.onec_count,bitrix24Records:run.bitrix_count,
    findings:stats.rows.reduce((n,x)=>n+x.n,0)};
   for(const x of stats.rows)counts[x.code]=x.n;
   await c.query(`UPDATE sales_source_sync_runs SET status='published',
     onec_snapshot_id=$3,bitrix_snapshot_id=$4,counts_json=$5::jsonb,
     completed_at=clock_timestamp(),lease_owner=NULL,lease_until=NULL
     WHERE tenant_id=$1 AND run_id=$2`,
     [tenantId,runId,ids['1c'],ids.bitrix24,JSON.stringify(counts)]);
   return {runId,status:'published',snapshots:ids,counts,
    note:'Best-effort complete read of each source. Provider updates during scanning are not a consistent cross-source instant; findings are observations, not write permission.'};
  });
 }
 async fail({tenantId,runId,workerId,error}={}){
  // Record only a stable category; never persist provider responses or secrets.
  const code=codeOnly(error);
  return this.transaction(tenantId,async c=>{
   await c.query(`UPDATE sales_source_sync_runs SET status='failed',
    failure_code=$4,completed_at=clock_timestamp(),lease_owner=NULL,lease_until=NULL
    WHERE tenant_id=$1 AND run_id=$2 AND status='collecting' AND lease_owner=$3`,
    [tenantId,runId,workerId,code]);
   return {runId,status:'failed',failureCode:code};
  });
 }
 async status({tenantId,runId}={}){
  return this.transaction(tenantId,async c=>{
   const q=await c.query(`SELECT run_id,status,started_at,completed_at,failure_code,
     onec_count,bitrix_count,onec_complete,bitrix_complete,counts_json
     FROM sales_source_sync_runs WHERE tenant_id=$1 AND run_id=$2`,[tenantId,runId]);
   const row=q.rows[0];if(!row)return null;
   return {runId:row.run_id,status:row.status,startedAt:row.started_at,
    completedAt:row.completed_at,failureCode:row.failure_code,
    progress:{oneC:row.onec_count,bitrix24:row.bitrix_count,
     oneCComplete:row.onec_complete,bitrix24Complete:row.bitrix_complete},
    counts:row.counts_json};
  });
 }
 async latestReport({tenantId}={}){
  return this.transaction(tenantId,async c=>{
   const q=await c.query(`SELECT run_id,completed_at,onec_snapshot_id,bitrix_snapshot_id,
     mapping_version,counts_json FROM sales_source_sync_runs WHERE tenant_id=$1
     AND status='published' ORDER BY completed_at DESC,run_id DESC LIMIT 1`,[tenantId]);
   const r=q.rows[0];if(!r)return null;
   return {runId:r.run_id,completedAt:r.completed_at,mappingVersion:r.mapping_version,
    counts:r.counts_json,snapshots:{oneC:r.onec_snapshot_id,bitrix24:r.bitrix_snapshot_id},
    collectionQuality:'best_effort_full_scan',
    note:'Source observations only. Missing, ambiguous or stale records require independent verification.'};
  });
 }
 async findings({tenantId,runId,limit=50,offset=0,includeValues=false}={}){
  if(!Number.isInteger(limit)||limit<1||limit>50||
     !Number.isInteger(offset)||offset<0||offset>1000000)
   throw fail('sync_pagination_invalid');
  return this.transaction(tenantId,async c=>{
   const published=await c.query(`SELECT 1 FROM sales_source_sync_runs
     WHERE tenant_id=$1 AND run_id=$2 AND status='published'`,[tenantId,runId]);
   if(!published.rows.length)throw fail('sync_published_report_not_found');
   const q=await c.query(`SELECT code,field,
     ${includeValues?'shared_key,source_record_1c,source_record_bitrix24,value_1c,value_bitrix24,':''}
     finding_id FROM sales_source_sync_findings WHERE tenant_id=$1 AND run_id=$2
     ORDER BY code,shared_key NULLS LAST,field NULLS LAST,finding_id
     LIMIT $3 OFFSET $4`,[tenantId,runId,limit,offset]);
   return {runId,limit,offset,items:q.rows.map(x=>includeValues?x:
    {code:x.code,field:x.field,findingId:x.finding_id}),more:q.rows.length===limit};
  });
 }
}

// Run one queued workspace job with independently vault-validated credentials.
// No arbitrary tenant URLs/credentials from request bodies or model prompts.
export class ReadOnlySourceSyncWorker {
 constructor({store,vault,fetchFn,sleep}={}){
  if(!store||typeof vault?.getApproved!=='function')throw fail('source_sync_worker_dependencies_required');
  Object.assign(this,{store,vault,fetchFn,sleep});
 }
 async processOne({tenantId,workerId=randomUUID()}={}){
  const claimed=await this.store.claim({tenantId,workerId});
  if(!claimed)return null;
  try{
   const approved=await this.vault.getApproved(tenantId);
   if(!approved||approved.mappingVersion!==claimed.mappingVersion||
      !approved.permissionGranted||!approved.sources?.['1c']||!approved.sources?.bitrix24)
    throw fail('source_sync_grant_revoked');
   for(const source of ['1c','bitrix24']){
    const {connection,mapping}=approved.sources[source];
    const reader=source==='1c'?onecOdataPages:bitrixCompanyPages;
    let index=0;
    for await(const page of reader({connection,mapping,fetchFn:this.fetchFn,sleep:this.sleep})){
     // Check the secret vault on every page to respond to revocation or config
     // rotations mid-scan. No provider credential ever enters the PostgreSQL
     // ingest tables or runtime log.
     const current=await this.vault.getApproved(tenantId);
     if(!current?.permissionGranted||current.mappingVersion!==claimed.mappingVersion||
        current.grantId!==approved.grantId)
      throw fail('source_sync_grant_revoked');
     if(page.complete){
      await this.store.completeSource({tenantId,runId:claimed.runId,workerId,
       source,expectedCount:page.total});
     }else{
      await this.store.stagePage({tenantId,runId:claimed.runId,workerId,
       source,pageIndex:index++,rows:page.rows});
     }
    }
   }
   return await this.store.publish({tenantId,runId:claimed.runId,workerId});
  }catch(e){
   await this.store.fail({tenantId,runId:claimed.runId,workerId,error:e});
   return {runId:claimed.runId,status:'failed',failureCode:codeOnly(e)};
  }
 }
}
