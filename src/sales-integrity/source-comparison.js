import {createHash,randomUUID} from 'node:crypto';

const VERSION='cross-source-v1';
const required=(x,field,max=160)=>{
 if(typeof x!=='string'||!x.trim()||x.length>max)throw Error('invalid_'+field);
 return x.trim();
};
const optional=(x,field,max=200)=>{
 if(x===null||x===undefined||x==='')return null;
 return required(x,field,max);
};
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fields=['company','counterpartyType','contactRef','ownerRef'];
function canonicalRow(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('invalid_record');
 return {
  sourceRecordId:required(input.sourceRecordId,'source_record_id',120),
  sharedKey:optional(input.sharedKey,'shared_key',120),
  company:required(input.company,'company',200),
  counterpartyType:optional(input.counterpartyType,'counterparty_type',60),
  contactRef:optional(input.contactRef,'contact_ref',120),
  ownerRef:optional(input.ownerRef,'owner_ref',120),
  originalStatus:optional(input.originalStatus,'original_status',120)
 };
}
export function normalizeSnapshotRows(rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>100)throw Error('snapshot_requires_1_to_100_rows');
 const a=rows.map(canonicalRow).sort((x,y)=>x.sourceRecordId.localeCompare(y.sourceRecordId));
 if(new Set(a.map(x=>x.sourceRecordId)).size!==a.length)throw Error('duplicate_source_record_id');
 return a;
}
function observation(code,sharedKey,oneC,bitrix,field=null,left=null,right=null){
 return {code,sharedKey,sourceRecord1c:oneC?.sourceRecordId||null,
   sourceRecordBitrix24:bitrix?.sourceRecordId||null,field,
   value1c:left,valueBitrix24:right};
}
export function compareSourceRows(onec,bitrix){
 const a=normalizeSnapshotRows(onec),b=normalizeSnapshotRows(bitrix);
 const groups=new Map(),issues=[],counts={
  comparedPairs:0,fieldDifferences:0,missingFieldEvidence:0,unpairedRecords:0,
  ambiguousKeys:0,unmappedRecords:0
 };
 function push(source,records){
  for(const record of records){
   if(!record.sharedKey){
    issues.push(observation('unmapped_source_record',null,
      source==='1c'?record:null,source==='bitrix24'?record:null));
    counts.unmappedRecords++;continue;
   }
   if(!groups.has(record.sharedKey))groups.set(record.sharedKey,{'1c':[],'bitrix24':[]});
   groups.get(record.sharedKey)[source].push(record);
  }
 }
 push('1c',a);push('bitrix24',b);
 for(const sharedKey of [...groups.keys()].sort()){
  const pair=groups.get(sharedKey),l=pair['1c'],r=pair['bitrix24'];
  if(l.length>1||r.length>1){
   issues.push(observation('ambiguous_shared_key',sharedKey,l[0],r[0],
     null,l.map(x=>x.sourceRecordId),r.map(x=>x.sourceRecordId)));
   counts.ambiguousKeys++;continue;
  }
  if(!l.length||!r.length){
   issues.push(observation(l.length?'missing_in_bitrix24':'missing_in_1c',
     sharedKey,l[0],r[0]));counts.unpairedRecords++;continue;
  }
  counts.comparedPairs++;
  for(const field of fields){
   const left=l[0][field],right=r[0][field];
   if(left===null||right===null){
    if(left!==right){
     issues.push(observation('field_not_comparable',sharedKey,l[0],r[0],field,left,right));
     counts.missingFieldEvidence++;
    }
   }else if(left!==right){
    issues.push(observation('field_difference',sharedKey,l[0],r[0],field,left,right));
    counts.fieldDifferences++;
   }
  }
 }
 return {policyVersion:VERSION,counts,observations:issues,
  note:'Differences are evidence, not a decision about source authority. Original statuses are preserved and never mapped automatically.'};
}
const fromRow=r=>({
 sourceRecordId:r.source_record_id,sharedKey:r.shared_key,
 company:r.company,counterpartyType:r.counterparty_type,
 contactRef:r.contact_ref,ownerRef:r.owner_ref,originalStatus:r.original_status
});
export class PostgresSourceComparison {
 constructor({pool}={}){
  if(!pool?.connect||!pool?.query)throw Error('postgres_pool_required');
  this.pool=pool;
 }
 async transaction(work){
  const c=await this.pool.connect();
  try{
   await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
   await c.query("SET LOCAL lock_timeout='5s'");
   const output=await work(c);
   await c.query('COMMIT');return output;
  }catch(e){try{await c.query('ROLLBACK')}catch{}throw e}
  finally{c.release()}
 }
 async importSnapshot({tenantId,source,importKey,actorRef,rows}={}){
  required(tenantId,'tenant_id');required(actorRef,'actor_ref');
  if(!['1c','bitrix24'].includes(source))throw Error('unsupported_source');
  required(importKey,'import_key',160);
  const normalized=normalizeSnapshotRows(rows),digest=hash([source,normalized]);
  return this.transaction(async c=>{
   const snapshotId=randomUUID();
   const inserted=await c.query(`INSERT INTO sales_source_snapshots
    (tenant_id,snapshot_id,source,import_key,content_sha256,policy_version,record_count,actor_ref)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT(tenant_id,source,import_key) DO NOTHING
    RETURNING snapshot_id,created_at`,
    [tenantId,snapshotId,source,importKey,digest,VERSION,normalized.length,actorRef]);
   if(!inserted.rows.length){
    const old=await c.query(`SELECT snapshot_id,content_sha256,created_at,record_count
      FROM sales_source_snapshots WHERE tenant_id=$1 AND source=$2 AND import_key=$3`,
      [tenantId,source,importKey]);
    if(!old.rows.length||old.rows[0].content_sha256!==digest)
      throw Error('source_import_key_conflict');
    return {snapshotId:old.rows[0].snapshot_id,source,importKey,
      recordCount:old.rows[0].record_count,replayed:true,createdAt:old.rows[0].created_at};
   }
   for(const row of normalized){
    await c.query(`INSERT INTO sales_source_records
     (tenant_id,snapshot_id,source_record_id,shared_key,company,counterparty_type,
      contact_ref,owner_ref,original_status)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
     [tenantId,snapshotId,row.sourceRecordId,row.sharedKey,row.company,
       row.counterpartyType,row.contactRef,row.ownerRef,row.originalStatus]);
   }
   return {snapshotId,source,importKey,recordCount:normalized.length,
     replayed:false,createdAt:inserted.rows[0].created_at};
  });
 }
 async latest({tenantId}={}){
  required(tenantId,'tenant_id');
  const q=await this.pool.query(`SELECT DISTINCT ON(source)
    snapshot_id,source,import_key,record_count,created_at
    FROM sales_source_snapshots WHERE tenant_id=$1
    ORDER BY source,created_at DESC,snapshot_id DESC`,[tenantId]);
  return {sources:q.rows.map(r=>({snapshotId:r.snapshot_id,source:r.source,
    importKey:r.import_key,recordCount:r.record_count,createdAt:r.created_at}))};
 }
 async compareLatest({tenantId,actorRef}={}){
  required(tenantId,'tenant_id');required(actorRef,'actor_ref');
  return this.transaction(async c=>{
   const q=await c.query(`SELECT DISTINCT ON(source)
      snapshot_id,source,import_key,created_at
      FROM sales_source_snapshots WHERE tenant_id=$1
      ORDER BY source,created_at DESC,snapshot_id DESC`,[tenantId]);
   const a=q.rows.find(x=>x.source==='1c'),b=q.rows.find(x=>x.source==='bitrix24');
   if(!a||!b)throw Error('both_source_snapshots_required');
   const records=await c.query(`SELECT * FROM sales_source_records
     WHERE tenant_id=$1 AND snapshot_id=ANY($2::uuid[])`,
     [tenantId,[a.snapshot_id,b.snapshot_id]]);
   const content=compareSourceRows(
     records.rows.filter(r=>r.snapshot_id===a.snapshot_id).map(fromRow),
     records.rows.filter(r=>r.snapshot_id===b.snapshot_id).map(fromRow));
   const id=randomUUID(),insert=await c.query(`INSERT INTO sales_source_comparisons
     (tenant_id,comparison_id,onec_snapshot_id,bitrix_snapshot_id,policy_version,result_json,actor_ref)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)
     ON CONFLICT(tenant_id,onec_snapshot_id,bitrix_snapshot_id,policy_version) DO NOTHING
     RETURNING comparison_id,created_at`,
     [tenantId,id,a.snapshot_id,b.snapshot_id,VERSION,JSON.stringify(content),actorRef]);
   let comparisonId=id,createdAt=insert.rows[0]?.created_at,replayed=false;
   if(!insert.rows.length){
    const past=await c.query(`SELECT comparison_id,created_at,result_json
      FROM sales_source_comparisons WHERE tenant_id=$1 AND onec_snapshot_id=$2
       AND bitrix_snapshot_id=$3 AND policy_version=$4`,
      [tenantId,a.snapshot_id,b.snapshot_id,VERSION]);
    if(!past.rows.length)throw Error('comparison_race_conflict');
    comparisonId=past.rows[0].comparison_id;
    createdAt=past.rows[0].created_at;
    replayed=true;
   }
   return {comparisonId,createdAt,replayed,
     snapshots:{oneC:a.snapshot_id,bitrix24:b.snapshot_id},...content};
  });
 }
 async latestComparison({tenantId}={}){
  required(tenantId,'tenant_id');
  const q=await this.pool.query(`SELECT comparison_id,onec_snapshot_id,bitrix_snapshot_id,
    policy_version,result_json,created_at FROM sales_source_comparisons
    WHERE tenant_id=$1 ORDER BY created_at DESC,comparison_id DESC LIMIT 1`,[tenantId]);
  const r=q.rows[0];if(!r)return null;
  return {comparisonId:r.comparison_id,createdAt:r.created_at,policyVersion:r.policy_version,
    snapshots:{oneC:r.onec_snapshot_id,bitrix24:r.bitrix_snapshot_id},
    ...r.result_json};
 }
 async assess({tenantId,comparisonId,assessmentKey,actorRef,assessment,reason}={}){
  required(tenantId,'tenant_id');required(assessmentKey,'assessment_key',160);
  required(actorRef,'actor_ref');required(comparisonId,'comparison_id');
  if(!['requires_verification','acceptable_difference','investigate_mapping'].includes(assessment))
   throw Error('assessment_choice_invalid');
  required(reason,'assessment_reason',1000);
  if(reason.trim().length<10)throw Error('assessment_reason_too_short');
  return this.transaction(async c=>{
   const id=randomUUID(),r=await c.query(`INSERT INTO sales_source_assessments
    (tenant_id,assessment_id,comparison_id,assessment_key,actor_ref,assessment,reason)
    VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(tenant_id,comparison_id,assessment_key) DO NOTHING
    RETURNING assessment_id,created_at`,
    [tenantId,id,comparisonId,assessmentKey,actorRef,assessment,reason.trim()]);
   if(!r.rows.length){
    const old=await c.query(`SELECT assessment_id,created_at,actor_ref,assessment,reason
      FROM sales_source_assessments
      WHERE tenant_id=$1 AND comparison_id=$2 AND assessment_key=$3`,
      [tenantId,comparisonId,assessmentKey]);
    if(!old.rows.length||old.rows[0].assessment!==assessment||
      old.rows[0].reason!==reason.trim()||old.rows[0].actor_ref!==actorRef)
      throw Error('assessment_key_conflict');
    return {assessmentId:old.rows[0].assessment_id,replayed:true,createdAt:old.rows[0].created_at};
   }
   return {assessmentId:id,replayed:false,createdAt:r.rows[0].created_at};
  });
 }
 async assessments({tenantId,comparisonId}={}){
  required(tenantId,'tenant_id');required(comparisonId,'comparison_id');
  const q=await this.pool.query(`SELECT assessment_id,actor_ref,assessment,reason,created_at
   FROM sales_source_assessments WHERE tenant_id=$1 AND comparison_id=$2
   ORDER BY created_at,assessment_id`,[tenantId,comparisonId]);
  return q.rows.map(x=>({assessmentId:x.assessment_id,actorRef:x.actor_ref,
    assessment:x.assessment,reason:x.reason,createdAt:x.created_at}));
 }
}
