const BATCHES=Object.freeze(['identity','event-draft','event-publish','publication-draft','publication-publish','discover','engagement','event-republish','snapshot-withdraw','imports','critical-guards','critical-replace','logout','throttle','aged-stepup']);
const refuse=()=>{throw Error('Reviewed functional execution phase required');};
const guard=v=>{if(!v)refuse();};
export function functionalExecutionPlan(args,source){
 guard(Array.isArray(args)&&source?.origin==='https://isp-member-production.meithan-r.workers.dev'&&JSON.stringify(source.batches)===JSON.stringify(BATCHES));
 guard(source.inventory&&Object.keys(source.inventory).length===63&&source.limits?.requests===350&&source.limits.concurrency===2&&source.limits.cleanup_reserve_minutes===10);
 const execute=JSON.stringify(args)===JSON.stringify(['--execute','--phase','functional']);
 guard(execute||args.length===0||JSON.stringify(args)===JSON.stringify(['--plan'])||JSON.stringify(args)===JSON.stringify(['--plan','--phase','functional']));
 const batches=BATCHES.slice(0,-1),cases=Object.entries(source.inventory).filter(([,v])=>batches.includes(v?.[0])).map(([id])=>id);
 guard(cases.length===42&&source.inventory.mfa_aged_stepup_revocation?.[0]==='aged-stepup');
 return Object.freeze({executes:execute,phase:'functional',batches:Object.freeze(batches),case_ids:Object.freeze(cases),deferred_batches:Object.freeze(['aged-stepup']),non_http_case_count:20,all_http_batches_completed:false,automatic_retries:0,http_complete_by_elapsed_minutes:25,http_batch_reserve_minutes:5,test_cutoff_before_expiry_minutes:10,production_release_approved:false});
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
export function mobileDependenciesReady({phase,completed,state,fixtures,preparedHash,leaseId}){
 if(!phase||!Array.isArray(completed)||completed.length!==phase.batches.length||!phase.batches.every((b,i)=>completed[i]===b))return false;
 if(!['rails-staging-2','rails-staging-3'].includes(leaseId)||fixtures?.lease_id!==leaseId||!state||state.halted||state.running_batch||state.lease_id!==leaseId||state.prepared_release_sha256!==preparedHash||state.run_marker!==fixtures?.run_marker||fixtures?.phase!=='active'||!Number.isSafeInteger(fixtures.actors?.member_b?.id)||fixtures.actors.member_b.id<=0)return false;
 if(!state.event?.slug||!state.publication?.slug||!state.discover)return false;
 return phase.case_ids.every(id=>state.cases?.[id]?.status==='PASS'&&state.cases[id].http==='PASS');
}
