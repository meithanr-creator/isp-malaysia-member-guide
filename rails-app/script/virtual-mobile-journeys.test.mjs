import test from 'node:test';
import assert from 'node:assert/strict';
import {argumentsFor,profileWindow,admitCase,CoverageDeferred,dependencies,mutationTarget,submitOnce,totp,benignPdf,sha256,verifyFile,uiComplete,databaseMatches,databaseProof,encode,processReceiptMatches,aggregateStatus,REQUIRED_CASES,REQUIRED_MUTATIONS,ORIGIN,safeURL,JOURNEY_CALLBACKS,assertJourneyHarness,runRenderedJourneys} from './virtual-mobile-journeys.mjs';
const now=Date.parse('2026-10-27T00:05:00Z'),stamp=n=>new Date(n).toISOString(),clone=v=>structuredClone(v),mark='qa-20261027-123456abcdef',hash='a'.repeat(64);
const runtime={ISP_STAGING_START_AT:stamp(now-300000),ISP_STAGING_EXPIRES_AT:stamp(now+3000000),CANDIDATE_COMMIT:'b'.repeat(40),CLOUDFLARE_DEPLOYMENT_ID:'deployment'};
function prereqs(){
 const target={project:'royal-glitter-45740959',host:'ep-delicate-frost-a1o15wrb.ap-southeast-1.aws.neon.tech',database:'neondb'};
 const fixtures={phase:'active',run_marker:mark,target,actors:{member_b:{id:1,role:'member',email:'member@example.invalid',password:'synthetic'},admin_a:{id:2,role:'admin',email:'a@example.invalid',password:'synthetic'},admin_b:{id:3,role:'admin',email:'b@example.invalid',password:'synthetic'}}};
 const batches=['identity','event-draft','event-publish','publication-draft','publication-publish','discover','engagement','event-republish','snapshot-withdraw','imports','critical-guards','critical-replace','logout','throttle'],ids=Array.from({length:42},(_,i)=>'case_'+i);
 const phase={status:'selected_phase_complete',mobile_eligible:true,phase:'functional',run_marker:mark,release:{prepared_release_sha256:hash},completed_batches:batches,selected_case_ids:ids,finished_at:stamp(now-1000)};
 const http={lease_id:'rails-staging-2',prepared_release_sha256:hash,run_marker:mark,candidate:runtime.CANDIDATE_COMMIT,deployment_id:runtime.CLOUDFLARE_DEPLOYMENT_ID,target,cases:Object.fromEntries(ids.map(x=>[x,{status:'PASS',http:'PASS'}])),actors:{admin_a:{totp_secret:'JBSWY3DPEHPK3PXP'},admin_b:{totp_secret:'JBSWY3DPEHPK3PXP'}},event:{slug:'a'.repeat(16)},publication:{slug:'b'.repeat(16)},discover:{id:1}};
 const observations={version:1,phase:'active',run_marker:mark,target,captured_at:stamp(now),actors:{member_b:fixtures.actors.member_b,admin_a:{...fixtures.actors.admin_a,mfa_enabled:true},admin_b:{...fixtures.actors.admin_b,mfa_enabled:true}},events:[{slug:http.event.slug,published_title:'synthetic'}],publications:[{slug:http.publication.slug,pdf_sha256:hash}],discover:[{id:1,position:1}]};
 return {profile:'iphone-webkit',runtime,fixtures,http,phase,preparedHash:hash,observations,now};
}
function proof(){
 const p=prereqs(),profile={name:'iphone-webkit',admin:'admin_a',controller_pid:123,server_id:'server',server_pid_linux:321,status:'PASS',db_reconciled:true,process_cleanup:'pass',finished_at:stamp(now),cleanup:'pass',errors:[],actions:Object.fromEntries(REQUIRED_MUTATIONS.map(id=>[id,{status:'observed'}])),cases:Object.fromEntries(REQUIRED_CASES.map(x=>[x,{status:'PASS'}])),baseline_sessions:{member_b:[10],admin_a:[11]},expected:{profile:{name:'Synthetic member',company:'Synthetic estate'},consultation:{id:4,request_key:'key',category:'Other enquiry',subject:'synthetic',message:'test'},event:{slug:'c'.repeat(16),title:'Synthetic event',revision:2,brochure_name:'synthetic.pdf'},interest:{company:'Interest estate'},publication:{slug:'d'.repeat(16),title:'Synthetic publication',revision:2,pdf_sha256:hash,cover_sha256:'c'.repeat(64)},discover:{id:1,fields:{title:'Synthetic Discover'},previous_image_blob_id:null}}};
 const e=profile.expected,observations={version:1,phase:'active',run_marker:mark,target:p.fixtures.target,captured_at:stamp(now+1000),actors:{member_b:{id:1,email:p.fixtures.actors.member_b.email,role:'member',account_status:'active',...e.profile,sessions:[{id:10}]},admin_a:{id:2,mfa_enabled:true,usable_challenge_count:0,sessions:[]}},consultations:[{...e.consultation,user_id:1}],events:[{slug:e.event.slug,draft_title:e.event.title,published_title:e.event.title,published_revision:2,published_data:{admission:'free',images:[{}],brochure:{name:e.event.brochure_name}},interests:[{user_id:1,company:e.interest.company,event_revision:2,event_snapshot:{title:e.event.title}}]}],publications:[{slug:e.publication.slug,draft_title:e.publication.title,published_title:e.publication.title,published_revision:2,pdf_sha256:hash,cover_sha256:'c'.repeat(64),pdf:{scan_status:'clean'},cover:{scan_status:'clean'}}],discover:[{id:1,title:e.discover.fields.title,image_blob_id:15}]};
 return {p,profile,observations};
}
test('exact profile command and same-origin path admission',()=>{
 assert.deepEqual(argumentsFor(['--execute','--profile','iphone-webkit']),{mode:'execute',profile:'iphone-webkit'});
 for(const args of [['--execute'],['--execute','--profile','all'],['--execute','--profile','iphone-webkit','--retry']])assert.throws(()=>argumentsFor(args));
 assert.equal(safeURL('/member/dashboard').origin,ORIGIN);for(const path of ['https://evil.invalid/','//evil.invalid/','https://user@'+new URL(ORIGIN).host,'/x#hash'])assert.throws(()=>safeURL(path));
});
test('complete profile and independent reconciliation must fit bounded lease',()=>{
 assert.equal(profileWindow(runtime,now).deadline,now+420000);
 assert.throws(()=>profileWindow({...runtime,ISP_STAGING_EXPIRES_AT:stamp(now+1000000)},now),CoverageDeferred);
 assert.throws(()=>profileWindow({...runtime,ISP_STAGING_EXPIRES_AT:stamp(now+4000000)},now));
 assert.equal(admitCase({deadline:now+20001,requests:176,now}),true);assert.equal(admitCase({deadline:now+20000,requests:176,now}),false);assert.equal(admitCase({deadline:now+30000,requests:177,now}),false);
});
test('42 reconciled HTTP cases, release identity, fresh observations and actual MFA required',()=>{
 assert.equal(dependencies(prereqs()).admin,'admin_a');
 for(const change of [x=>x.phase.mobile_eligible=false,x=>x.http.cases.case_41.status='OPEN',x=>x.http.cases.case_0.http='FAIL',x=>x.http.halted=true,x=>x.http.prepared_release_sha256='f'.repeat(64),x=>x.phase.completed_batches.pop(),x=>x.http.actors.admin_a.totp_secret='',x=>x.observations.actors.admin_a.mfa_enabled=false,x=>x.observations.captured_at=stamp(now+6000),x=>x.observations.events=[]]){const p=prereqs();change(p);assert.throws(()=>dependencies(p));}
});
test('rendered mutation checks exact action, method and CSRF',()=>{
 assert.equal(mutationTarget('review_access',{action:'/__isp_review',method:'post',csrf:false,review_key:true}).method,'post');assert.throws(()=>mutationTarget('review_access',{action:'/__isp_review',method:'post',csrf:false,review_key:false}));const form={action:'/member/profile',method:'post',override:'patch',csrf:true};assert.equal(mutationTarget('member_profile',form).method,'patch');
 for(const patch of [{action:'https://evil.invalid/member/profile'},{method:'get'},{override:'delete'},{csrf:false},{action:'/admin/events'}])assert.throws(()=>mutationTarget('member_profile',{...form,...patch}));
});
test('durable intent precedes POST and response loss cannot be replayed',async()=>{
 const actions=new Map(),calls=[],form={action:'/member/consultation_requests',method:'post',csrf:true};
 const run=perform=>submitOnce({id:'consultation',form,writeIntent:async id=>{assert.equal(actions.has(id),false);actions.set(id,'intent');calls.push('intent');},perform,writeObserved:async id=>{actions.set(id,'observed');}});
 await assert.rejects(run(async()=>{calls.push('POST');throw Error('lost');}));assert.equal(actions.get('consultation'),'intent');
 await assert.rejects(run(async()=>calls.push('replay')));assert.deepEqual(calls,['intent','POST']);
 await assert.rejects(submitOnce({id:'consultation',form,writeIntent:async()=>{throw Error('disk full');},perform:async()=>assert.fail('must not send'),writeObserved:async()=>{}}));
});
test('failed observation write leaves unknown outcome after successful POST',async()=>{
 const calls=[];await assert.rejects(submitOnce({id:'member_logout',form:{action:'/session',method:'post',override:'delete',csrf:true},writeIntent:async()=>calls.push('intent'),perform:async()=>{calls.push('POST');return {status:303};},writeObserved:async()=>{calls.push('write-failed');throw Error('disk full');}}));assert.deepEqual(calls,['intent','POST','write-failed']);
});
test('TOTP standard vector and PDF xref are real byte contracts',()=>{
 assert.equal(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',59000),'287082');const text=benignPdf('synthetic').toString(),offset=Number(/startxref\n(\d+)/.exec(text)[1]);assert.equal(text.slice(offset,offset+4),'xref');
});
test('PDF download needs exact hash, no-store, type and attachment',()=>{
 const bytes=benignPdf('synthetic'),meta={status:200,type:'application/pdf',cache:'no-store, private',disposition:'attachment'};
 assert.equal(verifyFile(meta,bytes,sha256(bytes),'application/pdf'),true);
 for(const patch of [{status:302},{type:'text/html'},{cache:'public'},{disposition:'inline'}])assert.throws(()=>verifyFile({...meta,...patch},bytes,sha256(bytes),'application/pdf'));
 assert.throws(()=>verifyFile(meta,bytes,'0'.repeat(64),'application/pdf'));
});
test('independent DB checks reject mismatched profile, enquiry, revision, duplicate interest, hash, scan or logout',()=>{
 const {p,profile,observations}=proof();assert.equal(databaseMatches(profile,observations,p.fixtures),true);
 for(const change of [x=>x.actors.member_b.company='old',x=>x.consultations[0].message='changed',x=>x.events[0].published_revision=1,x=>x.events[0].interests.push({...x.events[0].interests[0]}),x=>x.events[0].interests[0].event_snapshot.title='wrong',x=>x.publications[0].pdf_sha256='0'.repeat(64),x=>x.publications[0].cover.scan_status='pending',x=>x.discover[0].image_blob_id=null,x=>x.actors.admin_a.usable_challenge_count=1,x=>x.actors.member_b.sessions.push({id:99}),x=>x.captured_at=stamp(now-1)]){const o=clone(observations);change(o);assert.equal(databaseMatches(profile,o,p.fixtures),false);}
});
test('deferred or missing UI case and unknown mutation can never become UI complete',()=>{
 const {profile}=proof();assert.equal(uiComplete(profile),true);
 for(const status of ['DEFERRED','NOT_RUN','FAIL']){const p=clone(profile);p.cases.consultation.status=status;assert.equal(uiComplete(p),false);}
 const p=clone(profile);p.cleanup='fail';assert.equal(uiComplete(p),false);p.cleanup='pass';p.actions.consultation.status='intent';assert.equal(uiComplete(p),false);
});
test('exact controller and observed owned process absence are required',()=>{
 const {profile}=proof(),journal={run_marker:mark},r={version:1,status:'UI_COMPLETE_AWAITING_RECONCILIATION',profile:'iphone-webkit',run_marker:mark,controller_pid:123,controller_exit_code:0,controller_exited:true,browser_absent:true,observed_at:stamp(now+1000),server_id:'server',server_pid_linux:321,browser_pid_linux:322,server_absent:true,wsl_child_exited:true,wsl_child_exit_code:0};
 assert.equal(processReceiptMatches(profile,r,journal),true);
 for(const patch of [{status:'FAIL'},{status:'PASS'},{status:undefined},{status:null},{controller_exit_code:1},{browser_absent:false},{server_absent:false},{server_id:'other'},{wsl_child_exited:false},{browser_pid_linux:321},{controller_pid:124}])assert.equal(processReceiptMatches(profile,{...r,...patch},journal),false);
});
test('aggregate remains OPEN until both actual profiles, data reconciliation and shutdown',()=>{
 const {profile}=proof(),journal={profiles:{'iphone-webkit':profile}};assert.equal(aggregateStatus(journal),'OPEN');journal.profiles['android-chromium']={...clone(profile),name:'android-chromium'};assert.equal(aggregateStatus(journal),'PASS');journal.profiles['android-chromium'].db_reconciled=false;assert.equal(aggregateStatus(journal),'OPEN');
});

test('all journey dependencies are checked before any scenario or mutation starts',async()=>{
 let scenarios=0,mutations=0;
 const complete=Object.fromEntries(JOURNEY_CALLBACKS.map(key=>[key,()=>{}]));
 complete.scenario=()=>{scenarios++;};complete.submit=()=>{mutations++;};
 assert.equal(assertJourneyHarness(complete),complete);
 for(const key of JOURNEY_CALLBACKS){
  const incomplete={...complete};delete incomplete[key];
  await assert.rejects(runRenderedJourneys(incomplete),new RegExp('Rendered journey callback missing: '+key));
 }
 assert.equal(scenarios,0);assert.equal(mutations,0);
});
test('immutable reconciliation proof cannot be rebound to a newer matching capture',()=>{
 const {p,profile,observations}=proof(),first=databaseProof(profile,observations,p.fixtures,{now:now+2000});
 assert.equal(first.sha256,sha256(first.raw));
 assert.equal(databaseProof(profile,observations,p.fixtures,{retainedRaw:first.raw,now:now+2000}).sha256,first.sha256);
 const later={...observations,captured_at:stamp(now+2000)};
 assert.equal(databaseMatches(profile,later,p.fixtures),true);
 assert.throws(()=>databaseProof(profile,later,p.fixtures,{retainedRaw:first.raw,now:now+3000}),/Immutable DB proof differs/);
 assert.throws(()=>databaseProof(profile,observations,p.fixtures,{retainedRaw:encode(observations)+' ',now:now+2000}));
 assert.throws(()=>databaseProof(profile,{...observations,captured_at:stamp(now+10000)},p.fixtures,{now}));
 assert.equal(first.sha256,sha256(first.raw));
});