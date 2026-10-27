import {CARRIED_CASE_IDS} from './private-acceptance-carry.mjs';
const BATCHES=Object.freeze(['identity','event-draft','event-publish','publication-draft','publication-publish','discover','engagement','event-republish','snapshot-withdraw','imports','critical-guards','critical-replace','logout','throttle','aged-stepup']);
const refuse=()=>{throw Error('Reviewed functional execution phase required');};
const guard=v=>{if(!v)refuse();};

export const CONTINUATION_BOOTSTRAP_ACTORS=Object.freeze(['member_a','member_b','admin_a','admin_b']);
export const CONTINUATION_BATCHES=Object.freeze(['bootstrap',...BATCHES.slice(1,-1)]);
export const CONTINUATION_CURRENT_CASE_IDS=Object.freeze(["consultation_csrf_negative","scanner_eicar_rejection","discover_replaced_key","publication_replaced_key","event_draft","event_draft_files","event_stale_edit","event_publish","event_public_files","publication_draft","publication_draft_privacy","publication_publish","publication_member_hash","publication_later_draft","discover_setup","discover_save","discover_rejections","interest_concurrency","consultation_concurrency","consultation_boundaries","roster_boundaries","event_free_republish","interest_snapshot","interest_withdraw","csv_confirm","csv_other_admin","csv_malformed","mail_disabled","logout_revocation","login_throttle","mfa_replay_recovery_cancel","event_csrf_negative","publication_csrf_negative"]);
export const FINAL_TAIL_BATCHES=Object.freeze(['bootstrap','tail-setup','logout','throttle']);
export const FINAL_TAIL_CASE_IDS=Object.freeze(['logout_revocation','login_throttle']);
export const FINAL_TAIL_PRIOR_CASE_IDS=Object.freeze(CONTINUATION_CURRENT_CASE_IDS.filter(id=>!FINAL_TAIL_CASE_IDS.includes(id)));
export const FINAL_TAIL_CARRIED_CASE_IDS=Object.freeze([...CARRIED_CASE_IDS,...FINAL_TAIL_PRIOR_CASE_IDS]);
export const MOBILE_ONLY_BATCHES=Object.freeze(['bootstrap','tail-setup']);
export const MOBILE_ONLY_CARRIED_CASE_IDS=Object.freeze([...FINAL_TAIL_CARRIED_CASE_IDS,...FINAL_TAIL_CASE_IDS]);
const exactIds=(left,right)=>Array.isArray(left)&&left.length===right.length&&new Set(left).size===left.length&&left.every(id=>right.includes(id));
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
export function bootstrapActorBinding(fixtures){
 guard(/^qa-\d{8}-[a-f0-9]{12}$/.test(fixtures?.run_marker||''));
 const actors=Object.fromEntries(CONTINUATION_BOOTSTRAP_ACTORS.map(alias=>{
  const actor=fixtures.actors?.[alias],role=alias.startsWith('admin_')?'admin':'member';
  guard(Number.isSafeInteger(actor?.id)&&actor.id>0&&actor.role===role&&actor.email===fixtures.run_marker+'-'+alias+'@staging.planterapp.co');
  return [alias,{id:actor.id,email:actor.email,role}];
 }));
 guard(new Set(Object.values(actors).map(a=>a.id)).size===4);return actors;
}
export function continuationBootstrapReady(state,fixtures){
 try{
  const b=state?.bootstrap,started=Date.parse(b?.started_at),finished=Date.parse(b?.finished_at),observed=Date.parse(b?.db_observed_at);
  if(b?.version!==1||b.run_marker!==fixtures?.run_marker||b.status!=='PASS'||b.http!=='PASS'||canonical(b.actor_binding)!==canonical(bootstrapActorBinding(fixtures))||![started,finished,observed].every(Number.isFinite)||!Number.isFinite(Date.parse(state.execution_started))||started<Date.parse(state.execution_started)||finished<started||observed<finished||!(/^[a-f0-9]{64}$/.test(b.observation_sha256||'')))return false;
  const sessions=CONTINUATION_BOOTSTRAP_ACTORS.flatMap(alias=>b.session_ids?.[alias]||[]);
  return exactIds(Object.keys(b.session_ids||{}),CONTINUATION_BOOTSTRAP_ACTORS)&&CONTINUATION_BOOTSTRAP_ACTORS.every(alias=>Array.isArray(b.session_ids?.[alias])&&b.session_ids[alias].length===1)&&sessions.every(id=>Number.isSafeInteger(id)&&id>0)&&new Set(sessions).size===4;
 }catch{return false;}
}
export function historicalIdentityCarryMatches({carry,prepared,state,fixtures}){
 if(carry?.version!==1||!(/^[a-f0-9]{64}$/.test(carry.sha256||''))||carry.sha256!==prepared?.historical_carry_sha256||prepared.lease_id!=='rails-private-acceptance'||state?.lease_id!=='rails-private-acceptance'||state.continuation!==true||canonical(state.historical_carry)!==canonical(carry)||!carry.prior_run||!exactIds(carry.cases?.map(c=>c.id),CARRIED_CASE_IDS)||CARRIED_CASE_IDS.some(id=>Object.hasOwn(state.cases||{},id)))return false;
 const dbCases=new Set(['credential_rejection','member_login','admin_enrollment','profile_forgery']);
 return carry.cases.every(c=>c.status==='PASS_CARRIED'&&c.http==='PASS'&&/^qa-\d{8}-[a-f0-9]{12}$/.test(c.original_run_marker||'')&&c.original_run_marker!==fixtures?.run_marker&&Number.isFinite(Date.parse(c.finished_at))&&Date.parse(c.finished_at)<Date.parse(state.execution_started)&&/^[a-f0-9]{64}$/.test(c.original_case_sha256||'')&&(dbCases.has(c.id)?/^[a-f0-9]{64}$/.test(c.observation_sha256||''):!Object.hasOwn(c,'observation_sha256')));
}
function tailCarryProofMatches({carry,prepared,state,fixtures}){
 if(!historicalIdentityCarryMatches({carry,prepared,state,fixtures})||!(/^[a-f0-9]{64}$/.test(carry.tail?.sha256||''))||carry.tail.sha256!==prepared.tail_carry_sha256||!exactIds(carry.tail.cases?.map(c=>c.id),FINAL_TAIL_PRIOR_CASE_IDS))return false;
 return carry.tail.cases.every(c=>c.status==='PASS_CARRIED'&&c.http==='PASS'&&!Object.hasOwn(state.cases||{},c.id)&&/^qa-\d{8}-[a-f0-9]{12}$/.test(c.original_run_marker||'')&&c.original_run_marker!==fixtures?.run_marker&&/^[a-f0-9]{64}$/.test(c.original_case_sha256||'')&&Number.isFinite(Date.parse(c.finished_at))&&Date.parse(c.finished_at)<Date.parse(state.execution_started));
}
export function finalTailCarryMatches(input){return input.prepared?.final_tail===true&&input.state?.final_tail===true&&tailCarryProofMatches(input);}
export function mobileOnlyCarryMatches(input){
 const {carry,prepared,state,fixtures}=input;
 if(prepared?.mobile_only!==true||state?.mobile_only!==true||prepared.final_tail===true||state.final_tail===true||!tailCarryProofMatches(input)||!(/^[a-f0-9]{64}$/.test(carry.mobile?.sha256||''))||carry.mobile.sha256!==prepared.mobile_carry_sha256||!exactIds(carry.mobile.cases?.map(c=>c.id),FINAL_TAIL_CASE_IDS))return false;
 return carry.mobile.cases.every(c=>c.status==='PASS_CARRIED'&&c.http==='PASS'&&!Object.hasOwn(state.cases||{},c.id)&&/^qa-\d{8}-[a-f0-9]{12}$/.test(c.original_run_marker||'')&&c.original_run_marker!==fixtures?.run_marker&&/^[a-f0-9]{64}$/.test(c.original_case_sha256||'')&&/^[a-f0-9]{64}$/.test(c.observation_sha256||'')&&Number.isFinite(Date.parse(c.finished_at))&&Date.parse(c.finished_at)<Date.parse(state.execution_started));
}
export function mobileOnlySelectionMatches({phase,state,fixtures,prepared,carry}){
 return mobileOnlyCarryMatches({carry,prepared,state,fixtures})&&continuationBootstrapReady(state,fixtures)&&finalTailSetupReady(state)&&Object.keys(state.cases||{}).length===0&&exactIds(phase?.selected_case_ids,[])&&exactIds(phase.carried_case_ids,MOBILE_ONLY_CARRIED_CASE_IDS)&&phase.mobile_only===true&&phase.final_tail!==true&&phase.historical_carry_sha256===carry.sha256&&phase.tail_carry_sha256===carry.tail.sha256&&phase.mobile_carry_sha256===carry.mobile.sha256&&phase.carried_pass_count===42&&phase.current_pass_count===0;
}
export function finalTailSetupReady(state){
 const p=state?.tail_setup;
 return p?.version===1&&p.run_marker===state.run_marker&&p.status==='PASS'&&p.http==='PASS'&&Number.isFinite(Date.parse(p.started_at))&&Date.parse(p.started_at)>=Date.parse(state.execution_started)&&Date.parse(p.finished_at)>=Date.parse(p.started_at)&&Date.parse(p.db_observed_at)>=Date.parse(p.finished_at)&&/^[a-f0-9]{64}$/.test(p.observation_sha256||'')&&Array.isArray(p.db)&&p.db.length===2&&Number.isSafeInteger(state.discover?.id)&&state.discover.id>0&&/^[a-f0-9]{16}$/.test(state.publication?.slug||'')&&Array.isArray(state.publication.preview_links)&&state.publication.preview_links.some(x=>/\/files\/pdf\//.test(x))&&typeof state.publication.member_pdf==='string'&&!state.publication.preview_links.includes(state.publication.member_pdf);
}
export function finalTailMobileSelectionMatches({phase,state,fixtures,prepared,carry}){
 return finalTailCarryMatches({carry,prepared,state,fixtures})&&continuationBootstrapReady(state,fixtures)&&finalTailSetupReady(state)&&exactIds(Object.keys(state.cases||{}),FINAL_TAIL_CASE_IDS)&&exactIds(phase?.selected_case_ids,FINAL_TAIL_CASE_IDS)&&exactIds(phase.carried_case_ids,FINAL_TAIL_CARRIED_CASE_IDS)&&phase.final_tail===true&&phase.historical_carry_sha256===carry.sha256&&phase.tail_carry_sha256===carry.tail.sha256&&phase.carried_pass_count===40&&phase.current_pass_count===2&&FINAL_TAIL_CASE_IDS.every(id=>state.cases[id]?.status==='PASS'&&state.cases[id].http==='PASS');
}
export function continuationMobileSelectionMatches({phase,state,fixtures,prepared,carry}){
 return historicalIdentityCarryMatches({carry,prepared,state,fixtures})&&continuationBootstrapReady(state,fixtures)&&exactIds(phase?.selected_case_ids,CONTINUATION_CURRENT_CASE_IDS)&&exactIds(phase.carried_case_ids,CARRIED_CASE_IDS)&&phase.historical_carry_sha256===carry.sha256&&phase.carried_pass_count===9&&phase.current_pass_count===33&&CONTINUATION_CURRENT_CASE_IDS.every(id=>state.cases?.[id]?.status==='PASS'&&state.cases[id].http==='PASS');
}

export function functionalExecutionPlan(args,source){
 const continuation=source?.continuation===true,finalTail=source?.final_tail===true,mobileOnly=source?.mobile_only===true,expectedBatches=mobileOnly?MOBILE_ONLY_BATCHES:finalTail?FINAL_TAIL_BATCHES:continuation?['bootstrap',...BATCHES.slice(1)]:BATCHES;
 if(mobileOnly)guard(continuation&&!finalTail&&exactIds(source.carried_case_ids,MOBILE_ONLY_CARRIED_CASE_IDS));
 if(finalTail)guard(continuation&&exactIds(source.carried_case_ids,FINAL_TAIL_CARRIED_CASE_IDS));
 guard(Array.isArray(args)&&source?.origin===(continuation?'https://isp-rails-startup.meithan-r.workers.dev':'https://isp-member-production.meithan-r.workers.dev')&&JSON.stringify(source.batches)===JSON.stringify(expectedBatches));
 if(continuation&&!finalTail&&!mobileOnly)guard(exactIds(source.carried_case_ids,CARRIED_CASE_IDS));
 guard(source.inventory&&Object.keys(source.inventory).length===63&&source.limits?.requests===350&&source.limits.concurrency===2&&source.limits.cleanup_reserve_minutes===10);
 const execute=JSON.stringify(args)===JSON.stringify(['--execute','--phase','functional']);
 guard(execute||args.length===0||JSON.stringify(args)===JSON.stringify(['--plan'])||JSON.stringify(args)===JSON.stringify(['--plan','--phase','functional']));
 const batches=mobileOnly?[...MOBILE_ONLY_BATCHES]:finalTail?[...FINAL_TAIL_BATCHES]:expectedBatches.slice(0,-1),cases=Object.entries(source.inventory).filter(([,v])=>batches.includes(v?.[0])).map(([id])=>id);
 guard(cases.length===(mobileOnly?0:finalTail?2:continuation?33:42)&&source.inventory.mfa_aged_stepup_revocation?.[0]==='aged-stepup');
 if(finalTail)guard(exactIds(cases,FINAL_TAIL_CASE_IDS)&&source.inventory.logout_revocation?.[0]==='logout'&&source.inventory.login_throttle?.[0]==='throttle');
 if(continuation&&!finalTail&&!mobileOnly)guard(exactIds(cases,CONTINUATION_CURRENT_CASE_IDS)&&CARRIED_CASE_IDS.every(id=>source.inventory[id]?.[0]==='identity'));
 return Object.freeze({executes:execute,phase:'functional',...(continuation?{continuation:true,...(mobileOnly?{mobile_only:true}:finalTail?{final_tail:true}:{}),carried_case_ids:Object.freeze([...(mobileOnly?MOBILE_ONLY_CARRIED_CASE_IDS:finalTail?FINAL_TAIL_CARRIED_CASE_IDS:CARRIED_CASE_IDS)]),current_case_count:mobileOnly?0:finalTail?2:33}:{}),batches:Object.freeze(batches),case_ids:Object.freeze(cases),deferred_batches:Object.freeze(['aged-stepup']),non_http_case_count:20,all_http_batches_completed:false,automatic_retries:0,http_complete_by_elapsed_minutes:25,http_batch_reserve_minutes:5,test_cutoff_before_expiry_minutes:10,production_release_approved:false});
}
function instant(v){guard(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v));const n=Date.parse(v);guard(Number.isFinite(n)&&new Date(n).toISOString()===v.replace(/Z$/,'.000Z'));return n;}
export function functionalExecutionWindow(runtime,now=Date.now()){
 const start=instant(runtime?.ISP_STAGING_START_AT),end=instant(runtime?.ISP_STAGING_EXPIRES_AT);
 guard(Number.isSafeInteger(now)&&end>start&&end-start<=55*60000&&now>=start&&now<end);
 const completeBy=Math.min(start+25*60000,end-30*60000),admitUntil=completeBy-5*60000;
 guard(completeBy>start&&admitUntil>=start);
 return Object.freeze({start,end,completeBy,admitUntil,testCutoff:end-10*60000});
}
export function admitFunctionalBatch(window,now=Date.now()){guard(Number.isSafeInteger(now)&&now>=window.start);return now<window.admitUntil;}

export const FUNCTIONAL_STAGE_LIMITS=Object.freeze({http:180000,capture:45000,status:45000,reconcile:10000,margin:20000});
export function mobileDependenciesReady({phase,completed,state,fixtures,preparedHash,leaseId,runtime,prepared,carry}){
 if(!phase||!Array.isArray(completed)||completed.length!==phase.batches.length||!phase.batches.every((b,i)=>completed[i]===b))return false;
 const continuation=runtime?.ISP_ACCEPTANCE_CONTINUATION==='true';
 if(![...(continuation?['rails-private-acceptance']:['rails-staging-2','rails-staging-3'])].includes(leaseId)||fixtures?.lease_id!==leaseId||!state||state.halted||state.running_batch||state.lease_id!==leaseId||state.prepared_release_sha256!==preparedHash||state.run_marker!==fixtures?.run_marker||fixtures?.phase!=='active'||!Number.isSafeInteger(fixtures.actors?.member_b?.id)||fixtures.actors.member_b.id<=0)return false;
 if(prepared?.mobile_only===true){const selected={...phase,selected_case_ids:phase.case_ids,carried_pass_count:42,current_pass_count:0,historical_carry_sha256:carry?.sha256,tail_carry_sha256:carry?.tail?.sha256,mobile_carry_sha256:carry?.mobile?.sha256};return continuation&&mobileOnlySelectionMatches({phase:selected,state,fixtures,prepared,carry});}
 if(prepared?.final_tail===true){const selected={...phase,selected_case_ids:phase.case_ids,carried_pass_count:40,current_pass_count:2,historical_carry_sha256:carry?.sha256,tail_carry_sha256:carry?.tail?.sha256};return continuation&&finalTailMobileSelectionMatches({phase:selected,state,fixtures,prepared,carry});}
 if(!state.event?.slug||!state.publication?.slug||!state.discover)return false;
 if(continuation){const selected={...phase,selected_case_ids:phase.case_ids,carried_pass_count:9,current_pass_count:33,historical_carry_sha256:carry?.sha256};return continuationMobileSelectionMatches({phase:selected,state,fixtures,prepared,carry});}
 if(state.continuation===true||state.historical_carry)return false;
 return phase.case_ids.every(id=>state.cases?.[id]?.status==='PASS'&&state.cases[id].http==='PASS');
}
