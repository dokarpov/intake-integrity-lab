// Only server-owned AWS Secrets Manager paths are permitted. Secrets never go
// to the browser, AI connectors, SQL, responses or telemetry.
const keyPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid=code=>Object.assign(new Error(code),{code});
export class AwsSourceConnectionVault {
 constructor({client,commandCtor,prefix='intake-integrity/source-sync'}={}){
  if(typeof client?.send!=='function'||typeof commandCtor!=='function')
   throw invalid('source_vault_client_required');
  if(!/^[a-zA-Z0-9/_-]{1,160}$/.test(prefix))throw invalid('source_vault_prefix_invalid');
  Object.assign(this,{client,commandCtor,prefix});
 }
 static async fromEnvironment({region=process.env.AWS_REGION}={}){
  if(!region)throw invalid('source_vault_region_required');
  const {SecretsManagerClient,GetSecretValueCommand}=
   await import('@aws-sdk/client-secrets-manager');
  return new AwsSourceConnectionVault({
   client:new SecretsManagerClient({region}),commandCtor:GetSecretValueCommand
  });
 }
 async getApproved(tenantId){
  if(typeof tenantId!=='string'||!keyPattern.test(tenantId))
   throw invalid('source_vault_tenant_invalid');
  let result;
  try{
   result=await this.client.send(new this.commandCtor({
    SecretId:this.prefix+'/'+tenantId+'/read-only-pair'
   }));
  }catch{throw invalid('source_vault_unavailable')}
  let value;
  try{
   if(typeof result?.SecretString!=='string'||result.SecretString.length>20000)
    throw Error('invalid');
   value=JSON.parse(result.SecretString);
  }catch{throw invalid('source_vault_config_invalid')}
  const now=Date.now();
  if(value?.tenantId!==tenantId||value.permissionGranted!==true||
    value.purpose!=='read_only_discrepancy_evidence'||value.revoked===true||
    !/^[0-9a-f-]{36}$/i.test(value.grantId||'')||
    !/^mapping-[a-zA-Z0-9._-]{1,80}$/.test(value.mappingVersion||'')||
    !Number.isFinite(Date.parse(value.expiresAt))||
    new Date(value.expiresAt).getTime()<=now||
    !value.sources?.['1c']||!value.sources?.bitrix24)
   throw invalid('source_sync_grant_revoked');
  for(const source of ['1c','bitrix24']){
   const item=value.sources[source];
   if(item.mapping?.source!==source||
      !Array.isArray(item.connection?.allowHosts)||
      item.connection.allowHosts.length<1)
    throw invalid('source_vault_config_invalid');
  }
  return value;
 }
}
