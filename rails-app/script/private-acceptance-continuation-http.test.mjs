// Offline controller boundaries and a redacted historical evidence-shape contract; no network, Rails boot or private files.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {CARRIED_CASE_IDS} from './private-acceptance-carry.mjs';
import {MOBILE_ONLY_BATCHES,MOBILE_ONLY_CARRIED_CASE_IDS,mobileOnlyCarryMatches,mobileOnlySelectionMatches,FINAL_TAIL_BATCHES,FINAL_TAIL_CASE_IDS,FINAL_TAIL_PRIOR_CASE_IDS,FINAL_TAIL_CARRIED_CASE_IDS,finalTailCarryMatches,finalTailSetupReady,finalTailMobileSelectionMatches,functionalExecutionPlan,mobileDependenciesReady,CONTINUATION_BATCHES,CONTINUATION_CURRENT_CASE_IDS,bootstrapActorBinding,continuationBootstrapReady,historicalIdentityCarryMatches,continuationMobileSelectionMatches} from './hosted-execution-phase.mjs';
import {bootstrapFreshSessions,reconcileBootstrapSessions,reconcileTailSetup,publicReport} from './hosted-acceptance.mjs';
import {dependencies} from './virtual-mobile-journeys.mjs';
import {immutableObservationProof} from './immutable-acceptance-evidence.mjs';
const clone=structuredClone,lease='rails-private-acceptance',mark='qa-20261028-0123456789ab',original='qa-20261027-913674d20bad',start=Date.parse('2026-10-28T01:00:00.000Z'),iso=n=>new Date(start+n).toISOString(),digest='a'.repeat(64);
function inputs(){
 const target={project:'royal-glitter-45740959',host:'ep-delicate-frost-a1o15wrb.ap-southeast-1.aws.neon.tech',database:'neondb'};
 const fixtures={version:1,lease_id:lease,phase:'active',run_marker:mark,target,captured_at:iso(0),actors:Object.fromEntries(['member_a','member_b','admin_a','admin_b'].map((alias,i)=>[alias,{id:100+i,email:mark+'-'+alias+'@staging.planterapp.co',role:alias.startsWith('admin')?'admin':'member',password:'synthetic-only-password'}]))};
 const carry={version:1,sha256:digest,cases:CARRIED_CASE_IDS.map(id=>({id,status:'PASS_CARRIED',http:'PASS',original_run_marker:original,finished_at:'2026-10-27T01:01:00.000Z',original_case_sha256:'c'.repeat(64),...(['credential_rejection','member_login','admin_enrollment','profile_forgery'].includes(id)?{observation_sha256:'b'.repeat(64)}:{})})),prior_run:{tuple:{namespace_id:'1'.repeat(32),application_id:'1'.repeat(32),deployment_id:'old-deployment'},source:'c'.repeat(40),image:'sha256:'+'d'.repeat(64),window:{start_at:'2026-10-27T01:00:00.000Z',end_at:'2026-10-27T01:55:00.000Z'}}};
 const prepared={lease_id:lease,prepared_release_sha256:'e'.repeat(64),historical_carry_sha256:digest};
 const runtime={ISP_ACCEPTANCE_CONTINUATION:'true',ISP_STAGING_LEASE:lease,ISP_STAGING_START_AT:iso(0),ISP_STAGING_EXPIRES_AT:iso(55*60000),CANDIDATE_COMMIT:'f'.repeat(40),CLOUDFLARE_DEPLOYMENT_ID:'current-deployment'};
 const state={version:1,lease_id:lease,continuation:true,historical_carry:clone(carry),prepared_release_sha256:prepared.prepared_release_sha256,run_marker:mark,target:clone(target),candidate:runtime.CANDIDATE_COMMIT,deployment_id:runtime.CLOUDFLARE_DEPLOYMENT_ID,execution_started:iso(0),actors:{},cases:{},completed_batches:[],created:{events:[],publications:[],consultations:[],imports:[],discover:[]}};
 return {fixtures,carry,prepared,runtime,state};
}
async function bootstrap(input=inputs()){
 const {state,fixtures}=input;let n=0;
 await bootstrapFreshSessions({state,fixtures,now:()=>iso(n++?2000:1000),persist(){},login:async(alias,{admin})=>{state.jars??={};state.jars[alias]=[['fresh-session|/',{name:'fresh-session',value:'synthetic-'+alias,path:'/'}]];if(admin)state.actors[alias]={totp_secret:'A'.repeat(32),recovery_codes:['synthetic-fresh-code']};},probe:async()=>{}});
 return input;
}
function observation(input){return {version:1,lease_id:lease,phase:'active',run_marker:mark,target:clone(input.fixtures.target),captured_at:iso(3000),actors:Object.fromEntries(Object.entries(bootstrapActorBinding(input.fixtures)).map(([alias,a],i)=>[alias,{...a,account_status:'active',verified:true,mfa_enabled:a.role==='admin',session_count:1,active_session_count:1,usable_challenge_count:0,sessions:[{id:500+i,created_at:iso(1500),expires_at:iso(3600000),mfa_verified_at:a.role==='admin'?iso(1800):null}]}]))};}
function reconcile(input,obs=observation(input),seal=(_id,_batch,raw)=>({...immutableObservationProof(raw),file:'synthetic-retained-observation.json'})){
 return reconcileBootstrapSessions({state:input.state,fixtures:input.fixtures,raw:Buffer.from(JSON.stringify(obs)),seal,now:start+4000});
}
async function mobile(){
 const input=await bootstrap();reconcile(input);
 const {state,fixtures,prepared,runtime,carry}=input;
 Object.assign(state,{cases:Object.fromEntries(CONTINUATION_CURRENT_CASE_IDS.map(id=>[id,{status:'PASS',http:'PASS'}])),completed_batches:[...CONTINUATION_BATCHES],event:{slug:'e'.repeat(16)},publication:{slug:'f'.repeat(16)},discover:{id:1}});
 const phase={phase:'functional',status:'selected_phase_complete',mobile_eligible:true,lease_id:lease,run_marker:mark,release:{lease_id:lease,prepared_release_sha256:prepared.prepared_release_sha256},selected_case_ids:[...CONTINUATION_CURRENT_CASE_IDS],carried_case_ids:[...CARRIED_CASE_IDS],historical_carry_sha256:carry.sha256,carried_pass_count:9,current_pass_count:33,completed_batches:[...CONTINUATION_BATCHES],started_at:iso(0)};
 const observations=observation(input);observations.events=[{slug:state.event.slug,published_title:'current event'}];observations.publications=[{slug:state.publication.slug,pdf_sha256:'d'.repeat(64)}];observations.discover=[{id:1,position:1}];
 return {...input,phase,observations,http:state,preparedHash:prepared.prepared_release_sha256,profile:'iphone-webkit',now:start+4000};
}
function source(){
 const raw=readFileSync(new URL('./hosted-acceptance.mjs',import.meta.url),'utf8'),inventory=Object.fromEntries([...raw.matchAll(/([a-z0-9_]+):\['([^']+)','([^']+)'\]/g)].map(m=>[m[1],[m[2],m[3]]]));
 return {origin:'https://isp-rails-startup.meithan-r.workers.dev',continuation:true,carried_case_ids:[...CARRIED_CASE_IDS],batches:[...CONTINUATION_BATCHES,'aged-stepup'],inventory,limits:{requests:350,concurrency:2,cleanup_reserve_minutes:10}};
}
test('continuation plan selects bootstrap and exactly33 current cases; historical9 stay separate',()=>{
 const p=functionalExecutionPlan(['--execute','--phase','functional'],source());assert.equal(p.executes,true);assert.deepEqual(p.batches,CONTINUATION_BATCHES);assert.deepEqual(p.case_ids,CONTINUATION_CURRENT_CASE_IDS);assert.deepEqual(p.carried_case_ids,CARRIED_CASE_IDS);assert.equal(p.current_case_count,33);assert.equal(p.case_ids.some(id=>CARRIED_CASE_IDS.includes(id)),false);assert.equal(p.all_http_batches_completed,false);
});
test('fixed continuation plan refuses identity replay, changed carry selection and fake current cases',()=>{
 for(const alter of [s=>s.batches[0]='identity',s=>s.carried_case_ids.pop(),s=>s.inventory.event_draft=['identity','events'],s=>s.origin='https://example.com',s=>s.inventory.fake_current=s.inventory.event_draft,s=>{delete s.inventory.event_draft;s.inventory.fake_current=['event-draft','events'];}]){const s=source();alter(s);assert.throws(()=>functionalExecutionPlan([],s));}
});
test('bootstrap durable intent precedes every login and cannot be replayed',async()=>{
 const input=inputs(),events=[];let clock=0;
 await bootstrapFreshSessions({state:input.state,fixtures:input.fixtures,now:()=>iso(clock++?2000:1000),persist:()=>events.push(input.state.bootstrap.status),login:async(alias,{admin})=>{assert.equal(events[0],'INTENT');events.push(alias);input.state.jars??={};input.state.jars[alias]=[['synthetic',{}]];if(admin)input.state.actors[alias]={totp_secret:'A'.repeat(32),recovery_codes:['synthetic']};},probe:async()=>{}});
 assert.equal(input.state.bootstrap.status,'BLOCKED');assert.equal(input.state.bootstrap.http,'PASS');assert.equal(continuationBootstrapReady(input.state,input.fixtures),false);const count=events.length;
 await assert.rejects(bootstrapFreshSessions({state:input.state,fixtures:input.fixtures,login:async()=>events.push('replayed'),probe:async()=>{},persist(){}}));assert.equal(events.length,count);assert.deepEqual(Object.keys(input.state.cases),[]);
});
test('bootstrap refuses imported cookies, MFA material, prior requests or current PASS rows before login',async()=>{
 for(const alter of [s=>s.jars={member_a:[['old',{}]]},s=>s.actors={admin_a:{totp_secret:'OLD'}},s=>s.request_count=1,s=>s.completed_batches=['identity'],s=>s.cases.member_login={status:'PASS'},s=>s.created.events=['old-slug']]){const input=inputs();alter(input.state);let calls=0;await assert.rejects(bootstrapFreshSessions({state:input.state,fixtures:input.fixtures,login:async()=>calls++,probe:async()=>calls++,persist(){}}));assert.equal(calls,0);}
});
test('failed bootstrap records failure and halts without retry',async()=>{
 const input=inputs();let calls=0;
 await assert.rejects(bootstrapFreshSessions({state:input.state,fixtures:input.fixtures,login:async()=>{calls++;throw Error('synthetic login failure');},probe:async()=>{},persist(){}}));assert.equal(calls,1);assert.equal(input.state.halted,true);assert.equal(input.state.bootstrap.status,'FAIL');
 await assert.rejects(bootstrapFreshSessions({state:input.state,fixtures:input.fixtures,login:async()=>calls++,probe:async()=>{},persist(){}}));assert.equal(calls,1);
});
test('fresh independent observation seals four new sessions and exact actor/MFA bindings',async()=>{
 const input=await bootstrap(),obs=observation(input);let sealed;
 assert.equal(reconcile(input,obs,(_id,batch,raw)=>{sealed=Buffer.from(raw);assert.equal(batch,'bootstrap');return {...immutableObservationProof(raw),file:'synthetic.json'};}),1);
 assert.equal(sealed.toString(),JSON.stringify(obs));assert.equal(continuationBootstrapReady(input.state,input.fixtures),true);assert.equal(input.state.bootstrap.observation_sha256,immutableObservationProof(sealed).sha256);assert.deepEqual(Object.keys(input.state.cases),[]);
});
test('stale capture, old run, mismatched target and future capture never reconcile bootstrap',async()=>{
 for(const alter of [o=>o.captured_at=iso(500),o=>o.run_marker=original,o=>o.target.database='other',o=>o.captured_at=iso(60000)]){const input=await bootstrap(),obs=observation(input);alter(obs);assert.equal(reconcile(input,obs),0);assert.equal(input.state.bootstrap.status,'BLOCKED');assert.equal(continuationBootstrapReady(input.state,input.fixtures),false);}
});
test('old sessions, wrong actor identity, duplicate sessions or absent admin MFA fail reconciliation',async()=>{
 for(const alter of [o=>o.actors.member_a.id=1,o=>o.actors.member_b.email=original+'-member_b@staging.planterapp.co',o=>o.actors.admin_a.role='member',o=>o.actors.admin_b.mfa_enabled=false,o=>o.actors.member_a.sessions[0].created_at='2026-10-27T01:00:00Z',o=>o.actors.member_a.sessions[0].id=o.actors.admin_a.sessions[0].id,o=>o.actors.admin_a.active_session_count=2]){const input=await bootstrap(),obs=observation(input);alter(obs);assert.equal(reconcile(input,obs),1);assert.equal(input.state.bootstrap.status,'FAIL');assert.equal(input.state.halted,true);assert.equal(continuationBootstrapReady(input.state,input.fixtures),false);}
});
test('changed retained observation bytes cannot become bootstrap PASS',async()=>{
 const input=await bootstrap();assert.throws(()=>reconcile(input,observation(input),()=>({sha256:'0'.repeat(64),length:1,file:'wrong.json'})));assert.equal(input.state.bootstrap.status,'BLOCKED');
});
test('valid mobile admission keeps nine carried and thirty-three current PASS distinct',async()=>{
 const input=await mobile();assert.deepEqual(dependencies(input),{admin:'admin_a',memberId:101,adminId:102});assert.equal(continuationMobileSelectionMatches({phase:input.phase,state:input.state,fixtures:input.fixtures,prepared:input.prepared,carry:input.carry}),true);
 const report=publicReport(input.state);assert.equal(report.carried_pass_count,9);assert.equal(report.current_pass_count,33);assert.equal(report.cases.filter(c=>c.status==='PASS_CARRIED').length,9);assert.equal(report.cases.filter(c=>c.status==='PASS').length,33);assert.equal(Object.keys(input.state.cases).length,33);
});
test('mobile refuses changed carry, old window state, fake nine current PASS, missing current case or mismatched bootstrap',async()=>{
 for(const alter of [i=>i.http.historical_carry.sha256='0'.repeat(64),i=>i.http.historical_carry.prior_run.window.end_at='2026-10-28T01:55:00Z',i=>i.http.cases.member_login={status:'PASS',http:'PASS'},i=>delete i.http.cases.event_draft,i=>i.http.cases.event_draft.status='BLOCKED',i=>i.phase.current_pass_count=42,i=>i.phase.carried_pass_count=0,i=>i.phase.carried_case_ids.pop(),i=>i.phase.selected_case_ids[0]='fake_case',i=>i.http.bootstrap.actor_binding.member_b.id=1,i=>i.http.bootstrap.status='BLOCKED',i=>i.prepared.historical_carry_sha256='0'.repeat(64),i=>i.http.run_marker=original]){const input=await mobile();alter(input);assert.throws(()=>dependencies(input));}
});
test('mobile still requires current MFA material, actor observations and published content',async()=>{
 for(const alter of [i=>delete i.http.actors.admin_a.totp_secret,i=>i.observations.actors.admin_a.mfa_enabled=false,i=>i.observations.actors.member_b.id=1,i=>i.observations.publications[0].pdf_sha256='bad',i=>i.phase.release.prepared_release_sha256='0'.repeat(64),i=>i.http.deployment_id='old-deployment']){const input=await mobile();alter(input);assert.throws(()=>dependencies(input));}
});
test('verified helper carry cannot be replaced by a different checkpoint record',()=>{
 const input=inputs();assert.equal(historicalIdentityCarryMatches(input),true);input.state.historical_carry.prior_run.source='0'.repeat(40);assert.equal(historicalIdentityCarryMatches(input),false);
});

test('bootstrap cannot finish without current cookies and protected enrollment material',async()=>{
 const input=inputs();await assert.rejects(bootstrapFreshSessions({state:input.state,fixtures:input.fixtures,login:async()=>{},probe:async()=>{},persist(){}}));assert.equal(input.state.bootstrap.status,'FAIL');assert.equal(input.state.halted,true);
});
test('functional mobile handoff requires exact continuation carry and a fresh reconciled bootstrap',async()=>{
 const input=await mobile(),phase=functionalExecutionPlan([],source());const args={phase,completed:[...CONTINUATION_BATCHES],state:input.state,fixtures:input.fixtures,preparedHash:input.preparedHash,leaseId:lease,runtime:input.runtime,prepared:input.prepared,carry:input.carry};
 assert.equal(mobileDependenciesReady(args),true);assert.equal(mobileDependenciesReady({...args,carry:undefined}),false);const state=clone(input.state);state.bootstrap.status='BLOCKED';assert.equal(mobileDependenciesReady({...args,state}),false);assert.equal(mobileDependenciesReady({...args,completed:CONTINUATION_BATCHES.slice(1)}),false);
});


test('actual historical evidence shape passes carry and mobile gates with five HTTP-only and four database-backed records',async()=>{const real=JSON.parse(readFileSync(new URL('../audit/private-acceptance/historical-carry-source-shape.json',import.meta.url),'utf8'));assert.equal(real.cases.length,9);assert.equal(real.cases.filter(c=>c.observation_sha256).length,4);assert.equal(real.cases.every(c=>/^[a-f0-9]{64}$/.test(c.original_case_sha256)),true);const sha256=createHash('sha256').update(JSON.stringify(real,null,2)+'\n').digest('hex'),carry={...real,sha256};const input=await mobile();input.carry=carry;input.state.historical_carry=clone(carry);input.prepared.historical_carry_sha256=sha256;input.phase.historical_carry_sha256=sha256;assert.equal(historicalIdentityCarryMatches(input),true);assert.equal(continuationMobileSelectionMatches({phase:input.phase,state:input.state,fixtures:input.fixtures,prepared:input.prepared,carry}),true);assert.deepEqual(dependencies(input),{admin:'admin_a',memberId:101,adminId:102});const missing=clone(carry);delete missing.cases.find(c=>c.id==='member_login').observation_sha256;input.state.historical_carry=clone(missing);assert.equal(historicalIdentityCarryMatches({...input,carry:missing}),false);const invented=clone(carry);invented.cases.find(c=>c.id==='health').observation_sha256='1'.repeat(64);input.state.historical_carry=clone(invented);assert.equal(historicalIdentityCarryMatches({...input,carry:invented}),false);});

async function finalTailMobile(){
 const input=await mobile(),{state,carry,prepared,phase}=input;
 carry.tail={sha256:'7'.repeat(64),source_marker:'qa-20261028-abcdefabcdef',cases:FINAL_TAIL_PRIOR_CASE_IDS.map(id=>({id,status:'PASS_CARRIED',http:'PASS',original_run_marker:'qa-20261028-abcdefabcdef',finished_at:iso(-60000),original_case_sha256:'6'.repeat(64)}))};
 Object.assign(prepared,{final_tail:true,tail_carry_sha256:carry.tail.sha256});Object.assign(state,{final_tail:true,historical_carry:clone(carry),cases:Object.fromEntries(FINAL_TAIL_CASE_IDS.map(id=>[id,{status:'PASS',http:'PASS'}])),completed_batches:[...FINAL_TAIL_BATCHES]});delete state.event;
 Object.assign(state.publication,{title:'boundary fixture',preview_links:['https://isp-rails-startup.meithan-r.workers.dev/admin/publications/'+state.publication.slug+'/files/pdf/old?revision=1'],member_pdf:'https://isp-rails-startup.meithan-r.workers.dev/member/publications/'+state.publication.slug+'/files/pdf/current'});
 state.tail_setup={version:1,run_marker:mark,status:'PASS',http:'PASS',started_at:iso(3000),finished_at:iso(4000),observed_after:iso(4000),db_observed_at:iso(5000),observation_sha256:'8'.repeat(64),db:[{collection:'discover',where:{id:1},count:1,equals:{position:1}},{collection:'publications',where:{slug:state.publication.slug},count:1,equals:{pdf_sha256:'d'.repeat(64)}}]};
 Object.assign(phase,{final_tail:true,selected_case_ids:[...FINAL_TAIL_CASE_IDS],carried_case_ids:[...FINAL_TAIL_CARRIED_CASE_IDS],carried_pass_count:40,current_pass_count:2,tail_carry_sha256:carry.tail.sha256,completed_batches:[...FINAL_TAIL_BATCHES]});input.observations.captured_at=iso(6000);input.now=start+7000;delete input.observations.events;return input;
}
test('final tail selects only logout and throttle plus uncounted fresh prerequisites',()=>{
 const sourcePlan=source();Object.assign(sourcePlan,{final_tail:true,batches:[...FINAL_TAIL_BATCHES],carried_case_ids:[...FINAL_TAIL_CARRIED_CASE_IDS]});
 const p=functionalExecutionPlan(['--execute','--phase','functional'],sourcePlan);assert.deepEqual(p.batches,FINAL_TAIL_BATCHES);assert.deepEqual(p.case_ids,FINAL_TAIL_CASE_IDS);assert.equal(p.current_case_count,2);assert.equal(p.carried_case_ids.length,40);
 for(const alter of [x=>x.batches.push('discover'),x=>x.carried_case_ids.pop(),x=>x.inventory.discover_save=['tail-setup','discover'],x=>x.continuation=false,x=>{x.inventory.fake_tail=x.inventory.logout_revocation;delete x.inventory.logout_revocation;}]){const changed=clone(sourcePlan);alter(changed);assert.throws(()=>functionalExecutionPlan([],changed));}
});
test('final tail mobile admits exact forty carry plus two current and no old event dependency',async()=>{
 const input=await finalTailMobile();assert.equal(finalTailCarryMatches(input),true);assert.equal(finalTailSetupReady(input.state),true);assert.equal(finalTailMobileSelectionMatches(input),true);assert.deepEqual(dependencies(input),{admin:'admin_a',memberId:101,adminId:102});
 const report=publicReport(input.state);assert.equal(report.carried_pass_count,40);assert.equal(report.current_pass_count,2);assert.equal(report.cases.filter(x=>x.status==='PASS_CARRIED').length,40);assert.equal(Object.keys(input.state.cases).length,2);
 const plan=functionalExecutionPlan([],{...source(),final_tail:true,batches:[...FINAL_TAIL_BATCHES],carried_case_ids:[...FINAL_TAIL_CARRIED_CASE_IDS]});assert.equal(mobileDependenciesReady({...input,phase:plan,completed:[...FINAL_TAIL_BATCHES],leaseId:lease}),true);
});
test('final tail refuses unsealed carry, missing setup, missing stale PDF and fake current passes',async()=>{
 for(const alter of [x=>x.prepared.tail_carry_sha256='0'.repeat(64),x=>x.carry.tail.cases.pop(),x=>x.state.historical_carry.tail.sha256='0'.repeat(64),x=>x.state.cases.discover_save={status:'PASS',http:'PASS'},x=>x.state.cases.logout_revocation.status='BLOCKED',x=>x.state.tail_setup.status='BLOCKED',x=>x.state.tail_setup.observation_sha256='',x=>x.state.publication.preview_links=[],x=>x.state.publication.member_pdf=x.state.publication.preview_links[0],x=>x.phase.carried_pass_count=42,x=>x.phase.current_pass_count=40,x=>x.phase.tail_carry_sha256='0'.repeat(64),x=>x.state.bootstrap.status='BLOCKED']){const input=await finalTailMobile();alter(input);assert.equal(finalTailMobileSelectionMatches(input),false);assert.throws(()=>dependencies(input));}
});
test('tail prerequisite state seals fresh matching independent DB bytes without creating PASS cases',async()=>{
 const input=await finalTailMobile(),p=input.state.tail_setup;p.status='BLOCKED';delete p.observation_sha256;delete p.db_observed_at;const obs=input.observations,raw=Buffer.from(JSON.stringify(obs));
 assert.equal(reconcileTailSetup({state:input.state,raw,seal:(_id,batch,bytes)=>{assert.equal(batch,'tail-setup');return {...immutableObservationProof(bytes),file:'synthetic-setup-proof.json'};},now:start+7000}),1);assert.equal(finalTailSetupReady(input.state),true);assert.equal(Object.keys(input.state.cases).length,2);
});
test('tail setup rejects wrong DB hash, old capture, changed target and changed retained bytes',async()=>{
 for(const alter of [x=>x.observations.publications[0].pdf_sha256='bad',x=>x.observations.captured_at=iso(2000),x=>x.observations.target.database='wrong']){const input=await finalTailMobile();input.state.tail_setup.status='BLOCKED';alter(input);const changed=reconcileTailSetup({state:input.state,raw:Buffer.from(JSON.stringify(input.observations)),seal:(_i,_b,raw)=>({...immutableObservationProof(raw),file:'synthetic.json'}),now:start+7000});assert.equal(finalTailSetupReady(input.state),false);assert.ok(changed===0||input.state.halted===true);}
 const input=await finalTailMobile();input.state.tail_setup.status='BLOCKED';assert.throws(()=>reconcileTailSetup({state:input.state,raw:Buffer.from(JSON.stringify(input.observations)),seal:()=>({sha256:'0'.repeat(64),length:1,file:'changed.json'}),now:start+7000}));assert.equal(input.state.tail_setup.status,'BLOCKED');
});

async function mobileOnlyInput(){
 const input=await finalTailMobile(),{state,carry,prepared,phase}=input;
 carry.mobile={sha256:'9'.repeat(64),cases:FINAL_TAIL_CASE_IDS.map(id=>({id,status:'PASS_CARRIED',http:'PASS',original_run_marker:'qa-20261028-35370abcdef0',finished_at:iso(-10000),original_case_sha256:'1'.repeat(64),observation_sha256:'2'.repeat(64)}))};
 delete prepared.final_tail;delete state.final_tail;delete phase.final_tail;
 Object.assign(prepared,{mobile_only:true,mobile_carry_sha256:carry.mobile.sha256});Object.assign(state,{mobile_only:true,historical_carry:clone(carry),cases:{},completed_batches:[...MOBILE_ONLY_BATCHES]});
 Object.assign(phase,{mobile_only:true,selected_case_ids:[],carried_case_ids:[...MOBILE_ONLY_CARRIED_CASE_IDS],carried_pass_count:42,current_pass_count:0,mobile_carry_sha256:carry.mobile.sha256,completed_batches:[...MOBILE_ONLY_BATCHES]});return input;
}
test('mobile-only plan runs only fresh prerequisites and selects zero of the forty-two carried cases',()=>{
 const sourcePlan={...source(),mobile_only:true,batches:[...MOBILE_ONLY_BATCHES],carried_case_ids:[...MOBILE_ONLY_CARRIED_CASE_IDS]};
 const plan=functionalExecutionPlan(['--execute','--phase','functional'],sourcePlan);assert.equal(plan.mobile_only,true);assert.equal(plan.current_case_count,0);assert.deepEqual(plan.case_ids,[]);assert.deepEqual(plan.batches,MOBILE_ONLY_BATCHES);assert.equal(plan.carried_case_ids.length,42);
 for(const alter of [x=>x.batches.push('logout'),x=>x.carried_case_ids.pop(),x=>x.final_tail=true,x=>x.continuation=false,x=>x.inventory.login_throttle=['tail-setup','identity']]){const changed=clone(sourcePlan);alter(changed);assert.throws(()=>functionalExecutionPlan([],changed));}
});
test('mobile-only browser gate admits forty-two sealed carry with fresh independent setup and zero invented current PASS',async()=>{
 const input=await mobileOnlyInput();assert.equal(mobileOnlyCarryMatches(input),true);assert.equal(mobileOnlySelectionMatches(input),true);assert.deepEqual(dependencies(input),{admin:'admin_a',memberId:101,adminId:102});
 const report=publicReport(input.state);assert.equal(report.mobile_only,true);assert.equal(report.carried_pass_count,42);assert.equal(report.current_pass_count,0);assert.equal(report.cases.filter(c=>c.status==='PASS_CARRIED').length,42);assert.equal(report.cases.filter(c=>c.status==='PASS').length,0);assert.deepEqual(Object.keys(input.state.cases),[]);
 const phase=functionalExecutionPlan([],{...source(),mobile_only:true,batches:[...MOBILE_ONLY_BATCHES],carried_case_ids:[...MOBILE_ONLY_CARRIED_CASE_IDS]});assert.equal(mobileDependenciesReady({...input,phase,completed:[...MOBILE_ONLY_BATCHES],leaseId:lease}),true);
});
test('mobile-only rejects altered carry bindings, absent original DB proof, fake current PASS and stale fresh prerequisites',async()=>{
 for(const alter of [x=>x.prepared.mobile_carry_sha256='0'.repeat(64),x=>x.carry.mobile.cases.pop(),x=>x.state.historical_carry.mobile.sha256='0'.repeat(64),x=>delete x.carry.mobile.cases[0].observation_sha256,x=>x.carry.mobile.cases[0].finished_at=iso(10000),x=>x.carry.mobile.cases[0].original_run_marker=mark,x=>x.state.cases.logout_revocation={status:'PASS',http:'PASS'},x=>x.state.final_tail=true,x=>x.phase.current_pass_count=2,x=>x.phase.carried_pass_count=40,x=>x.phase.selected_case_ids=['logout_revocation'],x=>x.phase.mobile_carry_sha256='0'.repeat(64),x=>x.phase.completed_batches=[...FINAL_TAIL_BATCHES],x=>x.state.bootstrap.status='BLOCKED',x=>x.state.tail_setup.status='BLOCKED',x=>x.state.publication.preview_links=[]]){const input=await mobileOnlyInput();alter(input);assert.throws(()=>dependencies(input));}
 const input=await mobileOnlyInput();input.state.cases.logout_revocation={status:'PASS',http:'PASS'};assert.equal(mobileOnlySelectionMatches(input),false);assert.throws(()=>publicReport(input.state));
});
