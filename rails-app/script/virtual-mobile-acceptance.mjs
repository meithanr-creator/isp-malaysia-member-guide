// Dedicated software acceptance browsers; never attach to a user's browser profile.
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const ROOT='D:/Projects/isp-member-rails',PRIVATE='D:/Projects/isp-rails-tools/isp-staging-private';
const ORIGIN='https://isp-member-production.meithan-r.workers.dev';
process.env.PLAYWRIGHT_BROWSERS_PATH='D:/Projects/isp-rails-tools/virtual-browsers';
const require=createRequire('D:/Projects/isp-rails-tools/virtual-browser-tools/package.json');
const {chromium,webkit,devices}=require('playwright');
const report={version:1,scope:'Virtual browser engines and mobile profiles; no physical-device or native installation claim',started_at:new Date().toISOString(),profiles:[]};
const save=()=>fs.writeFileSync(`${ROOT}/audit/virtual-mobile-acceptance.json`,JSON.stringify(report,null,2));
const assert=(value,message)=>{if(!value)throw new Error(message)};
const read=name=>JSON.parse(fs.readFileSync(`${PRIVATE}/${name}`,'utf8'));
async function main(){
 if(process.argv[2]!=='--execute')throw new Error('Explicit --execute required');if(require('playwright/package.json').version!=='1.64.1')throw new Error('Reviewed browser tool version required');
 const runtime=read('runtime.json'),fixtures=read('acceptance-fixtures.json'),release=read('acceptance-release.json'); report.release={worker_source:release.worker_source,worker_version:release.worker_version,rails_source:release.rails_source,image_digest:release.image_digest}; report.run_marker=fixtures.run_marker;
 const deadline=Date.parse(runtime.ISP_STAGING_EXPIRES_AT)-10*60000;
 assert(runtime.APP_HOST===new URL(ORIGIN).host&&/^[a-f0-9]{64}$/.test(runtime.ISP_STAGING_KEY),'Private runtime missing');
 assert(Number.isFinite(deadline)&&Date.now()<deadline,'Acceptance window unavailable');
 assert(fixtures.phase==='active'&&fixtures.target?.project==='royal-glitter-45740959'&&fixtures.target?.host==='ep-delicate-frost-a1o15wrb.ap-southeast-1.aws.neon.tech'&&fixtures.target?.database==='neondb'&&fixtures.actors.member_b&&/^qa-\d{8}-[a-f0-9]{12}$/.test(fixtures.run_marker),'Controlled active fixture required'); assert(/^[a-f0-9]{40}$/.test(release.worker_source)&&/^[a-f0-9-]{36}$/.test(release.worker_version)&&release.rails_source==='c9a5142bd8c949c6415c3639c0113ee015f9a3f4'&&release.image_digest==='sha256:0187a1e32351a3f7a8f9c87a48798c0adf31f3b6c4116309c78f638582700cd2','Exact release metadata required');
 for(const [name,engine,profile] of [['iphone-webkit',webkit,'iPhone 13'],['android-chromium',chromium,'Pixel 7']]){
  const result={name,profile,engine:name.includes('webkit')?'WebKit':'Chromium',checks:[],screenshots:[],errors:[],requests:0};report.profiles.push(result);save();
  const browser=await engine.launch({headless:true});
  result.engine_version=browser.version();const context=await browser.newContext({...devices[profile],reducedMotion:'reduce'});
  result.viewport=devices[profile].viewport;result.touch=devices[profile].hasTouch;
  let deadlineHit=false; const stopTimer=setTimeout(()=>{deadlineHit=true;void context.close().catch(()=>{});},Math.max(1,deadline-Date.now())); const page=await context.newPage();page.setDefaultTimeout(12000);page.setDefaultNavigationTimeout(20000); const admit=()=>assert(!deadlineHit&&Date.now()<deadline&&result.requests<180,'Bounded mobile admission refused'); const api=async(method,url,options={})=>{admit();result.requests++;return context.request[method](url,{...options,timeout:Math.min(20000,deadline-Date.now())});};
  const check=(ok,label)=>{assert(ok,label);result.checks.push(label)};
  context.on('request',()=>{result.requests++;}); await context.route('**/*',route=>Date.now()>=deadline||result.requests>180?route.abort():route.continue());
  page.on('pageerror',()=>result.errors.push('Application JavaScript error'));
  try{
   const form=await api('get',`${ORIGIN}/__isp_review`);check(form.status()===200&&(await form.text()).includes('Review access code'),'Private review form loads');
   const opened=await api('post',`${ORIGIN}/__isp_review`,{headers:{Origin:ORIGIN},form:{access_key:runtime.ISP_STAGING_KEY},maxRedirects:0});
   check(opened.status()===303,'Same-origin review entry accepted');
   const cookies=await context.cookies(ORIGIN),gate=cookies.find(c=>c.name==='__Host-isp_acceptance');
   check(gate&&gate.secure&&gate.httpOnly&&gate.sameSite==='Strict'&&!gate.value.includes(runtime.ISP_STAGING_KEY)&&gate.expires*1000<=Date.parse(runtime.ISP_STAGING_EXPIRES_AT)+1000,'Browser accepts secure fixed-expiry cookie without raw key');
   admit();result.requests++;const readiness=await context.request.get(ORIGIN+'/ready',{headers:{'x-isp-staging-key':runtime.ISP_STAGING_KEY},timeout:Math.min(120000,deadline-Date.now())});check(readiness.status()===200,'Bounded scanner and Rails readiness before navigation');
   const home=await page.goto(ORIGIN);check(home.status()===200,'Landing page loads in actual engine');
   await page.locator('.welcome-hero').waitFor();await page.evaluate(()=>document.fonts.ready);
   check((await page.locator('img[alt="Official ISP crest"]').count())===1,'Official crest present');
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Landing has no horizontal overflow');
   const menu=page.getByLabel('Explore ISP menu',{exact:true});await menu.click();
   await page.getByRole('navigation',{name:'Explore ISP',exact:true}).waitFor();
   check((await page.getByRole('link',{name:/ISP Academy|Community forum/}).count())===0,'Removed areas absent from navigation');
   check((await page.getByRole('link',{name:/ISP shop/}).innerText()).includes('DEMO')&&(await page.getByRole('link',{name:/Plantation jobs/}).innerText()).includes('DEMO'),'Frozen demos clearly marked; not exercised');
   const box=await menu.boundingBox();check(box.width>=44&&box.height>=44,'Menu touch target at least 44 CSS pixels');
   check(box.x>devices[profile].viewport.width/2,'Three-line menu stays top right');
   await menu.click();
   const snap=async label=>{const file=`${ROOT}/audit/${name}-${label}.png`;await page.screenshot({path:file,fullPage:true});result.screenshots.push(file);};
   await snap('landing');
   await page.goto(`${ORIGIN}/login`);await page.getByLabel('Email address',{exact:true}).fill(fixtures.actors.member_b.email);await page.getByLabel('Password',{exact:true}).fill(fixtures.actors.member_b.password);
   await Promise.all([page.waitForURL('**/member/dashboard'),page.getByRole('button',{name:'Sign in',exact:false}).click()]);
   check(page.url()===`${ORIGIN}/member/dashboard`,'Controlled member signs in through rendered form');
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Member dashboard fits mobile viewport');
   await snap('dashboard');
   for(const [label,route,selector] of [['events','/events','main h1'],['profile','/member/profile/edit','form'],['consultation','/member/consultation_requests/new','textarea'],['publications','/member/publications','main h1']]){
    const response=await page.goto(ORIGIN+route);check(response.status()===200,`${label} member page accessible`);await page.locator(selector).first().waitFor();
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${label} has no horizontal overflow`);
    if(label==='consultation'){await page.locator('textarea').focus();check(await page.evaluate(()=>document.activeElement?.tagName==='TEXTAREA'),'Consultation input receives mobile focus');}
    if(label==='events'||label==='consultation')await snap(label);
   }
   await page.goto(ORIGIN);check((await page.locator('.discover-card').count())>=2,'Discover has multiple review slides');const before=await page.locator('.discover-card:visible').innerText();await page.getByRole('button',{name:'Next slide',exact:true}).click();
   check((await page.locator('.discover-card:visible').count())===1&&(await page.locator('.discover-card:visible').innerText())!==before,'Discover carousel changes the visible slide');
   const manifest=await api('get',`${ORIGIN}/manifest.json`);check(manifest.status()===200,'PWA manifest loads');
   const data=await manifest.json();check(data.display==='standalone'&&data.icons?.some(icon=>icon.sizes==='192x192')&&data.icons?.some(icon=>icon.sizes==='512x512'),'PWA manifest contains standalone mode and phone icons');
   await page.waitForFunction(()=>navigator.serviceWorker?.controller!==null&&navigator.serviceWorker?.controller!==undefined,{},{timeout:12000});
   const cacheState=await page.evaluate(async()=>({controlled:!!navigator.serviceWorker.controller,keys:await caches.keys()}));
   check(cacheState.controlled&&cacheState.keys.length===0,'Network-only service worker controls page without private data caches');
   await page.goto(ORIGIN+'/member/dashboard');await page.locator('.member-home').waitFor();check((await page.locator('.member-home').count())===1,'Online dashboard root verified before offline check');admit();assert(deadline-Date.now()>30000&&result.requests<160,'Offline case requires remaining time and budget');await context.setOffline(true);check(await page.evaluate(()=>navigator.onLine===false),'Browser explicitly reports offline mode');let offlineError='';const offline=await page.goto(`${ORIGIN}/member/dashboard`).then(()=>false,error=>{offlineError=String(error.message);return true;});await context.setOffline(false);const privateRendered=await page.locator('.member-home').count();
   check(offline&&!deadlineHit&&Date.now()<deadline&&result.requests<180&&!/timed out|closed|Target.*closed/i.test(offlineError)&&privateRendered===0,'Offline network failure cannot render private dashboard');
   await page.goto(`${ORIGIN}/member/dashboard`);await page.setViewportSize({width:320,height:740});
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Member dashboard has no horizontal overflow at 320px width');
   await page.setViewportSize(devices[profile].viewport);await page.getByLabel('Explore ISP menu',{exact:true}).click();
   await Promise.all([page.waitForURL(url=>url.pathname==='/'||url.pathname==='/login'),page.getByRole('button',{name:'Sign out',exact:true}).click()]);
   const denied=await page.goto(`${ORIGIN}/member/dashboard`);check(new URL(page.url()).pathname==='/login','Logout prevents dashboard access');
   check(result.errors.length===0,'No uncaught application JavaScript errors');result.status='pass';
  }catch(error){result.status='fail';result.failure='Virtual browser acceptance failed; detailed error retained privately';fs.writeFileSync(PRIVATE+"/"+name+"-failure.txt",String(error.stack||error),{mode:0o600});process.exitCode=1;}
  finally{clearTimeout(stopTimer);await context.close();await browser.close();result.finished_at=new Date().toISOString();save();}
 }
 report.finished_at=new Date().toISOString();save();console.log(JSON.stringify({profiles:report.profiles.map(p=>({name:p.name,engine:p.engine,version:p.engine_version,status:p.status,checks:p.checks.length,failure:p.failure})),evidence:`${ROOT}/audit/virtual-mobile-acceptance.json`}));
}
main().catch(()=>{report.failure='Virtual acceptance prerequisites or runner failed; private values suppressed';save();console.error(report.failure);process.exitCode=1});
