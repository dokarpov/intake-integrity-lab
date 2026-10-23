import assert from 'node:assert/strict';

const base=process.env.BASE_URL||'http://127.0.0.1:8788';
for(let attempt=0;attempt<40;attempt++){
 try{const r=await fetch(base+'/healthz');if(r.ok)break;}
 catch{}
 if(attempt===39)throw Error('staging_safety_service_not_ready');
 await new Promise(resolve=>setTimeout(resolve,250));
}
const routes=[
 '/api/integrity/sources/snapshots',
 '/api/integrity/intakes',
 '/api/intakes',
 '/api/integrity/sources/assessments',
 '/api/integrity/sandbox/evidence',
 '/api/integrity/sandbox/crm/run',
 '/api/reviews/fake/resolve',
 '/api/workspaces/registration'
];
for(const path of routes){
 const response=await fetch(base+path,{method:'POST',
  headers:{'content-type':'application/json','x-dev-user':'example-reviewer',
  'x-dev-tenant':'staging-demo','x-dev-roles':'sales,reviewer,integration_admin'},
  body:JSON.stringify({source:'external',sourceEventKey:'external-1',
   displayName:'Unapproved person',identifier:{kind:'email',value:'real-person@example.test'},
   rows:[{company:'Arbitrary Customer Company',sharedKey:'123',sourceRecordId:'1'}]})});
 assert.equal(response.status,423,path+' must be denied at HTTP ingress');
 const json=await response.json();
 assert.equal(json.error.code,'staging_synthetic_only',path);
}
for(const method of ['PUT','PATCH','DELETE']){
 const response=await fetch(base+'/api/integrity/sources/snapshots',{method});
 assert.equal(response.status,423,method);
}
const read=await fetch(base+'/healthz');assert.equal(read.status,200);
console.log('PASS shared staging rejects arbitrary writes at real HTTP entrypoint');
