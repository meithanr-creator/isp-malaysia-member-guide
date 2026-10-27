// One-shot orchestration: actual HTTPS batch -> exact key capture -> independent DB status -> reconcile.
// No retries, no provisioning, no secret output; independent cost watchdog is mandatory.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {functionalExecutionPlan,functionalExecutionWindow,admitFunctionalBatch,FUNCTIONAL_STAGE_LIMITS,mobileDependenciesReady} from './hosted-execution-phase.mjs';
import {selectLease,leaseContext,readPreparedRelease,assertRuntimeRelease,assertActiveRelease,assertWatchdogTuple,assertWritableLease,assertLeaseMutationAllowed,preparedTuple} from './staging-lease-context.mjs';
import {readActiveStagingAdmission} from './active-staging-admission.mjs';
const CONTEXT=leaseContext(selectLease());
const ROOT='D:/Projects/isp-member-rails',PRIVATE=CONTEXT.privateRoot;
const get=file=>JSON.parse(fs.readFileSync(PRIVATE+'/'+file,'utf8'));
function fail(){throw Error('Acceptance sequencing stopped; inspect preserved evidence before any further mutation')}
let requireWatchdog=false,expectedWindow=null,expectedRuntime=null,prepared=null,phaseSummary=null,acceptedAdmissionSnapshot=null;
const summaryFile=CONTEXT.auditRoot+'/functional-phase-summary.json';
function saveSummary(){const temp=summaryFile+'.tmp-'+randomUUID(),fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(phaseSummary,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,summaryFile);}
function verifyWatchdog(){
 const observed=readActiveStagingAdmission(CONTEXT,{expectedRuntime,prepared,expectedSnapshot:acceptedAdmissionSnapshot});
 acceptedAdmissionSnapshot??=observed.snapshot;
}
function command(script,args,deadline,capture=false,maxMs=180000){
 if(requireWatchdog)verifyWatchdog();const timeout=Math.min(maxMs,deadline-Date.now());const minimum=script==='hosted-acceptance.mjs'&&args[0]==='--execute'?20000:1000;if(timeout<minimum)fail();
 const result=spawnSync(process.execPath,[ROOT+'/script/'+script,...args],{cwd:ROOT,env:{...process.env,TEMP:'D:/Projects/isp-rails-tools/tmp',TMP:'D:/Projects/isp-rails-tools/tmp',...(requireWatchdog?{ISP_HTTP_ADMISSION_SHA256:createHash('sha256').update(JSON.stringify(acceptedAdmissionSnapshot)).digest('hex')}:{})},windowsHide:true,shell:false,stdio:capture?['ignore','pipe','pipe']:'inherit',encoding:'utf8',timeout,maxBuffer:2*1024*1024});
 if(result.error||result.status!==0)fail();return result.stdout;
}
try{
 const plan=JSON.parse(command('hosted-acceptance.mjs',['--plan'],Date.now()+30000,true));
 if(!Array.isArray(plan.batches)||plan.batches.length>20||!plan.batches.every(b=>/^[a-z-]+$/.test(b)))fail();
 const phase=functionalExecutionPlan(process.argv.slice(2),plan);
 if(!phase.executes){
  console.log(JSON.stringify({...phase,sequence:'HTTPS batch, independent database status, reconcile; halt on failure; external cases stay open'}));
 }else{
  assertLeaseMutationAllowed(CONTEXT);assertWritableLease(CONTEXT);if(!CONTEXT.fresh)fail();
  const runtime=get('runtime.json'),fixture=get('acceptance-fixtures.json'),watchdog=get('watchdog-state.json');
  prepared=readPreparedRelease(CONTEXT);
  assertRuntimeRelease(CONTEXT,runtime,prepared);
  if(CONTEXT.fresh)assertActiveRelease(CONTEXT,runtime,get('acceptance-release.json'),prepared);
  expectedRuntime=runtime;
  const window=functionalExecutionWindow(runtime),deadline=window.completeBy;expectedWindow={start:runtime.ISP_STAGING_START_AT,end:runtime.ISP_STAGING_EXPIRES_AT};requireWatchdog=true;verifyWatchdog();
  if(!Number.isFinite(deadline)||deadline<=Date.now()||fixture.phase!=='active'||fixture.lease_id!==CONTEXT.leaseId||watchdog.armed!==true||Date.now()-Date.parse(watchdog.updated_at)>45000)fail();
  const completed=[];let admissionStopped=false,state=null;
  const initial={version:1,phase:phase.phase,status:'running',lease_id:CONTEXT.leaseId,release:preparedTuple(prepared),run_marker:fixture.run_marker,selected_case_ids:phase.case_ids,http_complete_by:new Date(window.completeBy).toISOString(),batch_admission_until:new Date(window.admitUntil).toISOString(),test_cutoff:new Date(window.testCutoff).toISOString(),stage_limits_ms:FUNCTIONAL_STAGE_LIMITS,completed_batches:[],deferred_batches:[...phase.batches,...phase.deferred_batches],mobile_eligible:false,non_http_cases_complete:false,started_at:new Date().toISOString()};
  const initialFd=fs.openSync(summaryFile,'wx',0o600);try{fs.writeFileSync(initialFd,JSON.stringify(initial,null,2)+'\n');fs.fsyncSync(initialFd);}finally{fs.closeSync(initialFd);}phaseSummary=initial;
  for(const batch of phase.batches){
   if(!admitFunctionalBatch(window)){admissionStopped=true;break;}
   command('hosted-acceptance.mjs',['--execute','--batch',batch],deadline,false,FUNCTIONAL_STAGE_LIMITS.http);
   command('hosted-acceptance-operator.mjs',['capture-ids'],deadline,false,FUNCTIONAL_STAGE_LIMITS.capture);
   command('hosted-acceptance-operator.mjs',['status'],deadline,false,FUNCTIONAL_STAGE_LIMITS.status);
   command('hosted-acceptance.mjs',['--reconcile'],deadline,false,FUNCTIONAL_STAGE_LIMITS.reconcile);
   state=get('acceptance-http.json');
   if(state.halted||state.running_batch||Object.values(state.cases).some(c=>c.status==='FAIL'||(c.http==='PASS'&&c.db?.length&&c.status!=='PASS')))fail();
   completed.push(batch);phaseSummary.completed_batches=[...completed];phaseSummary.deferred_batches=[...phase.batches.filter(b=>!completed.includes(b)),...phase.deferred_batches];saveSummary();console.log(JSON.stringify({batch,independent_database_checks:'pass',next:'Continue once; no mutation replay'}));
  }
  phaseSummary.status=completed.length===phase.batches.length?'selected_phase_complete':'partial';phaseSummary.admission_stopped=admissionStopped;phaseSummary.mobile_eligible=mobileDependenciesReady({phase,completed,state,fixtures:fixture,preparedHash:prepared.prepared_release_sha256,leaseId:CONTEXT.leaseId});phaseSummary.finished_at=new Date().toISOString();saveSummary();
  console.log(JSON.stringify({selected_phase:phase.phase,selected_phase_completed:completed.length===phase.batches.length,completed_batches:completed,admission_stopped:admissionStopped,deferred_batches:phaseSummary.deferred_batches,http_batches_completed:false,non_http_cases_complete:false,mobile_eligible:phaseSummary.mobile_eligible,production_release_approved:false,evidence:summaryFile,next:phaseSummary.mobile_eligible?'Reviewed mobile assertions may run within remaining cutoff; aggregate stays open until all required evidence.':'Dependent mobile cases NOT RUN; preserve partial state, reconcile and clean up. Never replay a started batch.'}));
 }
}catch{if(phaseSummary)try{phaseSummary.status='failed_or_unresolved';phaseSummary.mobile_eligible=false;phaseSummary.finished_at=new Date().toISOString();saveSummary();}catch{}console.error('Hosted acceptance sequencing refused or stopped. Private credentials were not printed.');process.exitCode=1;}
