import {chromium} from 'playwright';
const base=process.env.BASE_URL||'http://127.0.0.1:8787';
const browser=await chromium.launch({headless:true});
const cases=[
 {name:'Two systems compare persisted snapshots',db:['1c','bitrix24'],source:'website',route:'pair'},
 {name:'One 1C source imports CSV without claiming a CRM connection',db:['1c'],source:'import',route:'onec'},
 {name:'Website origin tests an actual intake',db:['other'],source:'website',route:'enquiry'},
 {name:'Unsupported CRM leads to clearly labeled fictional example',db:['hubspot'],source:'crm',route:'example'}
];
try{
 for(const vp of [{width:390,height:844},{width:1280,height:900}]){
  const ctx=await browser.newContext({viewport:vp});
  for(const scenario of cases){
   const page=await ctx.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'/welcome',{waitUntil:'domcontentloaded'});
   await page.getByRole('heading',{name:'Where does your customer information live?'}).waitFor();
   const dims=await page.evaluate(()=>({
    body:getComputedStyle(document.body).backgroundColor,
    overflow:document.documentElement.scrollWidth>innerWidth
   }));
   if(dims.body!=='rgb(255, 255, 255)'||dims.overflow)
    throw Error('visual design responsive test failed: '+JSON.stringify({width:vp.width,...dims}));
   for(const x of scenario.db)await page.locator('.choice[data-value="'+x+'"]').click();
   await page.locator('#next').click();
   await page.getByRole('heading',{name:'Where do your new enquiries arrive?'}).waitFor();
   await page.locator('.choice[data-value="'+scenario.source+'"]').click();
   await page.locator('#next').click();
   await page.getByText('Step 3 of 3',{exact:false}).waitFor();
   if(scenario.route==='pair'){
    await page.getByRole('heading',{name:'Import your 1C and Bitrix24 exports'}).waitFor();
    await page.getByRole('button',{name:'Try with fictional examples'}).click();
    await page.getByRole('heading',{name:'Comparison saved to PostgreSQL'}).waitFor({timeout:20000});
    await page.getByText(/findings · /).waitFor();
   }else if(scenario.route==='onec'){
    await page.getByRole('heading',{name:'Start with your 1C customer export'}).waitFor();
    const csv=['sourceRecordId;sharedKey;company;counterpartyType;contactRef;ownerRef;originalStatus',
      '1C-wizard-78;record-78;Sample North;OOO;ref-1;owner-1;Active'].join('\r\n');
    await page.locator('#file-1c').setInputFiles({
      name:'customers.csv',mimeType:'text/csv',buffer:Buffer.from(csv,'utf8')
    });
    await page.getByText('1 records ready.').waitFor();
    await page.locator('#next').click();
    await page.getByRole('heading',{name:'First source connected through CSV'}).waitFor({timeout:15000});
    await page.getByText('1 records stored in PostgreSQL').waitFor();
   }else if(scenario.route==='enquiry'){
    await page.getByRole('heading',{name:'Test an incoming enquiry'}).waitFor();
    await page.locator('#customer-name').fill('Sam Lee');
    await page.locator('#customer-email').fill('sam@example.com');
    await page.locator('#next').click();
    await page.getByRole('heading',{name:'Enquiry saved to PostgreSQL'}).waitFor({timeout:15000});
    await page.getByText(/possible existing matches/).waitFor();
   }else if(scenario.route==='example'){
    await page.getByText('This CRM does not yet have a live connector.').waitFor();
    await page.locator('#next').click();
    await page.getByRole('heading',{name:'Comparison saved to PostgreSQL'}).waitFor({timeout:15000});
   }
   const resultDims=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
   if(resultDims)throw Error('Mobile horizontal overflow after result '+scenario.name);
   if(errors.length)throw Error('Browser errors in '+scenario.name+': '+errors.join(' | '));
   console.log('PASS onboarding '+vp.width+'px: '+scenario.name);
   await page.close();
  }
  await ctx.close();
 }
}finally{await browser.close()}
