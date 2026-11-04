import {chromium} from 'playwright';
import {Pool} from 'pg';

const base=process.env.BASE_URL||'http://127.0.0.1:8787';
const browser=await chromium.launch({headless:true});
const sql=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,max:2}):null;
try{
 for(const vp of [{width:390,height:844},{width:1280,height:900}]){
   const context=await browser.newContext({viewport:vp});
   const page=await context.newPage(),errors=[];
   page.on('pageerror',x=>errors.push(x.message));
   await page.goto(base+'/integrity',{waitUntil:'domcontentloaded'});
   await page.getByText('Connected to API').waitFor({timeout:12000});
   const layout=await page.evaluate(()=>({
     body:getComputedStyle(document.body).backgroundColor,
     overflow:document.documentElement.scrollWidth>innerWidth
   }));
   if(layout.body!=='rgb(255, 255, 255)'||layout.overflow)
     throw new Error('white responsive layout failed at '+vp.width+' '+JSON.stringify(layout));
   const sourceKey='browser-'+crypto.randomUUID();
   await page.locator('#source-key').fill(sourceKey);
   await page.locator('#customer-name').fill('Sam Lee');
   await page.locator('#customer-email').fill('sam@example.com');
   await page.getByRole('button',{name:'Submit to PostgreSQL'}).click();
   await page.waitForFunction(() => document.querySelector('#response-json')?.textContent?.includes('candidateCount'),null,{timeout:12000});
   const resp=JSON.parse(await page.locator('#response-json').innerText());
   if(resp.candidateCount!==2||resp.replayed!==false)throw new Error('Expected two candidates, got '+JSON.stringify(resp));
   await page.locator('#candidates').getByText('Sam Lee · Studio North').waitFor({timeout:12000});
   await page.locator('#candidates').getByText('Sam Lee · Studio South').waitFor({timeout:12000});
   await page.locator('#audit-list').getByText(/intake\.received/).waitFor({timeout:12000});
   await page.locator('#audit-list').getByText(/identity\.candidates_evaluated/).waitFor({timeout:12000});
   await page.reload();
   await page.getByText('Connected to API').waitFor({timeout:12000});
   await page.locator('#record-list .line-button').filter({hasText:'Sam Lee'}).first().click();
   await page.locator('#detail-fields').getByText(sourceKey).waitFor({timeout:12000});
   await page.locator('#delivery-state').getByText('No CRM delivery authorized or queued.').waitFor({timeout:12000});
   await page.locator('#decision-panel').waitFor({timeout:12000});
   await page.locator('#review-action').selectOption('link_existing');
   await page.locator('#review-person').selectOption({label:'Sam Lee · Studio North'});
   await page.locator('#review-reason').fill('Fictional callback confirms Studio North for this sandbox enquiry.');
   await page.locator('#simulate-identity').check();
   await page.locator('#simulate-consent').check();
   const apiFailures=[];
   page.on('response',async response=>{
     if(response.status>=400&&response.url().includes('/api/')){
       const error=(await response.json().catch(()=>null))?.error;
       apiFailures.push({path:new URL(response.url()).pathname,status:response.status,code:error?.code,message:error?.message});
     }
   });
   await page.getByRole('button',{name:'Record my decision in PostgreSQL'}).click();
   try{
     await page.locator('#detail-fields').getByText('link_existing').waitFor({timeout:7000});
   }catch(e){
     throw new Error('Decision not persisted: '+JSON.stringify({
       uiMessage:await page.locator('#decision-message').textContent(),
       apiFailures,detail:await page.locator('#detail-fields').innerText()
     }));
   }
   await page.locator('#delivery-state').getByText(/pending/).waitFor({timeout:12000});
   await page.locator('#audit-list').getByText(/intake.decision_recorded/).waitFor({timeout:12000});
   await page.getByRole('button',{name:'Simulate lost acknowledgement'}).click();
   await page.locator('#delivery-state').getByText(/needs_reconciliation/).waitFor({timeout:12000});
   await page.getByRole('button',{name:'Reconcile with provider'}).click();
   await page.locator('#delivery-state').getByText(/succeeded/).waitFor({timeout:12000});
   await page.reload();
   await page.getByText('Connected to API').waitFor({timeout:12000});
   await page.locator('#record-list .line-button').filter({hasText:'Sam Lee'}).first().click();
   await page.locator('#detail-fields').getByText('link_existing').waitFor({timeout:12000});
   await page.locator('#delivery-state').getByText(/succeeded/).waitFor({timeout:12000});
   // This is a real DB assertion, not just the UI state. It proves a single
   // human decision, a single transactional outbox, and one simulator receipt.
   if(sql){
     const q=await sql.query(`
       SELECT e.processing_state, o.state AS outbox_state,
         count(DISTINCT d.decision_id)::int AS decisions,
         count(DISTINCT o.outbox_id)::int AS outboxes,
         count(DISTINCT s.receipt_ref)::int AS provider_receipts
       FROM sales_incoming_enquiries e
       LEFT JOIN sales_intake_decisions d
         ON d.tenant_id=e.tenant_id AND d.intake_id=e.intake_id
       LEFT JOIN sales_crm_outbox_v2 o
         ON o.tenant_id=e.tenant_id AND o.intake_id=e.intake_id
       LEFT JOIN sandbox_crm_deliveries s
         ON s.tenant_id=o.tenant_id AND s.operation_key=o.operation_key
       WHERE e.tenant_id='staging-demo' AND e.source_event_key=$1
       GROUP BY e.processing_state,o.state
     `,[sourceKey]);
     const row=q.rows[0];
     if(q.rowCount!==1||row.processing_state!=='resolved'||
       row.outbox_state!=='succeeded'||row.decisions!==1||
       row.outboxes!==1||row.provider_receipts!==1)
       throw new Error('Transactional backend E2E invariant failed: '+JSON.stringify(q.rows));
     console.log('PASS persisted exactly one audited decision, outbox, and CRM simulator receipt for '+sourceKey);
   }
   if(errors.length)throw new Error('Browser errors: '+errors.join(' | '));
   console.log('PASS real PostgreSQL browser intake at '+vp.width+'px');
   await context.close();
 }
}finally{await browser.close();await sql?.end()}
