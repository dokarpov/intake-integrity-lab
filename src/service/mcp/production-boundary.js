const SOURCE_TABLES=[
 'sales_source_snapshots','sales_source_records',
 'sales_source_comparisons','sales_source_assessments'
];
// The MCP role must never inherit the import, assessment or migration grants.
// RLS still filters by verified tenant in PostgresSourceComparison.transaction().
export async function assertMcpReadOnlyDatabaseBoundary({pool}={}){
 if(typeof pool?.query!=='function')throw Error('mcp_readonly_database_required');
 let role,tables;
 try{
  role=await pool.query(`SELECT rolsuper,rolbypassrls,rolcreaterole FROM pg_roles
   WHERE rolname=current_user`);
  tables=await pool.query(`SELECT c.relname AS name,c.relrowsecurity AS rls,
    c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owns_table,
    has_table_privilege(current_user,c.oid,'SELECT') AS can_select,
    has_table_privilege(current_user,c.oid,'INSERT') AS can_insert,
    has_table_privilege(current_user,c.oid,'UPDATE') AS can_update,
    has_table_privilege(current_user,c.oid,'DELETE') AS can_delete
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind='r'
     AND c.relname=ANY($1::text[])`,[SOURCE_TABLES]);
 }catch{throw Error('mcp_database_preflight_unavailable')}
 const r=role.rows?.[0];
 if(!r||r.rolsuper||r.rolbypassrls||r.rolcreaterole)
  throw Error('mcp_database_privileged_role_forbidden');
 if(tables.rows?.length!==SOURCE_TABLES.length||
    SOURCE_TABLES.some(name=>!tables.rows.some(t=>t.name===name&&
      t.rls===true&&t.owns_table===false&&t.can_select===true&&
      t.can_insert===false&&t.can_update===false&&t.can_delete===false)))
  throw Error('mcp_database_rls_or_grants_unsafe');
 return {ok:true,readOnly:true,tenantRls:true,tableCount:SOURCE_TABLES.length};
}
