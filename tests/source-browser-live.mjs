import {chromium} from 'playwright';
const base=process.env.BASE_URL||'http://127.0.0.1:8787';
const browser=await chromium.launch({headless:true});
try{
 for(const vp of [{width:390,height:844},{width:1280,height:900}]){
  const ctx=await browser.newContext({viewport:vp});
  const page=await ctx.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/sources',{waitUntil:'domcontentloaded'});
  await page.getByText('Connected:',{exact:false}).first().waitFor({timeout:12000});
  const dims=await page.evaluate(()=>({white:getComputedStyle(document.body).backgroundColor,
    overflow:document.documentElement.scrollWidth>innerWidth}));
  if(dims.white!=='rgb(255, 255, 255)'||dims.overflow)
   throw Error('Responsive layout failed '+vp.width+' '+JSON.stringify(dims));
  await page.getByRole('button',{name:'Load two fictional exports and compare'}).click();
  await page.getByText('What differs between these sources?').waitFor({timeout:16000});
  await page.getByText('Different values').first().waitFor();
  await page.getByText('Ambiguous mapping').first().waitFor();
  await page.getByText('No verified cross-system key').first().waitFor();
  const summary=await page.locator('#summary').innerText();
  if(!summary.includes('Field differences')||!summary.includes('Unpaired records'))
   throw Error('Missing source-specific findings in persisted comparison');
  await page.locator('#review-area').evaluate(el=>el.open=true);
  await page.locator('#reason').fill('Verify counterparty type with original signed company documentation.');
  await page.getByRole('button',{name:'Record assessment'}).click();
  await page.getByText('Assessment saved in PostgreSQL.').waitFor({timeout:12000});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByText('What differs between these sources?').waitFor({timeout:12000});
  await page.locator('#review-area').evaluate(el=>el.open=true);
  await page.getByText('Verify counterparty type with original signed company documentation.').waitFor({timeout:12000});
  if(errors.length)throw Error(errors.join(' | '));
  console.log('PASS 1C and Bitrix24 CSV comparison, PostgreSQL persistence and reviewer assessment at '+vp.width+'px');
  await ctx.close();
 }
}finally{await browser.close()}
