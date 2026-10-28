// Only the renewed-attempt contracts. No provider, archive, packet preparation,
// database, fixture mutation or browser journey execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {QUEUED_MOBILE_MODE,QUEUED_MOBILE_CEILING_USD,QUEUED_MOBILE_SHARED_RESERVATION_USD,QUEUED_NEXT_MOBILE_CASE_CARRY,QUEUED_RENEWED_CONTINUATION_CLASS,QUEUED_RENEWED_CONTINUATION_MIGRATION,QUEUED_RENEWED_FAILED_MARKER,QUEUED_RENEWED_FAILED_NS,QUEUED_RENEWED_FAILED_ARCHIVE,QUEUED_RENEWED_FAILED_HASHES,QUEUED_RENEWED_PRIOR_NAMESPACES,QUEUED_RENEWED_AMENDMENT_SHA256,QUEUED_RENEWED_CENSUS_SHA256,QUEUED_RENEWED_HOSTED_RESULT_SHA256,queuedMobilePacketFields,queuedMobileBaseBudget,renewedMobileBaseBudget,assertQueuedMobilePacket,validateQueuedMobileBaseBudget,queuedContinuationSelection,validateQueuedRenewedFailedRecords,computeQueuedRenewedContinuationBudget,computeQueuedMobileBudget,assertRenewedNamespace,queuedRenewedArchiveTargets} from './private-acceptance-mobile.mjs';
import {privateAcceptanceConfig,queuedMobilePlan,acceptanceDeploymentProfile,assertQueuedMobileReview} from './private-acceptance.mjs';
import {assertQueuedMobileEntryPreflight,mobileEntryReadFile} from './private-mobile-entry-preflight.mjs';
import {PRIVATE_SOURCE_FILES} from './private-acceptance-context.mjs';
import {runRenderedJourneys,JOURNEY_CALLBACKS} from './virtual-mobile-journeys.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,''),CURRENT='D:/Projects/isp-rails-tools/isp-staging-private/private-acceptance',source=fs.existsSync(QUEUED_RENEWED_FAILED_ARCHIVE+'/packet.json')?QUEUED_RENEWED_FAILED_ARCHIVE:CURRENT;
const privateEvidence=fs.existsSync(source+'/packet.json')&&fs.existsSync('D:/Projects/isp-rails-tools/isp-mobile-qa/private-mobile-cleanup-amendment-1793201662749.json');
const packet=()=>queuedMobilePacketFields({continuation:true,nextContinuation:true,renewedContinuation:true});
function files(){return Object.fromEntries(Object.keys(QUEUED_RENEWED_FAILED_HASHES).map(n=>[n,fs.readFileSync(source+'/'+n)]));}
function support(){return {ownerBudgetRaw:fs.readFileSync(ROOT+'/audit/private-acceptance/owner-budget-10-2026-10-29.json'),hostedRaw:fs.readFileSync(ROOT+'/audit/private-acceptance/queued6-final-carry-hosted-result.json'),amendmentRaw:fs.readFileSync(ROOT+'/audit/private-acceptance/local-process-cleanup-amendment.json'),censusRaw:fs.readFileSync('D:/Projects/isp-rails-tools/isp-mobile-qa/private-mobile-cleanup-amendment-1793201662749.json'),cleanupSourceRaw:fs.readFileSync(ROOT+'/script/private-mobile-cleanup.mjs'),cleanupTestRaw:fs.readFileSync(ROOT+'/script/private-mobile-census-timeout.test.mjs')};}
function latest(){return {marker:QUEUED_RENEWED_FAILED_MARKER,namespace_id:QUEUED_RENEWED_FAILED_NS,start_at:'2026-10-28T15:13:06.379Z',verified_absent_at:'2026-10-28T15:15:23.498Z',outer_elapsed_ms:137119,rounded_seconds:138,already_in_base_commitment:false,maximum_transfer_bytes:4294967296,gateway_allowance_usd:.215,other_allowance_usd:.05,all_prior_allowances_retained:true,no_mobile_journal:true,new_mobile_cases_executed:0,original_browser_verdict:'FAIL',complete_census_amendment_sha256:QUEUED_RENEWED_AMENDMENT_SHA256,independent_census_sha256:QUEUED_RENEWED_CENSUS_SHA256,source_hosted_result_sha256:QUEUED_RENEWED_HOSTED_RESULT_SHA256,artifacts_sha256:QUEUED_RENEWED_FAILED_HASHES};}
function carry(){const prior=JSON.parse(fs.readFileSync(ROOT+'/audit/private-acceptance/queued6-next-carry-proof.json')).budget.prior_intervals;return {version:6,kind:'queued_mobile_renewed_continuation_http_carry',execution_mode:QUEUED_MOBILE_MODE,queued_continuation:true,accepted_total:42,all_prior_allowances_retained:true,previous_mobile:prior[5],previous_queued_mobile:prior[6],previous_queued_next_mobile:prior[7],previous_queued_renewed_mobile:latest(),mobile_case_carry:structuredClone(QUEUED_NEXT_MOBILE_CASE_CARRY),prior_intervals:[...prior,latest()]};}

test('frozen latest failure, explicit no-journal and complete ownership-bound amendment required',{skip:!privateEvidence},()=>{
 const raw=files(),s=support(),fact=validateQueuedRenewedFailedRecords(raw,s,{journalPresent:false});assert.deepEqual(fact,latest());assert.equal(fs.existsSync(source+'/acceptance-mobile.json'),false);
 for(const name of Object.keys(raw))assert.throws(()=>validateQueuedRenewedFailedRecords({...raw,[name]:Buffer.concat([raw[name],Buffer.from(' ')] )},s,{journalPresent:false}),/artifact_changed/,name);
 for(const key of Object.keys(s))assert.throws(()=>validateQueuedRenewedFailedRecords(raw,{...s,[key]:Buffer.concat([s[key],Buffer.from(' ')])},{journalPresent:false}),key);
 for(const journalPresent of [true,undefined])assert.throws(()=>validateQueuedRenewedFailedRecords(raw,s,{journalPresent}),/journal_must_be_absent/);
});
test('only one fixed new ten-dollar branch is added; every earlier ceiling and cap remains fixed',()=>{
 const p=packet(),b=renewedMobileBaseBudget();assert.equal(assertQueuedMobilePacket(p),true);assert.equal(validateQueuedMobileBaseBudget(b,p),b);
 assert.equal(QUEUED_MOBILE_CEILING_USD,6);assert.equal(QUEUED_MOBILE_SHARED_RESERVATION_USD,1.4);assert.equal(queuedMobilePacketFields({continuation:true,nextContinuation:true}).cumulative_budget_ceiling_usd,6);assert.equal(queuedMobileBaseBudget({continuation:true,nextContinuation:true}).reserved_session_usd,1.4);
 assert.equal(p.cumulative_budget_ceiling_usd,10);assert.equal(b.reserved_session_usd,.3338128);assert.equal(b.unallocated_usd,3.86013632);assert.equal(b.automatic_retries,0);
 for(const change of [p=>p.mobile_continuation_source_packet_sha256='0'.repeat(64),p=>p.mobile_continuation_hosted_result_sha256='0'.repeat(64),p=>p.gateway_class='ISPPrivateAcceptanceMobileQueued6NextContinuation',p=>delete p.owner_budget_approval_sha256,p=>p.cumulative_budget_ceiling_usd=6,p=>p.cumulative_budget_ceiling_usd=11,p=>p.max_window_ms++,p=>p.cleanup_reserve_ms--,p=>p.max_transfer_bytes++,p=>p.max_gateway_requests++,p=>p.max_profile_requests++,p=>p.carried_mobile_case_ids.push('iphone-webkit/member_login')]){const v=packet();change(v);assert.throws(()=>assertQueuedMobilePacket(v));}
 for(const change of [b=>b.reserved_session_usd=5.4,b=>b.unallocated_usd=0,b=>b.prior_conservative_commitment_usd=5,b=>b.automatic_retries=1]){const v=renewedMobileBaseBudget();change(v);assert.throws(()=>validateQueuedMobileBaseBudget(v,p));}
});
test('all nine intervals and full allowances produce6.13986368 and3267seconds with one reservation',()=>{
 const c=carry(),b=computeQueuedRenewedContinuationBudget(c);assert.deepEqual(computeQueuedMobileBudget(c),b);assert.equal(b.ceiling_usd,10);assert.equal(b.completed_run_conservative_bound_usd,5.80605088);assert.equal(b.new_attempt_reservation_usd,.3338128);assert.equal(b.cumulative_bound_usd,6.13986368);assert.equal(b.unallocated_authorization_headroom_usd,3.86013632);assert.equal(b.cumulative_runtime_bound_seconds,3267);assert.equal(b.cumulative_runtime_margin_seconds,33);assert.equal(b.allowance_coverage.filter(x=>x.transfer_cap_bytes===4294967296).length,4);assert.equal(b.actual_invoice_asserted,false);
 for(const change of [c=>c.prior_intervals.pop(),c=>c.prior_intervals[6].rounded_seconds=199,c=>c.previous_queued_renewed_mobile.rounded_seconds=137,c=>c.previous_queued_renewed_mobile.no_mobile_journal=false,c=>c.previous_queued_renewed_mobile.original_browser_verdict='PASS',c=>c.previous_queued_renewed_mobile.maximum_transfer_bytes=0,c=>c.previous_queued_renewed_mobile.complete_census_amendment_sha256='0'.repeat(64),c=>c.mobile_case_carry.profiles['iphone-webkit'].cases.member_login={status:'PASS_CARRIED'}]){const v=structuredClone(carry());change(v);assert.throws(()=>computeQueuedRenewedContinuationBudget(v));}
 assert.throws(()=>computeQueuedRenewedContinuationBudget(c,1920001));
});
test('fresh class/migration, every prior namespace refusal and exact packet review required',()=>{
 const p=packet(),config=privateAcceptanceConfig(JSON.parse(fs.readFileSync(ROOT+'/cloudflare/acceptance/wrangler.json')),{finalTail:true,mobileOnly:true,queuedMobile:true,queuedContinuation:true,queuedNextContinuation:true,queuedRenewedContinuation:true});
 assert.equal(assertQueuedMobilePacket(p,config),true);assert.deepEqual(acceptanceDeploymentProfile(p),{class_name:QUEUED_RENEWED_CONTINUATION_CLASS,migration_tag:QUEUED_RENEWED_CONTINUATION_MIGRATION});assert.equal(config.migrations.at(-1).new_sqlite_classes[0],QUEUED_RENEWED_CONTINUATION_CLASS);
 for(const namespace of QUEUED_RENEWED_PRIOR_NAMESPACES)assert.throws(()=>assertRenewedNamespace(namespace),/fresh_renewed_namespace/);assert.equal(assertRenewedNamespace('a'.repeat(32)),true);assert.throws(()=>assertRenewedNamespace('unknown'));
 const review={status:'APPROVED',packet_sha256:'a'.repeat(64),source:'b'.repeat(40),ci:'SUCCESS_WITH_CARRY',owner_runtime_approved:true,director:'Astra high',execution_mode:QUEUED_MOBILE_MODE,cumulative_ceiling_usd:10};assert.equal(assertQueuedMobileReview(review,p,review.packet_sha256),true);assert.throws(()=>assertQueuedMobileReview({...review,cumulative_ceiling_usd:6},p,review.packet_sha256));
 const plan=queuedMobilePlan({continuation:true,nextContinuation:true,renewedContinuation:true});assert.equal(plan.cumulative_runtime_bound_seconds,3267);assert.equal(plan.reserved_usd,.3338128);
});
test('the two carried iPhone cases stay transitive and no remaining case body is replayed',async()=>{
 const selected=queuedContinuationSelection(packet());assert.deepEqual(selected,QUEUED_NEXT_MOBILE_CASE_CARRY);assert.deepEqual(Object.keys(selected.profiles['iphone-webkit'].cases),['private_gate','landing_menu_keyboard']);assert.equal(selected.source_packet_sha256,'a2c9416ade2878b963a8174797dc5a49842b67d9a3fbd30a49594fa7b651af63');
 for(const [name,expected]of [['iphone-webkit','member_login'],['android-chromium','private_gate']]){
  const stop=new Error('STOP_BEFORE_CASE_BODY'),seen=[],h={name,page:{},context:{},fixtures:{run_marker:'synthetic'},http:{},profile:{},continuation:selected,gate:{},...Object.fromEntries(JOURNEY_CALLBACKS.map(k=>[k,()=>assert.fail('No case body runs')]))};h.scenario=async id=>{seen.push(id);throw stop;};await assert.rejects(runRenderedJourneys(h),e=>e===stop);assert.deepEqual(seen,[expected]);
 }
});
test('archive target is exact D source and distinct immutable marker; no move occurs',()=>{
 assert.deepEqual(queuedRenewedArchiveTargets(undefined,undefined,'win32'),{source:CURRENT,destination:QUEUED_RENEWED_FAILED_ARCHIVE});
 for(const [s,d]of [['C:/private',undefined],[CURRENT,CURRENT],[CURRENT,QUEUED_RENEWED_FAILED_ARCHIVE+'/../foreign']])assert.throws(()=>queuedRenewedArchiveTargets(s,d,'win32'));
});
test('whole actual existing controller entry pins remain admitted before any packet mutation',{skip:!fs.existsSync(ROOT+'/tmp/neon-build/assets/.manifest.json')&&!fs.existsSync(ROOT+'/tmp/neon-build/assets')},()=>{
 const logical=file=>mobileEntryReadFile(file);const report=assertQueuedMobileEntryPreflight({readFile:logical,privateSourceFiles:PRIVATE_SOURCE_FILES});assert.equal(report.status,'PASS_OFFLINE_ENTRY_ADMISSION');assert.equal(report.checked_files,271);assert.equal(report.provider_requests,0);
});

test('renewed budget metadata and preparation output report the four-dollar increase and actual unallocated headroom',()=>{
 const budget=computeQueuedRenewedContinuationBudget(carry());assert.equal(budget.increase_from_previous_ceiling_usd,4);assert.equal(budget.unallocated_authorization_headroom_usd,renewedMobileBaseBudget().unallocated_usd);assert.equal(Number((budget.new_attempt_reservation_usd+budget.completed_run_conservative_bound_usd).toFixed(8)),budget.cumulative_bound_usd);
 const source=fs.readFileSync(ROOT+'/script/private-acceptance.mjs','utf8');assert.ok(source.includes("remaining_unallocated_usd:queuedRenewedContinuation?read('budget.json').unallocated_usd:0"));
});
