// Full rendered virtual-mobile coverage. Importing performs no I/O or network.
import {createHash,createHmac} from 'node:crypto';
export {QUEUED_MOBILE_MODE,QUEUED_MOBILE_LIMITS,MOBILE_RESOURCE_MODEL,RESOURCE_MODEL_SHA256,CASE_RESOURCE_DEMAND,PROFILE_RESOURCE_DEMAND,GLOBAL_RESOURCE_DEMAND} from './virtual-mobile-resources.mjs';
import {MOBILE_ONLY_BATCHES,mobileOnlySelectionMatches,FINAL_TAIL_BATCHES,finalTailMobileSelectionMatches,CONTINUATION_BATCHES,continuationMobileSelectionMatches} from './hosted-execution-phase.mjs';
export const ORIGIN=process.env.ISP_PRIVATE_ACCEPTANCE==='true'&&process.env.ISP_STAGING_LEASE==='rails-private-acceptance'?'https://isp-rails-startup.meithan-r.workers.dev':'https://isp-member-production.meithan-r.workers.dev';
export const LIMITS=Object.freeze({requests:180,profile_ms:420000,reconcile_reserve_ms:120000,ordinary_ms:20000,upload_ms:45000,pdf_bytes:1048576});
export const PROFILES=Object.freeze({'iphone-webkit':{device:'iPhone 13',engine:'webkit',admin:'admin_a'},'android-chromium':{device:'Pixel 7',engine:'chromium',admin:'admin_b'}});
export const REQUIRED_CASES=Object.freeze(['private_gate','landing_menu_keyboard','member_login','member_profile','consultation','administrator_mfa','discover_edit','event_edit_preview_publish','publication_edit_preview_publish','interest_repeat','protected_pdf_auth_hash','carousel_keyboard_accessibility','pwa','offline_privacy','responsive','logout_back','administrator_logout']);
const BATCHES=['identity','event-draft','event-publish','publication-draft','publication-publish','discover','engagement','event-republish','snapshot-withdraw','imports','critical-guards','critical-replace','logout','throttle'];
export class CoverageDeferred extends Error {}
export const ensure=(ok,message='Virtual mobile coverage refused')=>{if(!ok)throw Error(message);};
export const sha256=value=>createHash('sha256').update(value).digest('hex');
export const encode=value=>JSON.stringify(value,null,2)+'\n';
export function argumentsFor(args){
 if(JSON.stringify(args)===JSON.stringify(['--plan'])||args.length===0)return {mode:'plan'};
 ensure(args.length===3&&['--execute','--reconcile'].includes(args[0])&&args[1]==='--profile'&&Object.hasOwn(PROFILES,args[2]),'Use --execute or --reconcile with one exact --profile');return {mode:args[0].slice(2),profile:args[2]};
}
export function profileWindow(runtime,now=Date.now()){
 const start=Date.parse(runtime?.ISP_STAGING_START_AT),end=Date.parse(runtime?.ISP_STAGING_EXPIRES_AT),cutoff=end-600000;
 ensure(Number.isSafeInteger(now)&&Number.isFinite(start)&&Number.isFinite(end)&&end>start&&end-start<=3300000&&now>=start,'Fixed active mobile window required');
 if(now+LIMITS.profile_ms+LIMITS.reconcile_reserve_ms>cutoff)throw new CoverageDeferred('Full profile plus independent reconciliation no longer fits before cutoff');
 return Object.freeze({start,end,cutoff,deadline:Math.min(now+LIMITS.profile_ms,cutoff-LIMITS.reconcile_reserve_ms)});
}
export function admitCase({deadline,requests,now=Date.now(),reserveMs=20000,reserveRequests=4,requestLimit=LIMITS.requests}){
 return Number.isSafeInteger(now)&&Number.isSafeInteger(requests)&&requests>=0&&Number.isSafeInteger(requestLimit)&&requestLimit>0&&Number.isSafeInteger(reserveRequests)&&reserveRequests>=0&&requests+reserveRequests<=requestLimit&&now+reserveMs<deadline;
}
export function safeURL(value){
 const url=new URL(value,ORIGIN);ensure(url.origin===ORIGIN&&!url.username&&!url.password&&!url.hash&&url.href.length<=8192,'Only the fixed same-origin browser target is allowed');return url;
}
export function dependencies({profile,runtime,fixtures,http,phase,preparedHash,observations,prepared,carry,now=Date.now()}){
 ensure(Object.hasOwn(PROFILES,profile)&&fixtures?.phase==='active'&&/^qa-\d{8}-[a-f0-9]{12}$/.test(fixtures.run_marker));
 ensure(phase?.status==='selected_phase_complete'&&phase.mobile_eligible===true&&phase.phase==='functional'&&phase.run_marker===fixtures.run_marker&&phase.release?.prepared_release_sha256===preparedHash);
 const continuation=runtime?.ISP_ACCEPTANCE_CONTINUATION==='true',finalTail=prepared?.final_tail===true,mobileOnly=prepared?.mobile_only===true;
 ensure(JSON.stringify(phase.completed_batches)===JSON.stringify(mobileOnly?MOBILE_ONLY_BATCHES:finalTail?FINAL_TAIL_BATCHES:continuation?CONTINUATION_BATCHES:BATCHES)&&phase.selected_case_ids?.length===(mobileOnly?0:finalTail?2:continuation?33:42)&&new Set(phase.selected_case_ids).size===(mobileOnly?0:finalTail?2:continuation?33:42));
 if(mobileOnly)ensure(continuation&&mobileOnlySelectionMatches({phase,state:http,fixtures,prepared,carry}),'Forty-two sealed carried PASS with fresh reconciled bootstrap and browser prerequisites required');
 else if(finalTail)ensure(continuation&&finalTailMobileSelectionMatches({phase,state:http,fixtures,prepared,carry}),'Forty sealed carried PASS, two current PASS and reconciled fresh tail setup required');
 else if(continuation)ensure(continuationMobileSelectionMatches({phase,state:http,fixtures,prepared,carry}),'Nine sealed historical PASS and thirty-three current PASS with a fresh reconciled bootstrap are required');
 else ensure(http?.continuation!==true&&!http?.historical_carry,'Continuation evidence cannot enter a different execution mode');
 const leaseId=runtime?.ISP_STAGING_LEASE;
 ensure((!continuation||leaseId==='rails-private-acceptance')&&['rails-staging-2','rails-staging-3','rails-private-acceptance'].includes(leaseId)&&fixtures.lease_id===leaseId&&phase.lease_id===leaseId&&phase.release?.lease_id===leaseId,'Exact selected mobile lease required');
 ensure(http?.lease_id===leaseId&&http.prepared_release_sha256===preparedHash&&http.run_marker===fixtures.run_marker&&http.candidate===runtime.CANDIDATE_COMMIT&&http.deployment_id===runtime.CLOUDFLARE_DEPLOYMENT_ID&&JSON.stringify(http.target)===JSON.stringify(fixtures.target)&&!http.halted&&!http.running_batch);
 ensure(phase.selected_case_ids.every(id=>http.cases?.[id]?.status==='PASS'&&http.cases[id].http==='PASS'),'All selected HTTP cases need independent reconciliation');
 const admin=PROFILES[profile].admin,member=fixtures.actors?.member_b,a=fixtures.actors?.[admin];
 ensure(Number.isSafeInteger(member?.id)&&member.id>0&&member.role==='member'&&typeof member.email==='string'&&typeof member.password==='string'&&Number.isSafeInteger(a?.id)&&a.id>0&&a.role==='admin'&&typeof a.password==='string');
 ensure(/^[A-Z2-7]{16,64}$/.test(http.actors?.[admin]?.totp_secret||''),'Actual protected HTTP enrollment state required');
 ensure((mobileOnly||finalTail||/^[a-f0-9]{16}$/.test(http.event?.slug||''))&&/^[a-f0-9]{16}$/.test(http.publication?.slug||'')&&Number.isSafeInteger(http.discover?.id)&&http.discover.id>0);
 ensure(observations?.version===1&&observations.lease_id===leaseId&&observations.phase==='active'&&observations.run_marker===fixtures.run_marker&&JSON.stringify(observations.target)===JSON.stringify(fixtures.target));
 const captured=Date.parse(observations.captured_at);ensure(Number.isFinite(captured)&&captured>=Date.parse(fixtures.captured_at||phase.started_at||phase.finished_at)&&captured<=now+5000,'Fresh pre-browser observations required');
 ensure(observations.actors?.member_b?.id===member.id&&observations.actors.member_b.email===member.email&&observations.actors.member_b.role==='member'&&observations.actors[admin]?.id===a.id&&observations.actors[admin].mfa_enabled===true);
 ensure((mobileOnly||finalTail||observations.events?.some(x=>x.slug===http.event.slug&&x.published_title))&&observations.publications?.some(x=>x.slug===http.publication.slug&&/^[a-f0-9]{64}$/.test(x.pdf_sha256))&&observations.discover?.some(x=>x.id===http.discover.id&&x.position===1));
 return {admin,memberId:member.id,adminId:a.id};
}
const MUTATIONS={review_access:['/__isp_review','post'],member_login:['/session','post'],administrator_login:['/session','post'],administrator_factor:['/two-factor','post'],member_profile:['/member/profile','patch'],consultation:['/member/consultation_requests','post'],event_draft:[/^\/admin\/events$/,'post'],event_preview:[/^\/admin\/events\/[a-f0-9]{16}$/,'patch'],event_publish:[/^\/admin\/events\/[a-f0-9]{16}\/publish$/,'post'],publication_draft:['/admin/publications','post'],publication_preview:[/^\/admin\/publications\/[a-f0-9]{16}$/,'patch'],publication_publish:[/^\/admin\/publications\/[a-f0-9]{16}\/publish$/,'post'],discover_save:[/^\/admin\/discover\/[1-9][0-9]*$/,'patch'],interest_first:[/^\/events\/[a-f0-9]{16}\/interest$/,'post'],interest_repeat:[/^\/events\/[a-f0-9]{16}\/interest$/,'post'],member_logout:['/session','delete'],administrator_logout:['/session','delete']};
export function mutationTarget(id,form){
 const expected=MUTATIONS[id],url=safeURL(form?.action);ensure(expected&&form.method?.toLowerCase()==='post'&&(id==='review_access'?form.csrf===false&&form.review_key===true:form.csrf===true)&&(typeof expected[0]==='string'?url.pathname===expected[0]:expected[0].test(url.pathname))&&(form.override||'post').toLowerCase()===expected[1],'Rendered form contract differs from reviewed mutation');
 return {path:url.pathname,method:expected[1],lock_version:form.lock_version??null,revision:form.revision??null};
}
export async function submitOnce({id,form,writeIntent,perform,writeObserved}){
 const contract=mutationTarget(id,form);await writeIntent(id,contract);const result=await perform();await writeObserved(id,result);return result;
}
export function totp(secret,time=Date.now()){
 ensure(/^[A-Z2-7]{16,64}$/.test(secret));const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='',raw=[];
 for(const c of secret)bits+=alphabet.indexOf(c).toString(2).padStart(5,'0');for(let i=0;i+8<=bits.length;i+=8)raw.push(parseInt(bits.slice(i,i+8),2));
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(time/30000)));const digest=createHmac('sha1',Buffer.from(raw)).update(counter).digest(),offset=digest[19]&15;return ((digest.readUInt32BE(offset)&0x7fffffff)%1000000).toString().padStart(6,'0');
}
export function benignPdf(marker){
 ensure(typeof marker==='string'&&marker.length<=160);const stream='BT /F1 12 Tf 30 90 Td ('+marker.replace(/[^\w -]/g,'')+' synthetic mobile fixture) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 150] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+Buffer.byteLength(stream)+' >>\nstream\n'+stream+'\nendstream'];let text='%PDF-1.4\n',offsets=[];
 objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(text));text+=(i+1)+' 0 obj\n'+o+'\nendobj\n';});const xref=Buffer.byteLength(text);text+='xref\n0 6\n0000000000 65535 f \n'+offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';return Buffer.from(text);
}
export const cleanPng=()=>Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYZkAAAAASUVORK5CYII=','base64');
export function verifyFile(meta,body,expectedHash,type){
 ensure(Buffer.isBuffer(body)&&body.length>0&&body.length<=LIMITS.pdf_bytes&&meta.status===200&&String(meta.type).split(';')[0]===type&&/no-store/i.test(meta.cache||'')&&sha256(body)===expectedHash,'Protected browser file bytes or headers differ');
 if(type==='application/pdf')ensure(/attachment/i.test(meta.disposition||'')&&body.subarray(0,5).toString()==='%PDF-');return true;
}
export const REQUIRED_MUTATIONS=Object.freeze(Object.keys(MUTATIONS));
export function uiComplete(profile){return REQUIRED_MUTATIONS.every(id=>profile.actions?.[id]?.status==='observed')&&REQUIRED_CASES.every(id=>profile.cases?.[id]?.status==='PASS')&&profile.cleanup==='pass'&&profile.errors?.length===0&&Object.values(profile.actions||{}).every(a=>a.status==='observed');}
export function databaseMatches(profile,obs,fixtures){
 if(!['rails-staging-2','rails-staging-3','rails-private-acceptance'].includes(fixtures?.lease_id)||profile?.lease_id!==fixtures.lease_id||obs?.lease_id!==fixtures.lease_id||!uiComplete(profile)||obs?.version!==1||obs.phase!=='active'||obs.run_marker!==fixtures.run_marker||JSON.stringify(obs.target)!==JSON.stringify(fixtures.target)||!Number.isFinite(Date.parse(obs.captured_at))||!Number.isFinite(Date.parse(profile.finished_at))||Date.parse(obs.captured_at)<Date.parse(profile.finished_at))return false;
 const e=profile.expected,m=obs.actors?.member_b,a=obs.actors?.[profile.admin];
 if(!e||!m||!a||m.id!==fixtures.actors.member_b.id||m.email!==fixtures.actors.member_b.email||m.role!=='member'||m.account_status!=='active'||Object.entries(e.profile).some(([k,v])=>m[k]!==v)||a.id!==fixtures.actors[profile.admin].id||a.mfa_enabled!==true||a.usable_challenge_count!==0)return false;
 for(const alias of ['member_b',profile.admin]){const baseline=new Set(profile.baseline_sessions?.[alias]||[]);if(!Array.isArray(obs.actors[alias].sessions)||obs.actors[alias].sessions.some(x=>!baseline.has(x.id)))return false;}
 const consultations=obs.consultations?.filter(x=>x.id===e.consultation.id&&x.user_id===m.id&&x.request_key===e.consultation.request_key&&x.subject===e.consultation.subject&&x.message===e.consultation.message&&x.category===e.consultation.category);if(consultations?.length!==1)return false;
 const event=obs.events?.find(x=>x.slug===e.event.slug);if(!event||event.draft_title!==e.event.title||event.published_title!==e.event.title||event.published_revision!==e.event.revision||event.published_data?.admission!=='free'||event.published_data?.images?.length!==1||event.published_data.brochure?.name!==e.event.brochure_name)return false;
 const interests=event.interests?.filter(x=>x.user_id===m.id);if(interests?.length!==1||interests[0].company!==e.interest.company||interests[0].event_revision!==e.event.revision||interests[0].event_snapshot?.title!==e.event.title)return false;
 const pub=obs.publications?.find(x=>x.slug===e.publication.slug);if(!pub||pub.published_title!==e.publication.title||pub.draft_title!==e.publication.title||pub.published_revision!==e.publication.revision||pub.pdf_sha256!==e.publication.pdf_sha256||pub.cover_sha256!==e.publication.cover_sha256||pub.pdf?.scan_status!=='clean'||pub.cover?.scan_status!=='clean')return false;
 const slide=obs.discover?.find(x=>x.id===e.discover.id);if(!slide||Object.entries(e.discover.fields).some(([k,v])=>slide[k]!==v)||!Number.isSafeInteger(slide.image_blob_id)||slide.image_blob_id<=0||slide.image_blob_id===e.discover.previous_image_blob_id)return false;
 return true;
}
export function databaseProof(profile,observations,fixtures,{retainedRaw,now=Date.now()}={}){
 ensure(databaseMatches(profile,observations,fixtures),'UI complete plus new independent DB state/hash observations required');
 ensure(Date.parse(observations.captured_at)<=now+5000,'Future DB observations refused');
 const raw=encode(observations);
 ensure(retainedRaw===undefined||retainedRaw===raw,'Immutable DB proof differs; original evidence cannot be rebound to a later capture');
 return {raw,sha256:sha256(raw)};
}
export function processReceiptMatches(profile,receipt,journal){
 if(!['rails-staging-2','rails-staging-3','rails-private-acceptance'].includes(journal?.lease_id)||profile?.lease_id!==journal.lease_id||receipt?.lease_id!==journal.lease_id||receipt?.version!==1||receipt.status!=='UI_COMPLETE_AWAITING_RECONCILIATION'||receipt.profile!==profile.name||receipt.run_marker!==journal.run_marker||receipt.controller_pid!==profile.controller_pid||receipt.controller_exit_code!==0||receipt.controller_exited!==true||receipt.browser_absent!==true||!Number.isFinite(Date.parse(receipt.observed_at))||!Number.isFinite(Date.parse(profile.finished_at))||Date.parse(receipt.observed_at)<Date.parse(profile.finished_at))return false;
 if(profile.name==='iphone-webkit')return receipt.server_id===profile.server_id&&receipt.server_pid_linux===profile.server_pid_linux&&receipt.server_pid_linux>0&&receipt.browser_pid_linux>0&&receipt.server_pid_linux!==receipt.browser_pid_linux&&receipt.server_absent===true&&receipt.wsl_child_exited===true&&receipt.wsl_child_exit_code===0;
 return Number.isSafeInteger(receipt.browser_pid_windows)&&receipt.browser_pid_windows===profile.browser_pid_windows&&receipt.browser_pid_windows>0;
}
export function aggregateStatus(journal){
 return ['rails-staging-2','rails-staging-3','rails-private-acceptance'].includes(journal?.lease_id)&&Object.keys(PROFILES).every(name=>journal.profiles?.[name]?.lease_id===journal.lease_id&&journal.profiles[name]?.status==='PASS'&&journal.profiles[name].db_reconciled===true&&journal.profiles[name].process_cleanup==='pass'&&uiComplete(journal.profiles[name]))?'PASS':'OPEN';
}
async function fields(form,prefix,values){
 for(const [name,value] of Object.entries(values)){const input=form.locator('[name="'+prefix+'['+name+']"]');const tag=await input.evaluate(el=>el.tagName);if(tag==='SELECT')await input.selectOption(value);else await input.fill(value);}
}
export const JOURNEY_CALLBACKS=Object.freeze(['check','evaluate','submit','go','audit','file','role','offline','api','scenario','capture','shot','pause','nextOtp']);
export function assertJourneyHarness(h){
 ensure(h&&typeof h==='object','Rendered journey harness required');
 for(const key of JOURNEY_CALLBACKS)ensure(typeof h[key]==='function','Rendered journey callback missing: '+key);
 return h;
}
export async function activateSkipLink(page,{timeoutMs=5000}={}){
 ensure(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=5000,'Bounded skip-link focus wait required');
 await page.getByRole('link',{name:'Skip to content',exact:true}).focus();await page.keyboard.press('Enter');
 // Turbo completes same-page fragment navigation asynchronously. Observe the
 // browser's real focus result; never set focus on the destination for it.
 await page.waitForFunction(()=>{const main=document.querySelector('main#main');return !!main&&document.activeElement===main&&location.hash==='#main';},undefined,{timeout:timeoutMs});
}
export async function runRenderedJourneys(h){
 assertJourneyHarness(h);
 const {page,context,fixtures,http,name,profile}=h,mark=fixtures.run_marker,label=mark+' '+name,png=cleanPng(),pdf=benignPdf(label+' publication'),eventPdf=benignPdf(label+' event');let admin,guest,event,pub;
 const resumed=h.continuation?.profiles?.[name],carriedGate=resumed?.cases?.private_gate,resumeSkip=!!carriedGate;
 if(resumeSkip)ensure(h.continuation.version===1&&name==='iphone-webkit'&&carriedGate.status==='PASS_CARRIED'&&carriedGate.original_status==='PASS'&&/^[a-f0-9]{64}$/.test(carriedGate.original_case_sha256??'')&&resumed.resume_case==='landing_menu_keyboard'&&resumed.resume_at==='skip_link_focus'&&resumed.failed_case_carried===false&&h.gate,'Exact carried gate and operational review entry required');
 const payload=(kind,buffer,mime)=>({name:mark+'-'+name+'-'+kind,mimeType:mime,buffer});
 if(!resumeSkip)await h.scenario('private_gate',30000,8,async()=>{
  const r=await page.goto(ORIGIN+'/__isp_review');h.check(r?.status()===200,'Private review form renders');await page.getByLabel('Review access code',{exact:true}).fill(h.runtime.ISP_STAGING_KEY);
  await h.submit('review_access',page,page.getByRole('button',{name:'Open private review',exact:true}));await page.waitForURL(ORIGIN+'/');await page.locator('.welcome-hero').waitFor();
  const gate=(await context.cookies(ORIGIN)).find(c=>c.name==='__Host-isp_acceptance');h.check(gate?.secure&&gate.httpOnly&&gate.sameSite==='Strict'&&!gate.value.includes(h.runtime.ISP_STAGING_KEY)&&gate.expires*1000<=Date.parse(h.runtime.ISP_STAGING_EXPIRES_AT)+1000,'Rendered secure fixed-expiry review cookie accepted');h.gate=gate;
 });
 await h.scenario('landing_menu_keyboard',30000,5,async()=>{
  if(!resumeSkip){
  await h.evaluate(page,()=>document.fonts.ready);h.check(await page.locator('img[alt="Official ISP crest"]').count()===1,'Official crest rendered');
  const menu=page.getByLabel('Explore ISP menu',{exact:true});await menu.tap();await page.getByRole('navigation',{name:'Explore ISP',exact:true}).waitFor();const box=await menu.boundingBox();h.check(box&&box.width>=44&&box.height>=44&&box.x>h.viewport.width/2,'Top-right menu provides a44px touch target');
  h.check((await page.getByRole('link',{name:/ISP shop/}).innerText()).includes('DEMO')&&(await page.getByRole('link',{name:/Plantation jobs/}).innerText()).includes('DEMO'),'Frozen demo references labelled; never opened');
  h.check(await page.getByRole('link',{name:/ISP Academy|Community forum/}).count()===0,'Removed areas absent');
  await menu.press('Escape');h.check(await menu.getAttribute('aria-expanded')==='false'&&await menu.evaluate(el=>el===document.activeElement),'Escape closes menu and restores focus');
  await menu.press('Enter');h.check(await menu.getAttribute('aria-expanded')==='true','Keyboard opens navigation');await menu.press('Escape');
  }
  await activateSkipLink(page);h.check(await h.evaluate(page,()=>document.activeElement?.id==='main'),'Skip link moves keyboard focus to main');await h.audit(page);await h.shot(page,'landing');
 });
 await h.scenario('member_login',45000,18,async()=>{
  await h.go(page,'/login','.account-login');await page.getByLabel('Email address',{exact:true}).fill(fixtures.actors.member_b.email);await page.getByLabel('Password',{exact:true}).fill(fixtures.actors.member_b.password);await h.submit('member_login',page,page.getByRole('button',{name:'Sign in',exact:false}));await page.waitForURL(ORIGIN+'/member/dashboard');await page.locator('.member-home').waitFor();await h.audit(page);await h.shot(page,'dashboard');
 });
 await h.scenario('member_profile',40000,8,async()=>{
  await h.go(page,'/member/profile/edit','.profile-edit');const f=page.locator('form[action="/member/profile"]');h.check(await f.getByLabel('Email address',{exact:true}).isDisabled(),'Login email remains noneditable');
  const values={name:label+' member',company:label+' estate',branch:'Synthetic mobile branch',phone:'+60000000000'};await fields(f,'user',values);await h.audit(page);await h.submit('member_profile',page,f.getByRole('button',{name:'Save profile',exact:true}));await page.waitForURL(ORIGIN+'/member/dashboard');await page.locator('.profile-card').getByRole('heading',{name:values.name,exact:true}).waitFor();
  await h.go(page,'/member/profile/edit','.profile-edit');for(const [key,value] of Object.entries(values))h.check(await page.locator('[name="user['+key+']"]').inputValue()===value,'Saved profile field persisted on a fresh rendered request');h.capture('profile',values);await h.go(page,'/member/membership','.membership-page');h.check(typeof fixtures.actors.member_b.member_reference==='string'&&(await page.locator('.profile-details').innerText()).includes(fixtures.actors.member_b.member_reference),'Membership renders actual stored reference with leading zeros');h.check(await page.getByRole('link',{name:/CPD|Renew|Upgrade tier/i}).count()===0,'Unsupported membership actions absent');await h.audit(page);
 });
 await h.scenario('consultation',40000,8,async()=>{
  await h.go(page,'/member/consultation_requests/new','.consultation-page');const f=page.locator('form[action="/member/consultation_requests"]'),requestKey=await f.locator('[name="consultation_request[request_key]"]').inputValue();h.check(/^[a-f0-9-]{36}$/.test(requestKey),'Actual enquiry idempotency key present');
  const values={category:'Other enquiry',subject:label+' enquiry',message:'Synthetic browser enquiry only. No appointment or delivery is promised.'};await fields(f,'consultation_request',values);await f.getByLabel('Your question',{exact:true}).tap();h.check(await h.evaluate(page,()=>document.activeElement?.tagName==='TEXTAREA'),'Touch focuses enquiry input');await h.submit('consultation',page,f.getByRole('button',{name:'Send enquiry',exact:true}));await page.waitForURL(/\/member\/consultation_requests\/[1-9][0-9]*$/);const id=Number(new URL(page.url()).pathname.split('/').at(-1));await page.getByRole('heading',{name:values.subject,exact:true}).waitFor();h.check((await page.locator('.query-message').innerText()).includes(values.message),'Saved enquiry renders submitted text');await h.go(page,'/member/consultation_requests','.query-history');await page.getByRole('link').filter({hasText:values.subject}).waitFor();h.capture('consultation',{id,request_key:requestKey,...values});await h.shot(page,'consultation');
 });
 await h.scenario('administrator_mfa',90000,25,async()=>{
  admin=await h.role('administrator',h.gate);await h.go(admin.page,'/login','.account-login');const actor=fixtures.actors[profile.admin];await admin.page.getByLabel('Email address',{exact:true}).fill(actor.email);await admin.page.getByLabel('Password',{exact:true}).fill(actor.password);await h.submit('administrator_login',admin.page,admin.page.getByRole('button',{name:'Sign in',exact:false}));await admin.page.waitForURL(ORIGIN+'/two-factor');await admin.page.locator('[name="otp_code"]').waitFor();h.check(await admin.page.locator('.auth-setup-key').count()===0,'Existing enrolled administrator uses actual factor challenge');
  const pending=await h.api(admin.context,'/admin/events');h.check([302,303].includes(pending.status())&&new URL(pending.headers().location,ORIGIN).pathname==='/login','Pending MFA cannot open admin workspace');
  const code=await h.nextOtp(profile.admin);await admin.page.locator('[name="otp_code"]').fill(code);await h.submit('administrator_factor',admin.page,admin.page.getByRole('button',{name:'Verify and continue',exact:true}));await admin.page.waitForURL(ORIGIN+'/admin/events');await admin.page.locator('.admin-home').waitFor();await h.audit(admin.page);
  guest=await h.role('guest',h.gate,{page:false});
 });
 await h.scenario('discover_edit',50000,12,async()=>{
  await h.go(admin.page,'/admin/discover','.discover-admin');const id=http.discover.id,f=admin.page.locator('#discover-form-'+id),original=h.baseline.discover.find(x=>x.id===id);
  const values={tag:'Synthetic mobile',title:label+' Discover',description:'Synthetic browser card; no demo development.',website_url:'https://www.isp.org.my/?qa='+mark+'&profile='+name,image_alt:'Synthetic mobile acceptance image'};
  await fields(f,'discover_slide',values);await f.locator('[name="discover_slide[image]"]').setInputFiles(payload('discover.png',png,'image/png'));
  h.check((await admin.page.locator('#discover-card-'+id+' [data-discover-editor-target="title"]').innerText())===values.title,'Discover inline preview reflects actual input');
  await h.audit(admin.page);await h.submit('discover_save',admin.page,f.getByRole('button',{name:/^Save card /}),{upload:true});await admin.page.waitForURL(url=>url.pathname==='/admin/discover');
  await h.go(page,'/','.discover-card');h.check(await page.locator('.discover-card h3').filter({hasText:values.title}).count()===1,'Saved Discover card appears through independent member rendering');const card=page.locator('.discover-card').filter({has:page.getByRole('heading',{name:values.title,exact:true})});const link=card.locator('a');h.check(await link.getAttribute('href')===values.website_url&&/noopener/.test(await link.getAttribute('rel')||''),'Exact safe external CTA retained without navigating it');
  await h.file(page,await card.locator('img').getAttribute('src'),sha256(png),'image/png','discover.png');h.capture('discover',{id,fields:values,previous_image_blob_id:original.image_blob_id});
 });
 await h.scenario('event_edit_preview_publish',90000,22,async()=>{
  await h.go(admin.page,'/admin/events/new','.event-editor');let f=admin.page.locator('form[action="/admin/events"]');const first=label+' event draft',title=label+' event',values={title:first,format:'Workshop',summary:'Synthetic mobile workshop',description:'Synthetic event. No real attendance or payment.',date:new Date(Date.now()+7*86400000).toISOString().slice(0,10),starts_at:'09:00',ends_at:'10:00',timezone:'Asia/Kuala_Lumpur',venue:'Synthetic online venue',admission:'free'};
  await fields(f,'event',values);await h.submit('event_draft',admin.page,f.getByRole('button',{name:'Save draft & close',exact:true}));await admin.page.waitForURL(ORIGIN+'/admin/events');const row=admin.page.locator('.admin-event-row').filter({has:admin.page.getByRole('heading',{name:first,exact:true})}),edit=row.getByRole('link',{name:'Edit draft',exact:true}),url=safeURL(await edit.getAttribute('href'));event={slug:url.pathname.split('/')[3],title,brochure_name:payload('event.pdf',eventPdf,'application/pdf').name};
  await edit.tap();await admin.page.waitForURL(url.href);f=admin.page.locator('form[action="/admin/events/'+event.slug+'"]');h.check(await f.locator('[name="event[title]"]').inputValue()===first,'Saved private event draft reopens');await fields(f,'event',{title});await f.locator('[name="event[images][]"]').setInputFiles(payload('event.png',png,'image/png'));await f.locator('[name="event[brochure]"]').setInputFiles(payload('event.pdf',eventPdf,'application/pdf'));await h.audit(admin.page);
  await h.submit('event_preview',admin.page,f.getByRole('button',{name:/^Preview event/}),{upload:true});await admin.page.waitForURL(ORIGIN+'/admin/events/'+event.slug+'/preview');await admin.page.getByRole('heading',{name:title,exact:true}).waitFor();event.revision=Number(await admin.page.locator('[data-event-revision]').getAttribute('data-event-revision'));
  h.check((await h.api(guest.context,'/events/'+event.slug)).status()===404,'Unpublished mobile event remains private');await h.submit('event_publish',admin.page,admin.page.getByRole('button',{name:'Publish event',exact:true}).last());await admin.page.waitForURL(ORIGIN+'/events/'+event.slug);
  await h.go(page,'/events/'+event.slug,'.public-event-detail');await page.getByRole('heading',{name:title,exact:true}).waitFor();h.check((await page.locator('.event-fact-list').innerText()).includes('No payment required.'),'Reviewed free event publishes without payment claim');await h.file(page,await page.getByRole('link',{name:/Open PDF brochure/}).getAttribute('href'),sha256(eventPdf),'application/pdf','event.pdf');h.capture('event',event);
 });
 await h.scenario('publication_edit_preview_publish',90000,22,async()=>{
  await h.go(admin.page,'/admin/publications/new','.publication-form');let f=admin.page.locator('.publication-form');const first=label+' publication draft',title=label+' publication';
  await fields(f,'publication',{title:first,subtitle:'Synthetic mobile issue',author:'Synthetic acceptance',issue_date:new Date().toISOString().slice(0,10),description:'Synthetic mobile member publication with a harmless controlled PDF.'});await h.submit('publication_draft',admin.page,f.getByRole('button',{name:'Save draft',exact:true}));await admin.page.waitForURL(ORIGIN+'/admin/publications');
  const row=admin.page.locator('.publication-admin-card').filter({has:admin.page.getByRole('heading',{name:first,exact:true})}),edit=row.getByRole('link',{name:'Edit publication',exact:true}),url=safeURL(await edit.getAttribute('href'));pub={slug:url.pathname.split('/')[3],title,pdf_sha256:sha256(pdf),cover_sha256:sha256(png)};
  await edit.tap();await admin.page.waitForURL(url.href);f=admin.page.locator('.publication-form');h.check(await f.locator('[name="publication[title]"]').inputValue()===first,'Saved private publication draft reopens');await fields(f,'publication',{title});await f.locator('[name="publication[pdf]"]').setInputFiles(payload('publication.pdf',pdf,'application/pdf'));await f.locator('[name="publication[cover]"]').setInputFiles(payload('cover.png',png,'image/png'));await h.audit(admin.page);
  await h.submit('publication_preview',admin.page,f.getByRole('button',{name:'Save & preview',exact:true}),{upload:true});await admin.page.waitForURL(ORIGIN+'/admin/publications/'+pub.slug+'/preview');await admin.page.getByRole('heading',{name:title,exact:true}).waitFor();const publish=admin.page.locator('form[action="/admin/publications/'+pub.slug+'/publish"]');pub.revision=Number(await publish.locator('[name="revision"]').inputValue());
  const preview=safeURL(await admin.page.getByRole('link',{name:/Download PDF/}).getAttribute('href'));h.check((await h.api(context,'/member/publications/'+pub.slug)).status()===404,'Draft issue remains absent from member library');h.check([302,303].includes((await h.api(guest.context,preview.href)).status()),'Guest cannot read protected draft PDF');h.check((await h.api(context,preview.href)).status()===403,'Member cannot read admin preview PDF');await h.file(admin.page,preview.href,pub.pdf_sha256,'application/pdf','preview.pdf');
  await h.submit('publication_publish',admin.page,publish.getByRole('button',{name:'Publish to members',exact:true}));await admin.page.waitForURL(ORIGIN+'/admin/publications');h.capture('publication',pub);
 });
 await h.scenario('interest_repeat',45000,10,async()=>{
  const values={name:label+' interest',email:fixtures.actors.member_b.email,company:label+' submitted estate'};
  for(const id of ['interest_first','interest_repeat']){await h.go(page,'/events/'+event.slug+'/interest/new','.interest-form');const f=page.locator('form[action="/events/'+event.slug+'/interest"]');await fields(f,'event_interest',values);await h.submit(id,page,f.getByRole('button',{name:'Register interest',exact:true}));await page.waitForURL(ORIGIN+'/events/'+event.slug);await page.locator('.interest-confirmation').waitFor();}
  await h.go(page,'/member/dashboard','.member-home');h.check(await page.locator('.interest-card').filter({has:page.getByRole('heading',{name:event.title,exact:true})}).count()===1,'Repeated rendered registration leaves one visible saved interest');h.capture('interest',values);await h.go(admin.page,'/admin/events/'+event.slug+'/interests','.event-interest-roster');h.check(await admin.page.locator('.event-interest-card').count()===1&&(await admin.page.locator('.event-interest-card').innerText()).includes(values.email)&&(await admin.page.locator('.event-interest-card').innerText()).includes(values.company),'Actual administrator roster shows the one submitted member contact');await h.audit(admin.page);
 });
 await h.scenario('protected_pdf_auth_hash',45000,12,async()=>{
  await h.go(page,'/member/publications/'+pub.slug,'.publication-detail');await page.getByRole('heading',{name:pub.title,exact:true}).waitFor();const url=safeURL(await page.getByRole('link',{name:/Download PDF/}).getAttribute('href'));await h.file(page,url.href,pub.pdf_sha256,'application/pdf','published.pdf');
  h.check([302,303].includes((await h.api(guest.context,url.href)).status()),'Guest cannot download member PDF');h.check((await h.api(admin.context,url.href)).status()===403,'Administrator cannot bypass member-only file boundary');
  const wrong=new URL(url);wrong.pathname=wrong.pathname.replace('/files/pdf/','/files/unknown/');h.check((await h.api(context,wrong.href)).status()===404,'Wrong file kind denied');const cross=new URL(url);cross.pathname=cross.pathname.replace('/'+pub.slug+'/','/'+http.publication.slug+'/');h.check((await h.api(context,cross.href)).status()===404,'Cross-publication signed file denied');const bad=new URL(url);bad.pathname=bad.pathname.replace(/[^/]+$/,'invalid-key');h.check((await h.api(context,bad.href)).status()===404,'Invalid signed file denied');
  const old=(http.publication.preview_links||[]).find(x=>/\/files\/pdf\//.test(x));h.check(old,'Actual superseded PDF fixture key required');const stale=safeURL(old);stale.pathname=stale.pathname.replace('/admin/publications/','/member/publications/');stale.search='';h.check((await h.api(context,stale.href)).status()===404,'Superseded published PDF key denied');
 });
 await h.scenario('carousel_keyboard_accessibility',30000,5,async()=>{
  await h.go(page,'/','.discover-section');const slides=page.locator('.discover-card'),count=await slides.count(),next=page.getByRole('button',{name:'Next slide',exact:true});h.check(count>=2,'Multiple actual Discover slides available');
  h.check(await page.getByRole('button',{name:'Start automatic slide rotation',exact:true}).getAttribute('aria-pressed')==='true','Reduced motion starts carousel paused');await next.tap();await next.focus();await next.press('Home');h.check(await slides.first().isVisible(),'Home selects first slide');await next.press('End');h.check(await slides.last().isVisible(),'End selects final slide');await next.press('ArrowRight');h.check(await slides.first().isVisible(),'ArrowRight wraps final to first');await next.press('ArrowLeft');h.check(await slides.last().isVisible(),'ArrowLeft wraps first to final');await page.getByRole('button',{name:'Show slide 1',exact:true}).press('Enter');h.check(await slides.first().isVisible()&&await page.locator('.discover-card:visible').count()===1,'Keyboard dot selects exactly one slide');
  h.check((await page.locator('[aria-live="polite"]').innerText()).includes('Slide 1 of '+count),'Carousel announces keyboard selection');
  await page.getByRole('button',{name:'Start automatic slide rotation',exact:true}).tap();await next.focus();const before=await page.locator('.discover-card:visible').innerText();await h.pause(9000);h.check(await page.locator('.discover-card:visible').innerText()===before,'Carousel pauses while keyboard focus is inside');await page.getByRole('button',{name:'Pause automatic slide rotation',exact:true}).tap();await h.audit(page);
 });
 await h.scenario('pwa',20000,4,async()=>{
  const response=await h.api(context,'/manifest.json');h.check(response.status()===200,'PWA manifest loads');const m=await response.json();h.check(m.display==='standalone'&&m.icons?.some(x=>x.sizes==='192x192')&&m.icons.some(x=>x.sizes==='512x512'),'Standalone manifest includes required icons');
  await page.waitForFunction(()=>!!navigator.serviceWorker?.controller,undefined,{timeout:12000});const state=await h.evaluate(page,async()=>({controlled:!!navigator.serviceWorker.controller,keys:await caches.keys()}));h.check(state.controlled&&state.keys.length===0,'Service worker controls page without private CacheStorage');
 });
 await h.scenario('offline_privacy',30000,5,()=>h.offline(page,context));
 await h.scenario('responsive',20000,4,async()=>{
  await h.go(page,'/member/dashboard','.member-home');await page.setViewportSize({width:320,height:740});await h.audit(page);await h.shot(page,'dashboard-320');await page.setViewportSize(h.viewport);
  await h.go(admin.page,'/admin/events/'+event.slug+'/edit','.event-editor');await admin.page.setViewportSize({width:320,height:740});await h.audit(admin.page);await admin.page.setViewportSize(h.viewport);
 });
 await h.scenario('logout_back',30000,8,async()=>{
  await h.go(page,'/member/dashboard','.member-home');const captured=await context.cookies(ORIGIN);await page.getByLabel('Explore ISP menu',{exact:true}).tap();await h.submit('member_logout',page,page.getByRole('button',{name:'Sign out',exact:true}));await page.waitForURL(ORIGIN+'/');await page.locator('.welcome-hero').waitFor();
  await page.goBack({waitUntil:'domcontentloaded',timeout:20000});h.check(await page.locator('.member-home,.profile-edit,.profile-card').count()===0,'Back after logout cannot render private member DOM');await page.waitForURL(url=>url.pathname==='/login'||url.pathname==='/');h.check(!(await page.locator('main').innerText()).includes(label+' estate'),'Back view contains no private organisation');
  h.check([302,303].includes((await h.api(context,'/member/dashboard')).status()),'Logged-out browser session cannot reopen dashboard');const replay=await h.role('replayed-cookie',null,{page:false,cookies:captured});h.check([302,303].includes((await h.api(replay.context,'/member/dashboard')).status()),'Captured pre-logout cookie is revoked on server');
 });
 await h.scenario('administrator_logout',20000,5,async()=>{
  await h.go(admin.page,'/admin/events','.admin-home');await admin.page.getByLabel('Explore ISP menu',{exact:true}).tap();await h.submit('administrator_logout',admin.page,admin.page.getByRole('button',{name:'Sign out',exact:true}));await admin.page.waitForURL(ORIGIN+'/');h.check([302,303].includes((await h.api(admin.context,'/admin/events')).status()),'Rendered administrator sign-out revokes its session');
 });
}
