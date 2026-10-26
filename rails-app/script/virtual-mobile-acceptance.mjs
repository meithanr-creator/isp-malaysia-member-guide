// Dedicated software acceptance browsers; never attach to a user's browser profile.
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {connectLinuxWebKit,closeLinuxWebKitConnection,boundedBrowserOperation} from './linux-webkit-connection.mjs';
import {OFFLINE_DASHBOARD_URL,classifyRequestFailure,acceptableOfflineNavigationError} from './virtual-mobile-failures.mjs';
import {selectLease,leaseContext,readPreparedRelease,assertActiveRelease,assertWatchdogTuple,assertWritableLease} from './staging-lease-context.mjs';
const CONTEXT=leaseContext(selectLease());
if(process.argv[2]==='--execute')assertWritableLease(CONTEXT);
const ROOT='D:/Projects/isp-member-rails',PRIVATE=CONTEXT.privateRoot;
const ORIGIN='https://isp-member-production.meithan-r.workers.dev';
process.env.PLAYWRIGHT_BROWSERS_PATH='D:/Projects/isp-rails-tools/virtual-browsers';
for(const key of ['DEBUG','PWDEBUG','NODE_OPTIONS','NODE_PATH','NODE_COMPILE_CACHE'])delete process.env[key];
const require=createRequire('D:/Projects/isp-rails-tools/virtual-browser-tools/package.json');
const {chromium,webkit,devices}=require('playwright');
const report={version:1,scope:'Virtual browser engines and mobile profiles; no physical-device or native installation claim',started_at:new Date().toISOString(),profiles:[]};
const save=()=>fs.writeFileSync(`${CONTEXT.auditRoot}/virtual-mobile-acceptance.json`,JSON.stringify(report,null,2));
const assert=(value,message)=>{if(!value)throw new Error(message)};
const read=name=>JSON.parse(fs.readFileSync(`${PRIVATE}/${name}`,'utf8'));
async function main(){
 if(process.argv[2]!=='--execute')throw new Error('Explicit --execute required');if(require('playwright/package.json').version!=='1.64.1')throw new Error('Reviewed browser tool version required');
 const runtime=read('runtime.json'),fixtures=read('acceptance-fixtures.json'),release=read('acceptance-release.json'); report.release={worker_source:release.worker_source,worker_version:release.worker_version,rails_source:release.rails_source,image_digest:release.image_digest}; report.run_marker=fixtures.run_marker;
 const prepared=readPreparedRelease(CONTEXT);
 if(CONTEXT.fresh){
  assertActiveRelease(CONTEXT,runtime,release,prepared);
  const plan=read('watchdog-plan.json'),state=read('watchdog-state.json'),now=Date.now(),updated=Date.parse(state.updated_at);
  assertWatchdogTuple(CONTEXT,runtime,plan,state,prepared);
  assert(state.armed===true&&Number.isFinite(updated)&&updated<=now+5000&&now-updated<=45000&&Date.parse(state.stop_at)===Date.parse(runtime.ISP_STAGING_EXPIRES_AT)-5*60000&&Number.isSafeInteger(state.pid)&&state.pid>0,'Live matching watchdog required');
  try{process.kill(state.pid,0);}catch{assert(false,'Live matching watchdog required');}
 }
 const deadline=Date.parse(runtime.ISP_STAGING_EXPIRES_AT)-10*60000;
 assert(runtime.APP_HOST===new URL(ORIGIN).host&&/^[a-f0-9]{64}$/.test(runtime.ISP_STAGING_KEY),'Private runtime missing');
 assert(Number.isFinite(deadline)&&Date.now()<deadline,'Acceptance window unavailable');
 assert(process.platform==='win32','Windows acceptance controller required');
 const browserTmp=PRIVATE+'/virtual-browser-tmp';try{fs.mkdirSync(browserTmp,{mode:0o700});}catch(e){assert(e.code==='EEXIST','Private browser temp unavailable');}
 assert(fs.lstatSync(browserTmp).isDirectory()&&!fs.lstatSync(browserTmp).isSymbolicLink()&&fs.realpathSync(browserTmp).replaceAll('\\','/').toLowerCase()===browserTmp.toLowerCase(),'Private D browser temp required');
 process.env.TMP=browserTmp;process.env.TEMP=browserTmp;process.env.TMPDIR=browserTmp;
 report.controller={platform:'win32',pid_windows:process.pid};
 assert(fixtures.phase==='active'&&fixtures.target?.project==='royal-glitter-45740959'&&fixtures.target?.host==='ep-delicate-frost-a1o15wrb.ap-southeast-1.aws.neon.tech'&&fixtures.target?.database==='neondb'&&fixtures.actors.member_b&&/^qa-\d{8}-[a-f0-9]{12}$/.test(fixtures.run_marker),'Controlled active fixture required'); if(!CONTEXT.fresh)assert(/^[a-f0-9]{40}$/.test(release.worker_source)&&/^[a-f0-9-]{36}$/.test(release.worker_version)&&release.rails_source==='c9a5142bd8c949c6415c3639c0113ee015f9a3f4'&&release.image_digest==='sha256:0187a1e32351a3f7a8f9c87a48798c0adf31f3b6c4116309c78f638582700cd2','Exact release metadata required');
 for(const [name,engine,profile] of [['iphone-webkit',webkit,'iPhone 13'],['android-chromium',chromium,'Pixel 7']]){
  const result={name,profile,engine:name.includes('webkit')?'WebKit':'Chromium',checks:[],screenshots:[],errors:[],requests:0};report.profiles.push(result);save();
  let browser,context,page,stopTimer,phase='browser_setup',phaseStart=Date.now(),deadlineHit=false,journeyComplete=false;
  const offlineState={armed:false,consumed:false};let offlineFailureResolve;
  const remaining=cap=>{const ms=Math.min(cap,deadline-Date.now());assert(Number.isSafeInteger(ms)&&ms>0,'Mobile deadline reached');return ms;};
  const bounded=(operation,cap=12000)=>boundedBrowserOperation(operation,remaining(cap));
  const evaluate=(fn,arg)=>bounded(()=>page.evaluate(fn,arg));
  const failProfile=(error,failedPhase=phase)=>{
   if(result.status!=='fail'){
    result.failure_phase=failedPhase;result.status='fail';result.failure='Virtual browser acceptance failed; detailed error retained privately';
    try{fs.writeFileSync(PRIVATE+'/'+name+'-failure.txt',String(error?.stack||error),{mode:0o600});}catch{result.failure_evidence='write failed';}
   }
   process.exitCode=1;
  };
  const check=(ok,label)=>{assert(ok,label);result.checks.push(label)};
  try{
   assert(Date.now()<deadline,'Acceptance window unavailable');
   browser=name==='iphone-webkit'
    ?await connectLinuxWebKit(webkit,{privateRoot:PRIVATE,deadline})
    :await engine.launch({headless:true,artifactsDir:browserTmp,downloadsPath:browserTmp,timeout:remaining(30000)});
   result.execution_platform=name==='iphone-webkit'?'linux':'win32';result.connection=name==='iphone-webkit'?'private-loopback-playwright':'local-launch';result.engine_version=browser.version();
   context=await bounded(()=>browser.newContext({...devices[profile],reducedMotion:'reduce'}),15000);
   result.viewport=devices[profile].viewport;result.touch=devices[profile].hasTouch;
   stopTimer=setTimeout(()=>{deadlineHit=true;void context.close().catch(()=>{});},Math.max(1,deadline-Date.now()));
   context.on('request',()=>{result.requests++;});
   context.on('requestfailed',request=>{
    let isMainFrame=false;try{isMainFrame=request.frame()===page?.mainFrame();}catch{}
    const outcome=classifyRequestFailure({url:request.url(),method:request.method(),isNavigationRequest:request.isNavigationRequest(),isMainFrame,errorText:request.failure()?.errorText},offlineState);
    if(outcome==='expected-offline-navigation'){offlineState.consumed=true;result.expected_offline_failures=(result.expected_offline_failures||0)+1;offlineFailureResolve?.();}
    else result.errors.push(outcome);
   });
   context.on('page',observed=>observed.on('pageerror',()=>result.errors.push('Application JavaScript error')));
   await context.route('**/*',route=>Date.now()>=deadline||result.requests>180?route.abort():route.continue());
   page=await bounded(()=>context.newPage(),15000);page.setDefaultTimeout(12000);page.setDefaultNavigationTimeout(20000);
   const admit=()=>assert(!deadlineHit&&Date.now()<deadline&&result.requests<180,'Bounded mobile admission refused');
   const api=async(method,url,options={})=>{admit();result.requests++;return context.request[method](url,{...options,maxRedirects:0,timeout:remaining(20000)});};
   result.navigation=[];result.lifecycle_events=[];
   page.on('response',response=>{if(response.request().isNavigationRequest()&&response.frame()===page.mainFrame())result.navigation.push({phase,status:response.status(),elapsed_ms:Date.now()-phaseStart});});
   page.on('domcontentloaded',()=>result.lifecycle_events.push({phase,event:'domcontentloaded',elapsed_ms:Date.now()-phaseStart}));
   phase='full_readiness'; phaseStart=Date.now();
   admit();result.requests++;const readiness=await context.request.get(ORIGIN+'/ready',{headers:{'x-isp-staging-key':runtime.ISP_STAGING_KEY},maxRedirects:0,timeout:Math.min(120000,deadline-Date.now())});check(readiness.status()===200,'Bounded scanner and Rails readiness before navigation');
   phase='review_form'; phaseStart=Date.now();
   const form=await page.goto(`${ORIGIN}/__isp_review`);check(form.status()===200,'Private review form loads in rendered browser');
   await page.getByLabel('Review access code',{exact:true}).fill(runtime.ISP_STAGING_KEY);
   const pending=page.waitForResponse(r=>r.url()===ORIGIN+'/__isp_review'&&r.request().method()==='POST');
   const [opened]=await Promise.all([pending,page.getByRole('button',{name:'Open private review',exact:true}).tap()]);
   check(opened.status()===303,'Rendered same-origin review entry accepted');
   const cookies=await context.cookies(ORIGIN),gate=cookies.find(c=>c.name==='__Host-isp_acceptance');
   check(gate&&gate.secure&&gate.httpOnly&&gate.sameSite==='Strict'&&!gate.value.includes(runtime.ISP_STAGING_KEY)&&gate.expires*1000<=Date.parse(runtime.ISP_STAGING_EXPIRES_AT)+1000,'Browser accepts secure fixed-expiry cookie without raw key');
   phase='landing'; phaseStart=Date.now();
   await page.waitForURL(ORIGIN+'/');
   const home=await page.goto(ORIGIN);check(home.status()===200,'Landing page loads in actual engine');   await page.locator('.welcome-hero').waitFor();await evaluate(()=>document.fonts.ready);
   check((await page.locator('img[alt="Official ISP crest"]').count())===1,'Official crest present');
   check(await evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Landing has no horizontal overflow');
   const menu=page.getByLabel('Explore ISP menu',{exact:true});await menu.tap();
   await page.getByRole('navigation',{name:'Explore ISP',exact:true}).waitFor();
   check((await page.getByRole('link',{name:/ISP Academy|Community forum/}).count())===0,'Removed areas absent from navigation');
   check((await page.getByRole('link',{name:/ISP shop/}).innerText()).includes('DEMO')&&(await page.getByRole('link',{name:/Plantation jobs/}).innerText()).includes('DEMO'),'Frozen demos clearly marked; not exercised');
   const box=await menu.boundingBox();check(box.width>=44&&box.height>=44,'Menu touch target at least 44 CSS pixels');
   check(box.x>devices[profile].viewport.width/2,'Three-line menu stays top right');
   await menu.tap();
   const snap=async label=>{const file=`${CONTEXT.auditRoot}/${name}-${label}.png`;await page.screenshot({path:file,fullPage:true});result.screenshots.push(file);};
   await snap('landing');
   phase='member_login';phaseStart=Date.now();await page.goto(`${ORIGIN}/login`);await page.getByLabel('Email address',{exact:true}).fill(fixtures.actors.member_b.email);await page.getByLabel('Password',{exact:true}).fill(fixtures.actors.member_b.password);
   await Promise.all([page.waitForURL('**/member/dashboard'),page.getByRole('button',{name:'Sign in',exact:false}).tap()]);
   check(page.url()===`${ORIGIN}/member/dashboard`,'Controlled member signs in through rendered form');
   await page.locator('.member-home').waitFor();check(await evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Member dashboard fits mobile viewport');
   await snap('dashboard');
   for(const [label,route,selector] of [['events','/events','main h1'],['profile','/member/profile/edit','form'],['consultation','/member/consultation_requests/new','textarea'],['publications','/member/publications','main h1']]){
    phase='member_'+label; phaseStart=Date.now();
    const response=await page.goto(ORIGIN+route);check(response.status()===200,`${label} member page accessible`);await page.locator(selector).first().waitFor();
    check(await evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${label} has no horizontal overflow`);
    if(label==='consultation'){await page.locator('textarea').tap();check(await evaluate(()=>document.activeElement?.tagName==='TEXTAREA'),'Consultation input receives mobile focus');}
    if(label==='events'||label==='consultation')await snap(label);
   }
   phase='discover';phaseStart=Date.now();await page.goto(ORIGIN);check((await page.locator('.discover-card').count())>=2,'Discover has multiple review slides');const before=await page.locator('.discover-card:visible').innerText();await page.getByRole('button',{name:'Next slide',exact:true}).tap();
   check((await page.locator('.discover-card:visible').count())===1&&(await page.locator('.discover-card:visible').innerText())!==before,'Discover carousel changes the visible slide');
   phase='pwa';phaseStart=Date.now();const manifest=await api('get',`${ORIGIN}/manifest.json`);check(manifest.status()===200,'PWA manifest loads');
   const data=await manifest.json();check(data.display==='standalone'&&data.icons?.some(icon=>icon.sizes==='192x192')&&data.icons?.some(icon=>icon.sizes==='512x512'),'PWA manifest contains standalone mode and phone icons');
   await page.waitForFunction(()=>navigator.serviceWorker?.controller!==null&&navigator.serviceWorker?.controller!==undefined,{},{timeout:12000});
   const cacheState=await evaluate(async()=>({controlled:!!navigator.serviceWorker.controller,keys:await caches.keys()}));
   check(cacheState.controlled&&cacheState.keys.length===0,'Network-only service worker controls page without private data caches');
   phase='offline_privacy';phaseStart=Date.now();
   await page.goto(OFFLINE_DASHBOARD_URL);await page.locator('.member-home').waitFor();
   check((await page.locator('.member-home').count())===1,'Online dashboard root verified before offline check');
   admit();assert(deadline-Date.now()>30000&&result.requests<160,'Offline case requires remaining time and budget');
   await page.goto('about:blank');let offlineRejected=false,offlineError='',privateRendered=-1;
   try{
    await bounded(()=>context.setOffline(true));check(await evaluate(()=>navigator.onLine===false),'Browser explicitly reports offline mode');
    const failedEvent=new Promise(resolve=>{offlineFailureResolve=resolve;});offlineState.armed=true;
    try{
     const navigation=page.goto(OFFLINE_DASHBOARD_URL,{timeout:remaining(20000)}).then(()=>({rejected:false,error:''}),error=>({rejected:true,error:String(error.message||'')}));
     const [outcome]=await Promise.all([navigation,bounded(()=>failedEvent,20000)]);offlineRejected=outcome.rejected;offlineError=outcome.error;
    }finally{offlineState.armed=false;offlineFailureResolve=undefined;}
    privateRendered=await bounded(()=>page.locator('.member-home').count());
   }finally{offlineState.armed=false;offlineFailureResolve=undefined;await bounded(()=>context.setOffline(false));}
   check(offlineRejected&&offlineState.consumed&&result.expected_offline_failures===1&&acceptableOfflineNavigationError(offlineError)&&!deadlineHit&&Date.now()<deadline&&result.requests<180&&privateRendered===0,'Offline network failure cannot render private dashboard');
   phase='responsive';phaseStart=Date.now();await page.goto(`${ORIGIN}/member/dashboard`);await page.setViewportSize({width:320,height:740});
   check(await evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Member dashboard has no horizontal overflow at 320px width');
   phase='logout';phaseStart=Date.now();await page.setViewportSize(devices[profile].viewport);await page.getByLabel('Explore ISP menu',{exact:true}).tap();
   await Promise.all([page.waitForURL(url=>url.pathname==='/'||url.pathname==='/login'),page.getByRole('button',{name:'Sign out',exact:true}).tap()]);
   const denied=await page.goto(`${ORIGIN}/member/dashboard`);check(new URL(page.url()).pathname==='/login','Logout prevents dashboard access');
   await page.waitForLoadState('networkidle',{timeout:remaining(10000)});check(result.requests<=180,'Mobile request budget respected');check(result.errors.length===0,'No unexpected transport failures or uncaught application JavaScript errors');journeyComplete=true;
  }catch(error){failProfile(error);}
  finally{
   clearTimeout(stopTimer);let cleanupFailed=false;
   try{await closeLinuxWebKitConnection(()=>context?.close(),()=>{});}catch(error){cleanupFailed=true;failProfile(error,'browser_cleanup');}
   try{await closeLinuxWebKitConnection(()=>browser?.close(),()=>{});}catch(error){cleanupFailed=true;failProfile(error,'browser_cleanup');}
   result.cleanup=cleanupFailed?'fail':'pass';
   if(journeyComplete&&!cleanupFailed&&result.errors.length===0&&!deadlineHit&&Date.now()<deadline&&result.requests<=180)result.status='pass';
   else if(result.status!=='fail')failProfile(Error('Final mobile evidence, deadline or cleanup check failed'),'browser_cleanup');
   result.finished_at=new Date().toISOString();save();
  }
 }
 report.finished_at=new Date().toISOString();save();console.log(JSON.stringify({profiles:report.profiles.map(p=>({name:p.name,engine:p.engine,version:p.engine_version,status:p.status,checks:p.checks.length,failure:p.failure})),evidence:`${CONTEXT.auditRoot}/virtual-mobile-acceptance.json`}));
}
main().catch(()=>{report.failure='Virtual acceptance prerequisites or runner failed; private values suppressed';save();console.error(report.failure);process.exitCode=1});
