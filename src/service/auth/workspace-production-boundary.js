// Production must not boot under the schema owner, a privileged role or an
// obsolete subject-only workspace table. This is a narrow identity boundary
// check, NOT proof that all other tenant tables have complete RLS policies.
const bindingKey='PRIMARY KEY (tenant_id, issuer, subject_id)';
export async function assertProductionWorkspaceBoundary({pool}={}){
 if(typeof pool?.query!=='function')throw new Error('production_workspace_database_required');
 let result;
 try{
  result=await pool.query(`SELECT
    r.rolsuper AS superuser,r.rolbypassrls AS bypass_rls,
    r.rolcreaterole AS can_create_role,
    c.relowner=r.oid AS owns_directory,
    has_table_privilege(current_user,c.oid,'SELECT') AS can_read,
    has_table_privilege(current_user,c.oid,'INSERT') AS can_insert,
    has_table_privilege(current_user,c.oid,'UPDATE') AS can_update,
    has_table_privilege(current_user,c.oid,'DELETE') AS can_delete,
    EXISTS(SELECT 1 FROM pg_attribute a
      WHERE a.attrelid=c.oid AND a.attname='issuer' AND NOT a.attisdropped
        AND a.attnotnull) AS issuer_present,
    (SELECT pg_get_constraintdef(p.oid) FROM pg_constraint p
     WHERE p.conrelid=c.oid AND p.contype='p') AS primary_key
   FROM pg_roles r
   JOIN pg_class c ON c.oid=to_regclass('public.intake_workspace_memberships')
   WHERE r.rolname=current_user`);
 }catch{throw new Error('production_workspace_preflight_unavailable')}
 const x=result.rows?.[0];
 if(!x||!x.can_read||x.superuser||x.bypass_rls||x.can_create_role||
    x.owns_directory||x.can_insert||x.can_update||x.can_delete)
  throw new Error('production_workspace_database_role_unsafe');
 if(x.issuer_present!==true||x.primary_key!==bindingKey)
  throw new Error('production_workspace_issuer_migration_required');
 return {ok:true,issuerBound:true,restrictedDirectoryRole:true};
}
