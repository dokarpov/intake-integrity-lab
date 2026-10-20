import { chromium } from 'playwright';

const base=process.env.BASE_URL||'http://127.0.0.1:4173';
const viewports=[
  {name:'mobile-320',width:320,height:700},
  {name:'mobile-390',width:390,height:844},
  {name:'tablet',width:768,height:1024},
  {name:'desktop',width:1440,height:1000}
];

const browser=await chromium.launch({headless:true});
for(const vp of viewports){
  const context=await browser.newContext({viewport:{width:vp.width,height:vp.height}});
  const page=await context.newPage();
  const errors=[]; page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(base+'/demo/',{waitUntil:'networkidle'});
  await page.waitForTimeout(250);

  const layout=await page.evaluate(()=>({
    title:document.title,
    scrollWidth:document.documentElement.scrollWidth,
    viewport:innerWidth,
    brand:document.querySelector('.brand')?.textContent || '',
    active:document.querySelector('.view.active')?.id,
    navCount:document.querySelectorAll('.nav button').length
  }));
  if(layout.title!=='Intake Integrity · Control plane') throw new Error(vp.name+': title missing');
  if(!layout.brand.includes('Intake Integrity')||!layout.brand.includes('Sales intake')) throw new Error(vp.name+': operator branding missing');
  if(layout.scrollWidth>layout.viewport+2) throw new Error(vp.name+': horizontal overflow '+layout.scrollWidth+'>'+layout.viewport);
  if(layout.active!=='overview') throw new Error(vp.name+': overview not active');
  if(layout.navCount<7) throw new Error(vp.name+': operator navigation incomplete');

  await page.locator('[data-view="review"]').click();
  if(await page.locator('#review').getAttribute('class')!=='view active') throw new Error(vp.name+': review navigation failed');

  await page.locator('[data-view="controls"]').click();
  if(await page.locator('#controls').getAttribute('class')!=='view active') throw new Error(vp.name+': controls navigation failed');

  if(errors.length) throw new Error(vp.name+': '+errors.join(' | '));
  console.log('PASS',vp.name);
  await context.close();
}
await browser.close();
