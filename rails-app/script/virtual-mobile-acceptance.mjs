// One explicit profile per run. Browser mutations are journalled before submission.
import fs from 'node:fs';
import {RESOURCE_CATALOG,RESOURCE_SOURCES,MOBILE_RESOURCE_MODEL,CASE_RESOURCE_DEMAND,PROFILE_RESOURCE_DEMAND,RESOURCE_MODEL_SHA256,profileRequestLimit,remainingCaseRequests,assertQueuedResourcePacket,assertQueuedFixtureEnvelope,resourceAttempt,settleResourceBodies} from './virtual-mobile-resources.mjs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {connectLinuxWebKit,closeLinuxWebKitConnection} from './linux-webkit-connection.mjs';
import {OFFLINE_DASHBOARD_URL,classifyRequestFailure,acceptableOfflineNavigationError,privateRequestFailureFact,retainPrivateFailureFact,freezeFailureBeforeCleanup} from './virtual-mobile-failures.mjs';
import {LEASE2,LEASE3,leaseContext,readPreparedRelease,preparedTuple,assertActiveRelease,assertWatchdogTuple,assertWritableLease,assertLeaseMutationAllowed} from './staging-lease-context.mjs';
import {ORIGIN,LIMITS,PROFILES,REQUIRED_CASES,CoverageDeferred,ensure,sha256,encode,argumentsFor,profileWindow,admitCase,safeURL,dependencies,submitOnce,totp,verifyFile,uiComplete,databaseMatches,databaseProof,processReceiptMatches,aggregateStatus,runRenderedJourneys,afterInitiatedRender} from './virtual-mobile-journeys.mjs';
import {privateContext,readPrivateAcceptance,assertPrivateAcceptanceAdmission} from './private-acceptance-context.mjs';
import {queuedContinuationSelection} from './private-acceptance-mobile.mjs';
import {readHistoricalIdentityCarry} from './private-acceptance-carry.mjs';
export function selectedMobileContext(leaseId=process.env.ISP_STAGING_LEASE??LEASE3){
 if(leaseId==='rails-private-acceptance'){ensure(process.env.ISP_PRIVATE_ACCEPTANCE==='true');return privateContext();}
 ensure([LEASE2,LEASE3].includes(leaseId),'Explicit allowlisted mobile lease required');
 return leaseContext(leaseId);
}
import {readActiveStagingAdmission} from './active-staging-admission.mjs';
export const ROOT='D:/Projects/isp-member-rails',CONTEXT=selectedMobileContext(),PRIVATE=CONTEXT.privateRoot;
const JOURNAL=PRIVATE+'/acceptance-mobile.json',PUBLIC=CONTEXT.auditRoot+'/virtual-mobile-acceptance.json';
function fixed(path,directory=false){const st=fs.lstatSync(path);ensure(!st.isSymbolicLink()&&fs.realpathSync(path).replaceAll('\\','/').toLowerCase()===path.toLowerCase()&&(directory?st.isDirectory():st.isFile()),'Fixed D browser path required');return st;}
export function readPrivate(name,max=16777216){const p=PRIVATE+'/'+name;ensure(fixed(p).size<=max);const raw=fs.readFileSync(p,'utf8');return {value:JSON.parse(raw.replace(/^\uFEFF/,'')),raw};}
export function durable(path,value,exclusive=false){
 fixed(path.slice(0,path.lastIndexOf('/')),true);
 const raw=encode(value),tmp=path+'.'+process.pid+'.tmp',fd=fs.openSync(tmp,'wx',0o600);
 try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 if(exclusive)ensure(!fs.existsSync(path),'Existing mobile evidence cannot be overwritten');
 fs.renameSync(tmp,path);
}
export function readMobileInputs(name,{watchdog=true,now=Date.now()}={}){
 ensure(process.platform==='win32'&&process.versions.node==='24.21.0'&&process.env.ISP_STAGING_LEASE===CONTEXT.leaseId,'Pinned Windows controller and explicit matching lease required');
 if(CONTEXT.native)return readNativeMobileInputs(name,{watchdog,now});
 if(watchdog)assertLeaseMutationAllowed(CONTEXT);
 fixed(PRIVATE,true);assertWritableLease(CONTEXT);const prepared=readPreparedRelease(CONTEXT),r=readPrivate('runtime.json'),runtime=r.value,release=readPrivate('acceptance-release.json').value;
 assertActiveRelease(CONTEXT,runtime,release,prepared);
 ensure(runtime.APP_HOST===new URL(ORIGIN).host&&/^[a-f0-9]{64}$/.test(runtime.ISP_STAGING_KEY));
 const fixtures=readPrivate('acceptance-fixtures.json').value,http=readPrivate('acceptance-http.json').value,observations=readPrivate('acceptance-db-observations.json').value;
 ensure(fixtures.target?.project==='royal-glitter-45740959'&&fixtures.target?.host==='ep-delicate-frost-a1o15wrb.ap-southeast-1.aws.neon.tech'&&fixtures.target?.database==='neondb','Fixed synthetic target required');
 const phasePath=CONTEXT.auditRoot+'/functional-phase-summary.json';ensure(fixed(phasePath).size<=1048576);const phase=JSON.parse(fs.readFileSync(phasePath,'utf8'));
 dependencies({profile:name,runtime,fixtures,http,observations,phase,preparedHash:prepared.prepared_release_sha256,now});
 const admissionSnapshot=watchdog?readActiveStagingAdmission(CONTEXT,{expectedRuntime:runtime,prepared,now}).snapshot:null;
 if(watchdog&&process.env.ISP_MOBILE_RUNTIME_SHA256!==undefined)ensure(process.env.ISP_MOBILE_RUNTIME_SHA256===sha256(r.raw),'Wrapper runtime changed before browser launch');
 if(watchdog&&process.env.ISP_MOBILE_ADMISSION_SHA256!==undefined)ensure(process.env.ISP_MOBILE_ADMISSION_SHA256===sha256(encode(admissionSnapshot)),'Wrapper admission changed before browser launch');
 return {runtime,fixtures,http,observations,prepared,admissionSnapshot,runtimeHash:sha256(r.raw),release:{...preparedTuple(prepared),worker_version:release.worker_version,deployment_id:release.deployment_id}};
}
function readNativeMobileInputs(name,{watchdog,now}){
 const n=readPrivateAcceptance({active:watchdog}),r=readPrivate('runtime.json'),runtime=r.value,fixtures=readPrivate('acceptance-fixtures.json').value,http=readPrivate('acceptance-http.json').value,observations=readPrivate('acceptance-db-observations.json').value,phase=readPrivate('functional-phase-summary.json').value;
 ensure(runtime.APP_HOST===new URL(ORIGIN).host&&fixtures.target?.project==='royal-glitter-45740959'&&fixtures.target.host==='ep-delicate-frost-a1o15wrb.ap-southeast-1.aws.neon.tech'&&fixtures.target.database==='neondb');
 const carry=runtime.ISP_ACCEPTANCE_CONTINUATION==='true'?readHistoricalIdentityCarry(n):undefined;
 dependencies({profile:name,runtime,fixtures,http,observations,phase,preparedHash:n.prepared.prepared_release_sha256,prepared:n.prepared,carry,now});
 if(watchdog&&process.env.ISP_MOBILE_RUNTIME_SHA256!==undefined)ensure(process.env.ISP_MOBILE_RUNTIME_SHA256===sha256(r.raw));
 if(watchdog&&process.env.ISP_MOBILE_ADMISSION_SHA256!==undefined)ensure(process.env.ISP_MOBILE_ADMISSION_SHA256===sha256(encode(n.snapshot)));
 const seal=readPrivate('sealed-version.json').value;
 return {runtime,fixtures,http,observations,prepared:n.prepared,admissionSnapshot:watchdog?n.snapshot:null,runtimeHash:sha256(r.raw),release:{...n.prepared,worker_version:seal.version_id,deployment_id:seal.deployment_id}};
}
export function publicReport(j){
 return {version:2,scope:'Virtual browser engines and mobile profiles; physical devices/native installation/native PDF viewer are unproved',status:aggregateStatus(j),run_marker:j.run_marker,release:j.release,profiles:Object.values(j.profiles).map(p=>({name:p.name,status:p.status,engine:p.engine,engine_version:p.engine_version,execution_platform:p.execution_platform,started_at:p.started_at,finished_at:p.finished_at,requests:p.requests,...(p.carried_checks?{carried_checks:p.carried_checks}:{}),...(p.resources?{resources:{...p.resources,paths:undefined}}:{}),checks:p.checks,cases:p.cases,screenshots:p.screenshots,cleanup:p.cleanup,process_cleanup:p.process_cleanup,db_reconciled:p.db_reconciled,errors:p.errors,failure_phase:p.failure_phase,elapsed_ms:p.elapsed_ms})),deferred:['natural aged MFA step-up is a separate window','physical devices, native install, OS PDF viewer, assistive-technology/conformance audit'],production_release_approved:false};
}
function save(j){durable(JOURNAL,j);durable(PUBLIC,publicReport(j));}
function matchingJournal(j,input){ensure(j?.version===2&&j.lease_id===CONTEXT.leaseId&&j.run_marker===input.fixtures.run_marker&&j.runtime_sha256===input.runtimeHash&&JSON.stringify(j.release)===JSON.stringify(input.release),'Mobile journal release/run differs');}
export async function executeProfile(name,input){
 ensure(input.admissionSnapshot&&process.env.ISP_MOBILE_RUNTIME_SHA256===input.runtimeHash&&process.env.ISP_MOBILE_ADMISSION_SHA256===sha256(encode(input.admissionSnapshot)),'Original wrapper admission binding required');
 if(CONTEXT.native)assertPrivateAcceptanceAdmission(input.runtime,0,input.admissionSnapshot);else assertLeaseMutationAllowed(CONTEXT);
 ensure(input?.runtime?.ISP_STAGING_LEASE===CONTEXT.leaseId&&input.fixtures?.lease_id===CONTEXT.leaseId&&input.release?.lease_id===CONTEXT.leaseId,'Matching selected mobile execution tuple required');
 const {runtime,fixtures,http,observations}=input,profile=PROFILES[name],window=profileWindow(runtime),queued=assertQueuedResourcePacket(input.prepared),requestLimit=profileRequestLimit(input.prepared),continuation=queuedContinuationSelection(input.prepared),carriedGate=continuation?.profiles?.[name]?.cases?.private_gate;
 if(queued){
  for(const entry of [...RESOURCE_CATALOG,...RESOURCE_SOURCES]){const target=ROOT+'/'+entry.path;ensure(fixed(target).isFile()&&sha256(fs.readFileSync(target))===entry.sha256,'Pinned cold-demand catalog/source changed');}
  assertQueuedFixtureEnvelope(name,observations);ensure(PROFILE_RESOURCE_DEMAND.requests<=requestLimit,'Whole cold profile cannot fit request envelope');
 }
 let journal;
 if(fs.existsSync(JOURNAL)){journal=readPrivate('acceptance-mobile.json').value;matchingJournal(journal,input);}else journal={version:2,lease_id:CONTEXT.leaseId,run_marker:fixtures.run_marker,runtime_sha256:input.runtimeHash,release:input.release,profiles:{}};
 ensure(!Object.hasOwn(journal.profiles,name),'A started profile is never replayed; reconcile unknown outcomes before a new reviewed run');
 if(name==='android-chromium')ensure(journal.profiles['iphone-webkit']?.status==='PASS'&&journal.profiles['iphone-webkit'].db_reconciled===true&&journal.profiles['iphone-webkit'].process_cleanup==='pass','Capture/status and reconcile iPhone before Android');
 const result={name,lease_id:CONTEXT.leaseId,admin:profile.admin,controller_pid:process.pid,server_id:name==='iphone-webkit'?process.env.ISP_LINUX_WEBKIT_SERVER_ID:null,status:'OPEN',started_at:new Date().toISOString(),checks:[],screenshots:[],errors:[],requests:0,cleanup:'pending',db_reconciled:false,process_cleanup:'pending',cases:Object.fromEntries(REQUIRED_CASES.map(id=>[id,{status:'NOT_RUN'}])),actions:{},expected:{},baseline_sessions:Object.fromEntries(['member_b',profile.admin].map(alias=>[alias,observations.actors[alias].sessions.map(s=>s.id)]))};
 if(carriedGate){for(const [id,carried]of Object.entries(continuation.profiles[name].cases))result.cases[id]={...carried,status:'PASS',evidence_origin:'carried',source_packet_sha256:carried.source_packet_sha256??continuation.source_packet_sha256,source_mobile_sha256:carried.source_mobile_sha256??continuation.source_mobile_sha256};result.carried_checks=continuation.profiles[name].successful_check_labels;}
 if(queued)result.resources={model_sha256:RESOURCE_MODEL_SHA256,requests:0,documents:0,prefetch:0,paths:{},auxiliary:0,dynamic:0,api:0,files:0,writes:0};
 journal.profiles[name]=result;save(journal);
 const tmp=PRIVATE+'/virtual-browser-tmp';try{fs.mkdirSync(tmp,{mode:0o700});}catch(e){ensure(e.code==='EEXIST');}fixed(tmp,true);process.env.TMP=tmp;process.env.TEMP=tmp;process.env.TMPDIR=tmp;
 process.env.PLAYWRIGHT_BROWSERS_PATH='D:/Projects/isp-rails-tools/virtual-browsers';
 for(const k of Object.keys(process.env))if(['DEBUG','PWDEBUG','NODE_OPTIONS','NODE_PATH','NODE_COMPILE_CACHE'].includes(k.toUpperCase()))delete process.env[k];
 const require=createRequire('D:/Projects/isp-rails-tools/virtual-browser-tools/package.json'),{chromium,webkit,devices}=require('playwright');ensure(require('playwright/package.json').version==='1.64.1');
 let browser,browserServer,page,entryGate,phase='browser_setup',deadlineHit=false,timer,stopPoll;const contexts=[],responseBodies=new Set(),offlineState={armed:false,consumed:false},requestPhases=new WeakMap();let failedResolve,closing=false;
 const requestFacts=request=>{let main=false;try{const frame=request.frame();main=frame===frame.page().mainFrame();}catch{}return {url:request.url(),method:request.method(),resourceType:request.resourceType(),isNavigationRequest:request.isNavigationRequest(),isMainFrame:main,phase,requestPhase:requestPhases.get(request),cleanup:closing};};
 const noteFailure=(category,facts={},fatal=true)=>{retainPrivateFailureFact(result,privateRequestFailureFact({phase,cleanup:closing,...facts},category),{fatal});if(fatal)result.errors.push(category);};
 const remaining=(cap=20000)=>{const ms=Math.min(cap,window.deadline-Date.now());ensure(ms>0&&!deadlineHit,'Profile deadline reached');return ms;};
 const bounded=async(fn,ms=20000)=>{let t;try{return await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{t=setTimeout(()=>reject(Error('Bounded browser operation timed out')),ms);})]);}finally{clearTimeout(t);}};
 const operation=(fn,cap=20000)=>bounded(fn,remaining(cap));
 const check=(ok,label)=>{ensure(ok,label);result.checks.push(label);};
 const evaluate=(p,fn,arg)=>operation(()=>p.evaluate(fn,arg));
 const verifyWatchdog=()=>CONTEXT.native?assertPrivateAcceptanceAdmission(runtime,0,input.admissionSnapshot):readActiveStagingAdmission(CONTEXT,{expectedRuntime:runtime,prepared:input.prepared,expectedSnapshot:input.admissionSnapshot});
 const admit=()=>{verifyWatchdog();ensure(Date.now()<window.deadline&&!deadlineHit&&result.requests<requestLimit,'Mobile request/time budget reached');};
 async function role(label,gate,{page:withPage=true,cookies}={}){
  admit();const ctx=await operation(()=>browser.newContext({...devices[profile.device],reducedMotion:'reduce'}),15000);contexts.push(ctx);
  ctx.on('request',request=>{result.requests++;requestPhases.set(request,phase);if(queued)try{const facts=requestFacts(request),headers=request.headers();resourceAttempt(result.resources,{...facts,navigation:facts.isNavigationRequest,accept:headers.accept,prefetch:headers['x-sec-purpose']==='prefetch',expectedOffline:offlineState.armed});}catch{noteFailure('Cold mobile resource envelope exceeded');deadlineHit=true;for(const c of contexts)void c.close().catch(()=>{});}});
  ctx.on('requestfailed',r=>{const facts=requestFacts(r),kind=classifyRequestFailure({...facts,errorText:r.failure()?.errorText},offlineState);if(kind==='expected-offline-navigation'){noteFailure(kind,facts,false);offlineState.consumed=true;result.expected_offline_failures=(result.expected_offline_failures||0)+1;failedResolve?.();}else noteFailure(kind,facts);});
  ctx.on('response',response=>{if(queued){const body=response.finished().then(error=>ensure(!error,'Incomplete browser response body'));responseBodies.add(body);void body.catch(()=>{noteFailure('Incomplete browser response body');deadlineHit=true;}).finally(()=>responseBodies.delete(body));}const request=response.request(),facts=requestFacts(request);if(response.status()>=400&&['script','stylesheet','font','image'].includes(facts.resourceType)){try{if(new URL(facts.url).origin===ORIGIN)noteFailure('Asset HTTP failure',{...facts,httpStatus:response.status()});}catch{}}});
  ctx.on('page',p=>{p.setDefaultTimeout(12000);p.setDefaultNavigationTimeout(20000);p.on('pageerror',()=>noteFailure('Application JavaScript error'));});
  await ctx.route('**/*',route=>{const u=new URL(route.request().url());try{if(['http:','https:'].includes(u.protocol))verifyWatchdog();return deadlineHit||Date.now()>=window.deadline||result.requests>requestLimit||!['data:','blob:','about:'].includes(u.protocol)&&u.origin!==ORIGIN?route.abort():route.continue();}catch{noteFailure('Active browser admission unavailable');return route.abort();}});
  if(cookies)await operation(()=>ctx.addCookies(cookies));else if(gate)await operation(()=>ctx.addCookies([gate]));
  return {context:ctx,page:withPage?await operation(()=>ctx.newPage()):undefined};
 }
 async function api(ctx,url){admit();if(queued)ensure(++result.resources.api<=15,'Exact API attempt envelope exceeded');result.requests++;return operation(()=>ctx.request.get(safeURL(url).href,{maxRedirects:0,timeout:remaining()}));}
 async function go(p,url,selector){admit();const target=safeURL(url);const turbo=new URL(p.url()).origin===ORIGIN&&await evaluate(p,()=>!!window.Turbo?.visit);
  if(turbo)await afterInitiatedRender(p,{url:target.href,timeoutMs:remaining()},()=>evaluate(p,u=>window.Turbo.visit(u),target.href));else{const r=await p.goto(target.href,{timeout:remaining()});check(r?.status()===200,'Rendered same-origin page loads');}
  await p.waitForURL(u=>u.pathname===target.pathname,{timeout:remaining()});await p.locator(selector).first().waitFor({timeout:remaining()});
 }
 async function submit(id,p,button,{upload=false}={}){
  admit();verifyWatchdog();if(queued)ensure(++result.resources.writes<=17,'Exact mutation attempt envelope exceeded');ensure(!Object.hasOwn(result.actions,id),'Mutation intent already exists; no replay');
  const form=await operation(()=>button.evaluate(el=>{const f=el.form;return f?{action:f.action,method:f.method,override:f.querySelector('[name="_method"]')?.value,csrf:!!f.querySelector('[name="authenticity_token"]')?.value,review_key:!!f.querySelector('input[name="access_key"][type="password"][maxlength="64"][autocomplete="off"]'),lock_version:f.querySelector('[name$="[lock_version]"],[name="lock_version"]')?.value??null,revision:f.querySelector('[name="revision"]')?.value??null}:null;}));
  return submitOnce({id,form,writeIntent:async(action,contract)=>{result.actions[action]={status:'intent',at:new Date().toISOString(),...contract};save(journal);},
   perform:async()=>{const path=safeURL(form.action).pathname,cap=upload?45000:20000;
    const pending=p.waitForResponse(r=>new URL(r.url()).origin===ORIGIN&&new URL(r.url()).pathname===path&&r.request().method()==='POST',{timeout:remaining(cap)});
    const [response]=await operation(()=>Promise.all([pending,button.tap({timeout:remaining(cap)})]),cap);
    check([302,303].includes(response.status()),'Rendered mutation receives its expected redirect');
    return {status:response.status(),at:new Date().toISOString()};},
   writeObserved:async(action,observation)=>{result.actions[action]={...result.actions[action],status:'observed',observation};save(journal);}
  });
 }
 async function file(p,url,hash,type,label){
  admit();if(queued)ensure(++result.resources.files<=4,'Exact file attempt envelope exceeded');const target=safeURL(url).href,download=await operation(()=>p.evaluate(async({url,max})=>{
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);let reader;
   try{const r=await fetch(url,{credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});reader=r.body.getReader();const chunks=[];let length=0;
    for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>max)throw Error('File bound');chunks.push(value);}
    const bytes=new Uint8Array(length);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return {status:r.status,type:r.headers.get('content-type'),cache:r.headers.get('cache-control'),disposition:r.headers.get('content-disposition'),base64:btoa(raw)};
   }finally{clearTimeout(timer);if(reader)await reader.cancel().catch(()=>{});}
  },{url:target,max:LIMITS.pdf_bytes}));
  const bytes=Buffer.from(download.base64,'base64');verifyFile(download,bytes,hash,type);const path=PRIVATE+'/'+name+'-'+label;fs.writeFileSync(path,bytes,{flag:'wx',mode:0o600});check(true,'Browser-fetched file has exact independently expected bytes and private response headers');
 }
 async function audit(p){
  const state=await evaluate(p,()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,main:document.querySelectorAll('main#main').length,lang:document.documentElement.lang,unlabelled:[...document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea')].filter(e=>!e.disabled&&!e.labels?.length&&!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')).length,missingAlt:document.querySelectorAll('img:not([alt])').length}));
  check(!state.overflow&&state.main===1&&!!state.lang&&state.unlabelled===0&&state.missingAlt===0,'Rendered structure has one main, language, field labels, image alternatives and no horizontal overflow');
 }
 async function offline(p,ctx){
  await go(p,'/member/dashboard','.member-home');await p.goto('about:blank');let rejection=false,error='',privateCount=-1;
  try{await operation(()=>ctx.setOffline(true));check(await evaluate(p,()=>navigator.onLine===false),'Engine reports explicit offline state');
   const failed=new Promise(resolve=>{failedResolve=resolve;});offlineState.armed=true;
   try{const navigation=p.goto(OFFLINE_DASHBOARD_URL,{timeout:remaining()}).then(()=>({rejected:false}),e=>({rejected:true,error:String(e.message||'')}));const [v]=await operation(()=>Promise.all([navigation,failed]));rejection=v.rejected;error=v.error;}finally{offlineState.armed=false;failedResolve=undefined;}
   privateCount=await operation(()=>p.locator('.member-home').count());
  }finally{offlineState.armed=false;failedResolve=undefined;await operation(()=>ctx.setOffline(false));}
  check(rejection&&offlineState.consumed&&result.expected_offline_failures===1&&acceptableOfflineNavigationError(error)&&privateCount===0,'Single deliberate offline dashboard request fails without restoring private content');
 }
 try{
  const controlId=process.env.ISP_MOBILE_CONTROLLER_ID;
  ensure(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(controlId||''),'Fresh outer controller UUID required');
  const stopPath=PRIVATE+'/mobile-browser-control/'+controlId+'/controller-stop';
  stopPoll=setInterval(()=>{try{if(!fs.existsSync(stopPath))return;ensure(fixed(stopPath).size<=64&&fs.readFileSync(stopPath,'utf8')===controlId+'\n');deadlineHit=true;clearInterval(stopPoll);for(const c of contexts)void c.close().catch(()=>{});if(browserServer)void browserServer.close().catch(()=>{});}catch{deadlineHit=true;clearInterval(stopPoll);for(const c of contexts)void c.close().catch(()=>{});}},250);
  browser=name==='iphone-webkit'?await connectLinuxWebKit(webkit,{leaseId:CONTEXT.leaseId,privateRoot:PRIVATE,deadline:window.deadline}):null;
  if(!browser){browserServer=await operation(()=>chromium.launchServer({headless:true,downloadsPath:tmp,timeout:remaining(30000)}),30000);result.browser_pid_windows=browserServer.process().pid;save(journal);browser=await operation(()=>chromium.connect(browserServer.wsEndpoint(),{timeout:remaining(15000)}),15000);}
  if(name==='iphone-webkit')result.server_pid_linux=readPrivate('linux-webkit/'+result.server_id+'/connection.json',8192).value.server_pid_linux;
  result.engine=profile.engine;result.engine_version=browser.version();result.execution_platform=name==='iphone-webkit'?'linux':'win32';const member=await role('member',null);page=member.page;result.viewport=devices[profile.device].viewport;
  timer=setTimeout(()=>{deadlineHit=true;for(const c of contexts)void c.close().catch(()=>{});},remaining(window.deadline-Date.now()));
  // This header is used for this one same-origin read only. It is never installed globally.
  admit();result.requests++;const ready=await operation(()=>member.context.request.get(ORIGIN+'/ready',{headers:{'x-isp-staging-key':runtime.ISP_STAGING_KEY},maxRedirects:0,timeout:remaining(120000)}),120000);check(ready.status()===200,'Bounded full readiness succeeds before navigation');
  if(carriedGate){
   phase='fresh_review_entry_prerequisite';await page.goto(ORIGIN+'/__isp_review',{timeout:remaining()});await page.getByLabel('Review access code',{exact:true}).fill(runtime.ISP_STAGING_KEY);
   const button=page.getByRole('button',{name:'Open private review',exact:true}),form=await operation(()=>button.evaluate(el=>{const f=el.form;return f?{action:f.action,method:f.method,csrf:!!f.querySelector('[name=authenticity_token]')?.value,review_key:!!f.querySelector('input[name=access_key][type=password][maxlength="64"][autocomplete=off]')}:null;}));
   await submitOnce({id:'review_access',form,writeIntent:async(id,contract)=>{result.actions[id]={status:'intent',purpose:'fresh_cookie_prerequisite_for_carried_gate',at:new Date().toISOString(),...contract};save(journal);},perform:async()=>{await operation(()=>Promise.all([page.waitForURL(ORIGIN+'/',{timeout:remaining()}),button.tap({timeout:remaining()})]));return {at:new Date().toISOString(),purpose:'fresh_cookie_prerequisite'};},writeObserved:async(id,observation)=>{result.actions[id]={...result.actions[id],status:'observed',observation};save(journal);}});
   await page.locator('.welcome-hero').waitFor({timeout:remaining()});entryGate=(await member.context.cookies(ORIGIN)).find(c=>c.name==='__Host-isp_acceptance');ensure(entryGate,'Fresh review cookie prerequisite required');
   await operation(()=>settleResourceBodies(responseBodies,ms=>new Promise(resolve=>setTimeout(resolve,ms)),()=>ensure(!deadlineHit&&Date.now()<window.deadline,'Fresh entry body drain exceeded deadline')));ensure(result.errors.length===0,'Fresh entry prerequisite failed');
  }
  await runRenderedJourneys({name,profile,page,continuation,gate:entryGate,context:member.context,viewport:devices[profile.device].viewport,runtime,fixtures,http,baseline:observations,check,evaluate,submit,go,audit,file,role,offline,api,
   scenario:async(id,reserveMs,reserveRequests,run)=>{phase=id;verifyWatchdog();
    const requiredRequests=queued?remainingCaseRequests(id):reserveRequests;
    if(!admitCase({deadline:window.deadline,requests:result.requests,reserveMs,reserveRequests:requiredRequests,requestLimit})){result.cases[id]={status:'DEFERRED',reason:'Insufficient complete-case time/request budget'};save(journal);throw new CoverageDeferred();}
    const start=Date.now();result.cases[id]={status:'RUNNING',started_at:new Date().toISOString(),...(queued?{request_admission:requiredRequests,case_request_bound:CASE_RESOURCE_DEMAND[id].requests}:{})};save(journal);
    try{await bounded(run,Math.min(reserveMs,remaining(reserveMs)));if(queued)await operation(()=>settleResourceBodies(responseBodies,ms=>new Promise(resolve=>setTimeout(resolve,ms)),()=>ensure(!deadlineHit&&Date.now()<window.deadline,'Resource body drain exceeded deadline')));ensure(result.errors.length===0&&Date.now()<window.deadline&&!deadlineHit&&result.requests<=requestLimit);result.cases[id]={...result.cases[id],status:'PASS',elapsed_ms:Date.now()-start};save(journal);}
    catch(e){deadlineHit=true;result.cases[id]={...result.cases[id],status:e instanceof CoverageDeferred?'DEFERRED':'FAIL',elapsed_ms:Date.now()-start};save(journal);throw e;}},
   capture:(key,value)=>{result.expected[key]=value;save(journal);},
   shot:async(p,label)=>{const path=CONTEXT.auditRoot+'/'+name+'-'+label+'.png';await operation(()=>p.screenshot({path,fullPage:true}),20000);result.screenshots.push(path);save(journal);},
   pause:ms=>operation(()=>new Promise(resolve=>setTimeout(resolve,ms)),ms+1000),
   nextOtp:async alias=>{const last=Math.max(http.actors[alias].last_otp_step||0,result.last_otp_step||0),step=Math.max(Math.floor(Date.now()/30000)+1,last+1),wait=step*30000+1000-Date.now();ensure(wait<61000&&remaining(wait+15000)>wait);await bounded(()=>new Promise(resolve=>setTimeout(resolve,wait)),wait+1000);result.last_otp_step=step;save(journal);return totp(http.actors[alias].totp_secret);}
  });
 }catch(error){
  deadlineHit=true;result.failure_phase=phase;result.failure=error instanceof CoverageDeferred?'DEFERRED':'FAIL';if(!(error instanceof CoverageDeferred))noteFailure('Browser operation or assertion failed');
  try{fs.writeFileSync(PRIVATE+'/'+name+'-failure.txt',String(error?.stack||error),{flag:'wx',mode:0o600});}catch{}
 }finally{
  freezeFailureBeforeCleanup(result,phase);closing=true;
  clearTimeout(timer);clearInterval(stopPoll);let closed=true;
  for(const ctx of contexts)try{await closeLinuxWebKitConnection(()=>ctx.close(),()=>{});}catch{closed=false;}
  if(browser)try{await closeLinuxWebKitConnection(()=>browser.close(),()=>{});}catch{closed=false;}
  if(browserServer)try{await closeLinuxWebKitConnection(()=>browserServer.close(),()=>{});}catch{closed=false;}
  result.cleanup=closed?'pass':'fail';if(!closed)noteFailure('Browser context/server cleanup failed');
  result.finished_at=new Date().toISOString();result.elapsed_ms=Date.parse(result.finished_at)-Date.parse(result.started_at);save(journal);
 }
 ensure(uiComplete(result),'Virtual profile incomplete; aggregate remains OPEN and mutation intents cannot be replayed');
 return {status:'UI_COMPLETE_AWAITING_RECONCILIATION',profile:name,run_marker:fixtures.run_marker,controller_pid:process.pid,browser_pid_windows:result.browser_pid_windows??null,aggregate:'OPEN'};
}
export function reconcileProfile(name,input){
 const journal=readPrivate('acceptance-mobile.json').value;matchingJournal(journal,input);const profile=journal.profiles[name];ensure(profile,'Profile has not run');
 const receipt=readPrivate('virtual-mobile-'+name+'-process.json').value;
 ensure(processReceiptMatches(profile,receipt,journal),'Exact controller/browser/server process absence receipt required');
 const proofName='virtual-mobile-'+name+'-db-proof.json',proofPath=PRIVATE+'/'+proofName,exists=fs.existsSync(proofPath);
 const proof=databaseProof(profile,input.observations,input.fixtures,{retainedRaw:exists?readPrivate(proofName).raw:undefined});
 if(!exists)durable(proofPath,input.observations,true);
 const retained=readPrivate(proofName);ensure(retained.raw===proof.raw&&sha256(retained.raw)===proof.sha256,'Retained DB proof bytes changed');
 profile.process_cleanup='pass';profile.db_reconciled=true;profile.status='PASS';profile.reconciled_at=new Date().toISOString();profile.db_observation_sha256=sha256(retained.raw);
 save(journal);return {status:aggregateStatus(journal),profile:name,profile_status:'PASS',run_marker:journal.run_marker};
}
export async function main(args=process.argv.slice(2)){
 const command=argumentsFor(args);if(command.mode==='plan'){console.log(encode({version:2,status:'OPEN',profiles:Object.keys(PROFILES),required_cases:REQUIRED_CASES,limits:LIMITS,automatic_retries:0,ordering:'execute one profile; fixture capture-ids/status; reconcile it; then next profile',executes:false}));return;}
 const input=readMobileInputs(command.profile,{watchdog:command.mode==='execute'}),lock=PRIVATE+'/acceptance-mobile.lock';let fd;
 try{fd=fs.openSync(lock,'wx',0o600);fs.writeFileSync(fd,encode({pid:process.pid,profile:command.profile,mode:command.mode,started_at:new Date().toISOString()}));fs.fsyncSync(fd);
  const result=command.mode==='execute'?await executeProfile(command.profile,input):reconcileProfile(command.profile,input);console.log(JSON.stringify(result));
 }finally{if(fd!==undefined){fs.closeSync(fd);fs.unlinkSync(lock);}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Virtual mobile acceptance refused or incomplete; aggregate OPEN. Inspect private evidence.');process.exitCode=1;});
