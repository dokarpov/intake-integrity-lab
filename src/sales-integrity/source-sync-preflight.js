// Separate API and worker DB roles. Neither may own customer evidence, bypass
// RLS or make arbitrary SQL changes. Per-transaction verified tenant context is
// still required; DB role checks alone do not grant access.
const tables=['sales_source_sync_runs','sales_source_sync_staging','sales_source_sync_pages',
 'sales_source_sync_findings','sales_source_snapshots','sales_source_records'];
const invalid=x=>{throw Error(x)};
export async function assertSourceSyncDbRole({pool,role}={}){
 if(!pool?.query||!['api','worker'].includes(role))invalid('source_sync_preflight_invalid');
 let q,p;
 try{
  q=await pool.query(`SELECT rolsuper,rolbypassrls,rolcreaterole FROM pg_roles
   WHERE rolname=current_user`);
  p=await pool.query(`SELECT c.relname AS name,c.relrowsecurity AS rls,
    c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owns_table,
    has_table_privilege(current_user,c.oid,'SELECT') AS can_select,
    has_table_privilege(current_user,c.oid,'INSERT') AS can_insert,
    has_table_privilege(current_user,c.oid,'UPDATE') AS can_update,
    has_table_privilege(current_user,c.oid,'DELETE') AS can_delete
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind='r'
    AND c.relname=ANY($1::text[])`,[tables]);
 }catch{invalid('source_sync_preflight_unavailable')}
 const r=q.rows[0];
 if(!r||r.rolsuper||r.rolbypassrls||r.rolcreaterole)
  invalid('source_sync_privileged_role_forbidden');
 const rows=p.rows||[];
 if(rows.length!==tables.length||rows.some(x=>!x.rls||x.owns_table||
   !x.can_select||x.can_delete))
  invalid('source_sync_table_rls_unsafe');
 if(role==='api'){
  const queue=rows.find(x=>x.name==='sales_source_sync_runs');
  if(!queue.can_insert||queue.can_update||rows.some(x=>x.name!==queue.name&&
    (x.can_insert||x.can_update)))
   invalid('source_sync_api_db_grants_unsafe');
 }
 if(role==='worker'){
  const wanted=new Set(tables);
  if(rows.some(x=>wanted.has(x.name)&&!x.can_insert)||
   !rows.find(x=>x.name==='sales_source_sync_runs')?.can_update||
   rows.some(x=>x.name!=='sales_source_sync_runs'&&x.can_update))
   invalid('source_sync_worker_db_grants_unsafe');
 }
 return {ok:true,role,tenantRls:true};
}
