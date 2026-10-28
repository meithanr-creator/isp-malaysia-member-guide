// Focused next carry contracts only. No provider, archive, packet preparation,
// fixture mutation or browser journey is executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {QUEUED_MOBILE_MODE,QUEUED_MOBILE_CASE_CARRY,QUEUED_NEXT_MOBILE_CASE_CARRY,QUEUED_NEXT_FAILED_HASHES,QUEUED_NEXT_FAILED_ARCHIVE,QUEUED_NEXT_FAILED_NS,QUEUED_NEXT_CONTINUATION_CLASS,QUEUED_NEXT_CONTINUATION_MIGRATION,QUEUED_NEXT_SELECTOR_BINDING_SHA256,queuedMobilePacketFields,queuedMobileBaseBudget,assertQueuedMobilePacket,validateQueuedMobileBaseBudget,queuedContinuationSelection,validateQueuedNextFailedRecords,computeQueuedNextContinuationBudget,computeQueuedMobileBudget,queuedNextArchiveTargets,assertQueuedNextSelectorBinding,assertQueuedNextSelectorSourceBinding} from './private-acceptance-mobile.mjs';
import {privateAcceptanceConfig,acceptanceDeploymentProfile,queuedMobilePlan,assertQueuedMobileReview} from './private-acceptance.mjs';
import {runRenderedJourneys,JOURNEY_CALLBACKS} from './virtual-mobile-journeys.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,''),P='D:/Projects/isp-rails-tools/isp-staging-private/private-acceptance',sha=v=>createHash('sha256').update(v).digest('hex');
const packet=()=>queuedMobilePacketFields({continuation:true,nextContinuation:true});
const sourceFiles=()=>{const source=fs.existsSync(QUEUED_NEXT_FAILED_ARCHIVE)?QUEUED_NEXT_FAILED_ARCHIVE:P;return Object.fromEntries(Object.keys(QUEUED_NEXT_FAILED_HASHES).map(n=>[n,fs.readFileSync(source+'/'+n)]));};
function nextCarry(){const proof=JSON.parse(fs.readFileSync(ROOT+'/audit/private-acceptance/queued6-next-carry-proof.json')),intervals=structuredClone(proof.budget.prior_intervals);return {version:5,kind:'queued_mobile_next_continuation_http_carry',execution_mode:QUEUED_MOBILE_MODE,queued_continuation:true,accepted_total:42,all_prior_allowances_retained:true,previous_mobile:intervals[5],previous_queued_mobile:intervals[6],previous_queued_next_mobile:intervals[7],mobile_case_carry:structuredClone(QUEUED_NEXT_MOBILE_CASE_CARRY),prior_intervals:intervals};}

test('next carry admits only frozen stopped raw records and immutable public result',{skip:!fs.existsSync(QUEUED_NEXT_FAILED_ARCHIVE+'/packet.json')&&!fs.existsSync(P+'/packet.json')},()=>{
 const values=sourceFiles(),raw=fs.readFileSync(ROOT+'/audit/private-acceptance/queued6-next-hosted-result.json'),proof=validateQueuedNextFailedRecords(values,raw);
 assert.equal(proof.outer_elapsed_ms,272922);assert.equal(proof.rounded_seconds,273);assert.equal(proof.aggregate_mobile_pass,false);assert.equal(proof.namespace_id,QUEUED_NEXT_FAILED_NS);
 for(const name of Object.keys(values)){const changed={...values,[name]:Buffer.concat([values[name],Buffer.from(' ')] )};assert.throws(()=>validateQueuedNextFailedRecords(changed,raw),/artifact_changed/,name);}
 assert.throws(()=>validateQueuedNextFailedRecords(values,Buffer.concat([raw,Buffer.from(' ')])),/frozen_public/);
});

test('new namespace class, migration, exact source and case selection are mandatory',()=>{
 const p=packet(),config=privateAcceptanceConfig(JSON.parse(fs.readFileSync(ROOT+'/cloudflare/acceptance/wrangler.json')),{finalTail:true,mobileOnly:true,queuedMobile:true,queuedContinuation:true,queuedNextContinuation:true});
 assert.equal(assertQueuedMobilePacket(p,config),true);assert.equal(validateQueuedMobileBaseBudget(queuedMobileBaseBudget({continuation:true,nextContinuation:true}),p).ceiling_usd,6);
 assert.deepEqual(acceptanceDeploymentProfile(p),{class_name:QUEUED_NEXT_CONTINUATION_CLASS,migration_tag:QUEUED_NEXT_CONTINUATION_MIGRATION});
 assert.equal(config.migrations.at(-1).new_sqlite_classes[0],QUEUED_NEXT_CONTINUATION_CLASS);
 assert.equal(queuedMobilePlan({continuation:true,nextContinuation:true}).cumulative_runtime_bound_seconds,3129);
 assert.equal(queuedMobilePacketFields({continuation:true}).mobile_resume_case,'landing_menu_keyboard');
 const selected=queuedContinuationSelection(p);assert.deepEqual(Object.keys(selected.profiles['iphone-webkit'].cases),['private_gate','landing_menu_keyboard']);assert.equal(selected.profiles['iphone-webkit'].resume_case,'member_login');assert.deepEqual(selected.profiles['android-chromium'].cases,{});
 assert.equal(selected.profiles['iphone-webkit'].cases.private_gate.source_packet_sha256,QUEUED_MOBILE_CASE_CARRY.source_packet_sha256);
 for(const mutate of [p=>p.mobile_continuation_source_packet_sha256='0'.repeat(64),p=>p.mobile_continuation_hosted_result_sha256='0'.repeat(64),p=>p.mobile_resume_case='landing_menu_keyboard',p=>p.carried_mobile_case_ids.push('iphone-webkit/member_login'),p=>p.carried_mobile_case_ids.pop(),p=>p.selector_binding_sha256='0'.repeat(64),p=>p.gateway_class='ISPPrivateAcceptanceMobileQueued6Continuation',p=>p.migration_tag='private-acceptance-mobile-queued6-continuation-v1',p=>p.max_transfer_bytes--,p=>p.max_window_ms++]){const v=packet();mutate(v);assert.throws(()=>assertQueuedMobilePacket(v));}
 assert.throws(()=>privateAcceptanceConfig({}, {queuedNextContinuation:true}));
 const review={status:'APPROVED',packet_sha256:'a'.repeat(64),source:'b'.repeat(40),ci:'SUCCESS_WITH_CARRY',owner_runtime_approved:true,director:'Astra high',execution_mode:QUEUED_MOBILE_MODE,cumulative_ceiling_usd:6};assert.equal(assertQueuedMobileReview(review,p,review.packet_sha256),true);assert.throws(()=>assertQueuedMobileReview({...review,packet_sha256:'c'.repeat(64)},p,review.packet_sha256));
});

test('every prior full allowance remains reserved in the3129-second US$5.86991776 bound',()=>{
 const c=nextCarry(),b=computeQueuedNextContinuationBudget(c);assert.deepEqual(computeQueuedMobileBudget(c),b);
 assert.equal(b.cumulative_runtime_bound_seconds,3129);assert.equal(b.new_window_max_seconds,1920);assert.equal(b.cleanup_reserve_seconds,600);assert.equal(b.cumulative_bound_usd,5.86991776);assert.equal(b.previous_queued_runtime_charged_seconds,213);assert.equal(b.previous_queued_next_runtime_charged_seconds,273);
 assert.equal(b.allowance_coverage.filter(a=>a.transfer_cap_bytes===4294967296).length,3);assert.equal(b.allowance_coverage.filter(a=>a.other_usd===.05).length,4);assert.equal(b.actual_invoice_asserted,false);assert.equal(b.all_prior_allowances_retained,true);
 for(const mutate of [c=>c.prior_intervals.pop(),c=>c.prior_intervals.at(-1).rounded_seconds=272,c=>c.prior_intervals[6].rounded_seconds=199,c=>c.previous_queued_next_mobile.all_prior_allowances_retained=false,c=>c.previous_queued_next_mobile.maximum_transfer_bytes=0,c=>c.mobile_case_carry.profiles['iphone-webkit'].cases.member_login={status:'PASS_CARRIED'}]){const changed=nextCarry();mutate(changed);assert.throws(()=>computeQueuedNextContinuationBudget(changed));}
 assert.throws(()=>computeQueuedNextContinuationBudget(c,1920001));
});

test('archive plan accepts only exact D source/destination without moving anything',()=>{
 assert.equal(queuedNextArchiveTargets(undefined,undefined,'win32').source,P);
 for(const [s,d]of [['C:/private-acceptance',undefined],[P,'D:/Projects/isp-rails-tools/isp-staging-private/private-acceptance-history/foreign'],[P+'/../other',undefined],[P,P]])assert.throws(()=>queuedNextArchiveTargets(s,d,'win32'));
 assert.equal(queuedNextArchiveTargets(undefined,undefined,'win32').destination,QUEUED_NEXT_FAILED_ARCHIVE);
});

async function firstScenario(continuation,name='iphone-webkit',gate={}){const observed=[],stop=new Error('STOP_BEFORE_BROWSER_ACTION'),h={name,page:{},context:{},fixtures:{run_marker:'synthetic'},http:{},profile:{},continuation,gate,...Object.fromEntries(JOURNEY_CALLBACKS.map(k=>[k,()=>assert.fail('No browser callback may execute')]))};h.scenario=async id=>{observed.push(id);throw stop;};await assert.rejects(runRenderedJourneys(h),e=>e===stop);return observed;}

test('iPhone begins at member_login while Android retains its whole original selection',async()=>{
 assert.deepEqual(await firstScenario(queuedContinuationSelection(packet())),['member_login']);
 assert.deepEqual(await firstScenario(queuedContinuationSelection(packet()),'android-chromium'),['private_gate']);
 for(const mutate of [c=>delete c.profiles['iphone-webkit'].cases.private_gate,c=>c.profiles['iphone-webkit'].failed_case_carried=true,c=>c.profiles['iphone-webkit'].cases.member_login={status:'PASS_CARRIED'},c=>c.profiles['iphone-webkit'].cases.landing_menu_keyboard.original_status='FAIL',c=>c.profiles['iphone-webkit'].resume_case='member_profile']){const c=structuredClone(QUEUED_NEXT_MOBILE_CASE_CARRY);mutate(c);await assert.rejects(firstScenario(c));}
 await assert.rejects(firstScenario(queuedContinuationSelection(packet()),'iphone-webkit',null));
});

test('selector admission requires exact reversible selection deltas and unchanged audited bytes',()=>{
 const portableRead=file=>fs.readFileSync(ROOT+'/'+file.slice('D:/Projects/isp-member-rails/'.length));assert.equal(assertQueuedNextSelectorSourceBinding(portableRead),true);
 const file=ROOT+'/audit/private-acceptance/queued6-next-selector-binding.json',raw=fs.readFileSync(file);assert.equal(sha(raw),QUEUED_NEXT_SELECTOR_BINDING_SHA256);
 const binding=JSON.parse(raw);for(const [name,entry]of Object.entries(binding.files)){let restored=fs.readFileSync(ROOT+'/'+name,'utf8');for(const patch of entry.patches)restored=restored.replace(patch.after,patch.before);assert.equal(sha(restored),entry.tested_sha256);if(fs.existsSync(entry.tested_source_copy))assert.equal(sha(fs.readFileSync(entry.tested_source_copy)),entry.tested_sha256);}
 for(const target of ['script/virtual-mobile-journeys.mjs','script/virtual-mobile-acceptance.mjs','audit/private-acceptance/queued6-next-selector-binding.json','audit/private-acceptance/remaining-mobile-selector-matrix.json','audit/private-acceptance/remaining-mobile-selector-proof.json','script/virtual-mobile-selector-contracts.test.mjs','app/views/sessions/new.html.erb']){
  assert.throws(()=>assertQueuedNextSelectorSourceBinding(name=>{const v=portableRead(name);return name==='D:/Projects/isp-member-rails/'+target?Buffer.concat([v,Buffer.from(' drift')]):v;}),target);
 }
 const matrix=JSON.parse(fs.readFileSync(ROOT+'/audit/private-acceptance/remaining-mobile-selector-matrix.json')),target=ROOT+'/'+matrix.compiled_assets[0].path;
 if(fs.existsSync('D:/Projects/isp-member-rails/'+matrix.compiled_assets[0].path)){assert.equal(assertQueuedNextSelectorBinding(),true);assert.throws(()=>assertQueuedNextSelectorBinding(name=>name==='D:/Projects/isp-member-rails/'+matrix.compiled_assets[0].path?Buffer.from('changed asset'):fs.readFileSync(name)));}
});
