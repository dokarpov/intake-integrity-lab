import {Pool} from 'pg';
import {PostgresSalesIntegrity} from '../src/sales-integrity/postgres-integrity.js';

if(process.env.STAGING_FIXTURES!=='true')throw new Error('fixtures_flag_required');
if(process.env.NODE_ENV==='production')throw new Error('fixtures_forbidden_in_production_runtime');
if(!process.env.DATABASE_URL||!process.env.INTEGRITY_FINGERPRINT_HMAC_SECRET)
  throw new Error('database_and_fingerprint_secret_required');
const tenant='staging-demo';
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:6000});
const service=new PostgresSalesIntegrity({pool,fingerprintSecret:process.env.INTEGRITY_FINGERPRINT_HMAC_SECRET});
const samples=[
  {name:'Sam Lee · Studio North',email:'sam@example.com',ref:'demo-crm-north'},
  {name:'Sam Lee · Studio South',email:'sam@example.com',ref:'demo-crm-south'},
  {name:'Nora Chen · Example Labs',email:'nora@example.com',ref:'demo-crm-nora'}
];
try{
  for(const x of samples){
    const fingerprint=service.fingerprint(tenant,'email',x.email);
    const present=await pool.query(`SELECT 1 FROM sales_person_identifiers i
      JOIN sales_identity_people p ON p.tenant_id=i.tenant_id AND p.person_id=i.person_id
      WHERE i.tenant_id=$1 AND i.fingerprint=$2 AND i.source_ref=$3 LIMIT 1`,
      [tenant,fingerprint,x.ref]);
    if(present.rows.length){process.stdout.write('Existing fictional person: '+x.ref+'\n');continue}
    await service.registerPerson({tenantId:tenant,name:x.name,kind:'email',
      value:x.email,sourceRef:x.ref,evidenceRef:'fictional-fixture',actorId:'staging-setup'});
    process.stdout.write('Created fictional person: '+x.ref+'\n');
  }
  process.stdout.write('Staging fixtures ready; no real customer data loaded.\n');
}finally{await pool.end()}
