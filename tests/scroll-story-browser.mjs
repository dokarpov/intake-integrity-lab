import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const base=process.env.BASE_URL||'http://127.0.0.1:8787';
const viewports=[
 {width:320,height:568},{width:375,height:667},
 {width:390,height:844},{width:430,height:932},
 {width:768,height:1024},{width:1024,height:768},{width:1440,height:900}
];
const browser=await chromium.launch({headless:true});
try{
 for(const vp of viewports){
  const context=await browser.newContext({viewport:vp,deviceScaleFactor:1});
  const page=await context.newPage(),errors=[],unexpectedFetches=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',req=>{if(/\/api\//.test(req.url()))unexpectedFetches.push(req.url())});
  await page.goto(base+'/testing/story',{waitUntil:'domcontentloaded'});
  await page.getByText('The right customer. The right history. One safe handoff.').waitFor();
  const before=await page.evaluate(()=>{
   const q=s=>document.querySelector(s),scene=q('.story-sticky');
   const css=getComputedStyle(scene),body=getComputedStyle(document.body);
   const phone=getComputedStyle(q('.story-phone')).display!=='none';
   const desktop=getComputedStyle(q('.story-desktop')).display!=='none';
   const visible=q(phone?'.story-phone':'.story-desktop'),frame=visible.getBoundingClientRect();
   const copy=q('[data-copy="0"]').getBoundingClientRect();
   return {
    phone,desktop,sticky:css.position,
    bg:body.backgroundColor,overflowX:document.documentElement.scrollWidth>window.innerWidth,
    scrollable:document.documentElement.scrollHeight>window.innerHeight*3,
    nestedScroll:[q('.story-sticky'),q('.story-viewport'),q('.story-phone'),q('.story-desktop')].some(e=>['auto','scroll'].includes(getComputedStyle(e).overflowY)),
    frame:{width:frame.width,height:frame.height},
    mockControls:visible.querySelectorAll('button,input,select,textarea,a').length,
    copyFits:copy.bottom<=scene.getBoundingClientRect().bottom+2 && copy.top>=scene.getBoundingClientRect().top-2
   };
  });
  const phoneExpected=vp.width<=800;
  assert.equal(before.phone,phoneExpected,'Wrong device-specific mockup at '+vp.width);
  assert.equal(before.desktop,!phoneExpected,'Wrong desktop mockup at '+vp.width);
  assert.equal(before.sticky,'sticky');
  assert.equal(before.bg,'rgb(255, 255, 255)');
  assert.equal(before.overflowX,false,'Unexpected horizontal overflow at '+vp.width);
  assert.equal(before.nestedScroll,false,'Inner scroll found at '+vp.width);
  assert.equal(before.scrollable,true,'No scroll-driving story');
  assert.equal(before.mockControls,0,'Illustration has fake clickable controls');
  assert.ok(before.frame.width>130 && before.frame.height>250,'Mockup not adequately visible '+JSON.stringify(before.frame));
  assert.equal(before.copyFits,true,'Copy escapes sticky viewport '+vp.width);
  // Exactly one document scroll: progress forward, then reverse to first state.
  for(const [p,expected] of [[0,0],[.34,1],[.62,2],[.97,3],[0,0]]){
   await page.evaluate(v=>{
    const s=document.querySelector('#story');
    const scrollDistance=s.offsetHeight-innerHeight;
    window.scrollTo({top:s.offsetTop+v*scrollDistance,behavior:'instant'});
   },p);
   await page.waitForFunction(({num})=>document.querySelector('#story-count').textContent.startsWith(String(num+1).padStart(2,'0')),{num:expected},{timeout:8000});
   // Motion uses scroll damping and must settle without bouncing or clipping the device.
   await page.waitForTimeout(410);
   const check=await page.evaluate((n)=>{
    const visible=getComputedStyle(document.querySelector('.story-phone')).display!=='none'
       ?document.querySelector('.story-phone'):document.querySelector('.story-desktop');
    const opacity=Number(getComputedStyle(visible.querySelector('[data-layer="'+n+'"]')).opacity);
    const textOpacity=Number(getComputedStyle(document.querySelector('[data-copy="'+n+'"]')).opacity);
    const frame=visible.getBoundingClientRect();
    const wrongWidth=document.documentElement.scrollWidth>innerWidth;
    return {opacity,textOpacity,width:frame.width,height:frame.height,wrongWidth};
   },expected);
   assert.ok(check.opacity>=.75 && check.textOpacity>=.75,'Wrong stage displayed at '+vp.width+' p='+p+': '+JSON.stringify(check));
   assert.ok(Math.abs(check.width-before.frame.width)<2&&Math.abs(check.height-before.frame.height)<2,'Mockup resized during scroll');
   assert.equal(check.wrongWidth,false,'Horizontal overflow mid-story');
  }
  assert.deepEqual(errors,[],'Page script errors');
  assert.deepEqual(unexpectedFetches,[],'Visual demo should not request user/customer data');
  await context.close();
  console.log('PASS scroll-story desktop/mobile '+vp.width+'x'+vp.height+' · reverse motion and zero inner scrolling');
 }
 // Respect reduced motion: no animated catch-up and full narrative remains accessible.
 const reduced=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
 const page=await reduced.newPage();
 await page.goto(base+'/testing/story',{waitUntil:'domcontentloaded'});
 await page.evaluate(()=>{
  const s=document.querySelector('#story');window.scrollTo({top:s.offsetTop+.98*(s.offsetHeight-innerHeight),behavior:'instant'})
 });
 await page.waitForFunction(()=>document.querySelector('#story-count').textContent.startsWith('04'),null,{timeout:5000});
 assert.equal(await page.locator('section[aria-label="Accessible transcript"] li').count(),4);
 console.log('PASS reduced motion and complete accessible transcript');
 await reduced.close();
}finally{await browser.close()}
