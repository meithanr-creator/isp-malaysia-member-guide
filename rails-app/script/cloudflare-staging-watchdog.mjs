import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {readStagingCredential,validateVerifiedApiCredential} from './staging-credential-provider.mjs';
import {LEGACY_LEASE,LEASE2,selectLease,leaseContext,readPreparedRelease,assertRuntimeRelease,assertPreparedTuple,assertApplication,preparedTuple} from './staging-lease-context.mjs';
const ACCOUNT='a9720867333b64a4f8ee70cdfd673eb9',WORKER='isp-member-production';
export const CLEANUP_BUDGET_MS=300000;
const REQUEST_LIMIT_MS=15000,POLL_MS=5000;
const monotonic=()=>performance.now();
const sleep=(ms,{signal}={})=>delay(ms,undefined,{signal});
class CleanupBudgetExhausted extends Error {}
class CleanupRequestTimeout extends Error {}

export function validatePlan(plan,now=Date.now()) {
 if(plan.account!==ACCOUNT||plan.worker!==WORKER||plan.application_name!==WORKER||!/^[a-f0-9-]{36}$/.test(plan.application_id||''))throw new Error('ISP watchdog identity invalid');
 const start=Date.parse(plan.start_at),end=Date.parse(plan.expires_at);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>55*60000||start>now+60000)throw new Error('ISP watchdog window invalid');
 // Expiry ends acceptance authority, never exact-resource emergency cleanup authority.
 return {stopAt:end-5*60000,end};
}

export function cleanupTiming(plan,{emergency=true,wallNow=Date.now(),monotonicNow=monotonic()}={}) {
 const {stopAt,end}=validatePlan(plan,wallNow);
 const budgetMs=emergency?CLEANUP_BUDGET_MS:Math.max(0,Math.min(CLEANUP_BUDGET_MS,end-wallNow));
 return Object.freeze({started:monotonicNow,deadline:monotonicNow+budgetMs,budgetMs,
  startedAt:new Date(wallNow).toISOString(),deadlineAt:new Date(wallNow+budgetMs).toISOString(),
  lateMs:Math.max(0,wallNow-stopAt),emergency});
}

export function validateWatchdogHandoff(marker,runtimeBytes,planBytes,prepared) {
 const fields=['version','prepared_release_sha256','runtime_sha256','watchdog_plan_sha256','bootstrap_cleanup_retired'];
 if(!marker||Array.isArray(marker)||Object.keys(marker).length!==fields.length||!fields.every(key=>Object.hasOwn(marker,key))||
    marker.version!==1||marker.bootstrap_cleanup_retired!==true||!prepared||
    marker.prepared_release_sha256!==prepared.prepared_release_sha256||
    !/^[a-f0-9]{64}$/.test(marker.prepared_release_sha256)||
    marker.runtime_sha256!==createHash('sha256').update(runtimeBytes).digest('hex')||
    marker.watchdog_plan_sha256!==createHash('sha256').update(planBytes).digest('hex'))throw Error('ISP watchdog handoff incomplete or mismatched');
 return true;
}
export async function stopStaging(plan,api,pause=sleep,{
 context=leaseContext(plan.lease_id===LEASE2?LEASE2:LEGACY_LEASE),prepared=null,
 clock=monotonic,timing=cleanupTiming(plan,{monotonicNow:clock()}),onProgress=()=>{}
}={}) {
 validatePlan(plan);
 if((plan.lease_id!==undefined&&plan.lease_id!==LEASE2)||context.fresh!==(plan.lease_id===LEASE2))throw Error('ISP watchdog lease mismatch');
 assertPreparedTuple(context,plan,prepared);
 if(!Number.isFinite(timing.started)||!Number.isFinite(timing.deadline)||!Number.isFinite(timing.budgetMs)||
    timing.budgetMs<0||timing.budgetMs>CLEANUP_BUDGET_MS||timing.deadline-timing.started!==timing.budgetMs||
    timing.started>clock())throw Error('ISP cleanup deadline invalid');
 const appPath=`/containers/applications/${plan.application_id}`,ingressPath=`/workers/scripts/${WORKER}/subdomain`;
 let applicationAbsent=false,ingressClosed=false,requestFailures=0;
 const remaining=()=>Math.max(0,timing.deadline-clock());
 const receipt=(status,reason)=>({status,shutdown_confirmed:status==='PASS',reason,
  container_application_absent:applicationAbsent,ingress_closed:ingressClosed,
  budget_exhausted:remaining()<=0,cleanup_budget_ms:timing.budgetMs,
  cleanup_elapsed_ms:Math.max(0,Math.ceil(clock()-timing.started)),cleanup_started_at:timing.startedAt,
  cleanup_deadline_at:timing.deadlineAt,cleanup_late_ms:timing.lateMs,
  emergency_cleanup:timing.emergency,request_failures:requestFailures,
  ...(status==='PASS'?{verified_at:new Date().toISOString()}:{})});
 const progress=phase=>onProgress({...receipt('FAIL','shutdown_unconfirmed'),phase});
 async function bounded(operation,limit,timeoutError) {
  if(remaining()<=0)throw new CleanupBudgetExhausted();
  const controller=new AbortController();let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{
   controller.abort();reject(remaining()<=0?new CleanupBudgetExhausted():timeoutError);
  },Math.max(1,Math.ceil(Math.min(limit,remaining()))));});
  try {
   const value=await Promise.race([Promise.resolve().then(()=>operation(controller.signal)),timeout]);
   if(remaining()<=0)throw new CleanupBudgetExhausted();
   return value;
  } finally {clearTimeout(timer);controller.abort();}
 }
 async function request(path,method='GET',body,allow404=false) {
  const timeoutMs=Math.min(REQUEST_LIMIT_MS,remaining());
  try {
   const value=await bounded(signal=>api(path,method,body,allow404,{signal,timeoutMs,deadline:timing.deadline}),timeoutMs,new CleanupRequestTimeout());
   return {ok:true,value};
  } catch(error) {
   if(error instanceof CleanupBudgetExhausted||remaining()<=0)throw new CleanupBudgetExhausted();
   requestFailures++;return {ok:false};
  }
 }
 async function waitForPoll() {
  await bounded(signal=>pause(Math.min(POLL_MS,remaining()),{signal}),remaining(),new CleanupBudgetExhausted());
 }
 function verifyApplication(app) {assertApplication(context,app,plan,prepared);}
 try {
  // The caller persists this intent before any provider mutation. A failed save halts cleanup.
  progress('cleanup_intent');
  while(remaining()>0) {
   // Reconcile before every DELETE, including after a response with an uncertain outcome.
   const observed=await request(appPath,'GET',undefined,true);
   if(!observed.ok){progress('identity_unconfirmed');await waitForPoll();continue;}
   verifyApplication(observed.value);
   applicationAbsent=observed.value===null;
   progress('application_identity_verified');

   if(!ingressClosed)await request(ingressPath,'POST',{enabled:false,previews_enabled:false});
   // Do not put an ingress read/retry between the disable attempt and compute deletion.
   if(!applicationAbsent) {
    await request(appPath,'DELETE');
    progress('application_delete_requested');
    const deleted=await request(appPath,'GET',undefined,true);
    if(deleted.ok){verifyApplication(deleted.value);applicationAbsent=deleted.value===null;}
   }
   if(!ingressClosed) {
    const ingress=await request(ingressPath,'GET',undefined,true);
    if(ingress.ok)ingressClosed=ingress.value?.enabled===false&&ingress.value?.previews_enabled===false;
   }
   progress('shutdown_observed');
   if(applicationAbsent&&ingressClosed)return receipt('PASS','shutdown_confirmed');
   await waitForPoll();
  }
  return receipt('FAIL','cleanup_budget_exhausted');
 } catch(error) {
  if(error instanceof CleanupBudgetExhausted||remaining()<=0)return receipt('FAIL','cleanup_budget_exhausted');
  // Identity/evidence failures are terminal; expose only sanitized partial evidence.
  error.cleanupResult=receipt('FAIL','cleanup_refused_or_evidence_unavailable');
  throw error;
 }
}

export function makeApi(token,{fetchImpl=fetch}={}) {
 return async(path,method='GET',body,allow404=false,{signal,timeoutMs=REQUEST_LIMIT_MS}={})=>{
  if(!/^\/(?:containers\/applications\/[a-f0-9-]{36}|workers\/scripts\/isp-member-production\/subdomain)$/.test(path))throw new Error('Watchdog API path refused');
  const requestSignal=signal??AbortSignal.timeout(Math.max(1,Math.ceil(Math.min(REQUEST_LIMIT_MS,timeoutMs))));
  const response=await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:requestSignal});
  if(allow404&&response.status===404)return null;
  // Body consumption shares the fetch signal and the caller's absolute deadline.
  const data=await response.json();
  if(!response.ok||data.success!==true)throw new Error('Watchdog provider request failed');
  if(method==='GET'&&path.startsWith('/containers/')&&(!data.result||typeof data.result!=='object'||Array.isArray(data.result)))throw new Error('Watchdog application observation ambiguous');
  return data.result;
 };
}

export function makeCredentialApi(credential,{requiredUntil=Date.now(),fetchImpl=fetch,now=()=>Date.now()}={}) {
 if(!credential||!['oauth','api-token'].includes(credential.kind)||typeof credential.token!=='string'||!Number.isFinite(requiredUntil))throw Error('Watchdog credential selection refused');
 let verified=credential.kind==='oauth';
 if(verified&&(!Number.isFinite(Date.parse(credential.expires_at))||Date.parse(credential.expires_at)<=Math.max(now(),requiredUntil)))throw Error('Watchdog credential lifetime unavailable');
 const client=makeApi(credential.token,{fetchImpl});
 return async(path,method='GET',body,allow404=false,options={})=>{
  const signal=options.signal??AbortSignal.timeout(Math.max(1,Math.ceil(Math.min(REQUEST_LIMIT_MS,options.timeoutMs??REQUEST_LIMIT_MS))));
  if(!verified) {
   const response=await fetchImpl('https://api.cloudflare.com/client/v4/user/tokens/verify',{
    method:'GET',headers:{Authorization:`Bearer ${credential.token}`,'Content-Type':'application/json'},redirect:'error',signal});
   const data=await response.json();
   if(!response.ok||data.success!==true)throw Error('Watchdog API credential verification unavailable');
   validateVerifiedApiCredential(credential,data.result,{now:now(),requiredUntil});
   verified=true;
  }
  return client(path,method,body,allow404,{...options,signal});
 };
}
async function main() {
 const enteredAt=monotonic(),enteredWall=Date.now(),mode=process.argv[2];
 if(!['--arm','--stop-now','--check'].includes(mode))throw new Error('Use --check, --arm or --stop-now');
 const selected=leaseContext(selectLease()),PRIVATE=selected.privateRoot;
 if(!selected.fresh&&mode!=='--check'&&existsSync(leaseContext(LEASE2).privateRoot+'/prepared-release.json'))throw Error('Legacy watchdog cannot control the new lease');
 const prepared=readPreparedRelease(selected);
 const planBytes=readFileSync(`${PRIVATE}/watchdog-plan.json`);
 const plan=JSON.parse(planBytes.toString('utf8'));
 const {stopAt}=validatePlan(plan);
 if((plan.lease_id!==undefined&&plan.lease_id!==LEASE2)||selected.fresh!==(plan.lease_id===LEASE2))throw Error('ISP watchdog lease mismatch');
 assertPreparedTuple(selected,plan,prepared);
 if(selected.fresh&&mode==='--arm'){
  const runtimeBytes=readFileSync(`${PRIVATE}/runtime.json`);
  const runtime=JSON.parse(runtimeBytes.toString('utf8'));
  validateWatchdogHandoff(JSON.parse(readFileSync(`${PRIVATE}/watchdog-handoff.json`,'utf8')),runtimeBytes,planBytes,prepared);
  assertRuntimeRelease(selected,runtime,prepared);
  if(plan.start_at!==runtime.ISP_STAGING_START_AT||plan.expires_at!==runtime.ISP_STAGING_EXPIRES_AT||Date.now()>=stopAt)throw Error('ISP watchdog window mismatch');
 }
 const statePath=`${PRIVATE}/watchdog-state.json`;
 const save=state=>writeFileSync(statePath,JSON.stringify({...state,...(selected.fresh?preparedTuple(prepared):{}),application_id:plan.application_id,stop_at:new Date(stopAt).toISOString(),updated_at:new Date().toISOString()},null,2));
 const loadApi=requiredUntil=>selected.fresh
  ?makeCredentialApi(readStagingCredential({requiredUntil}),{requiredUntil})
  :makeApi(JSON.parse(readFileSync(`${selected.credentialRoot}/deployment-token.json`,'utf8')).CLOUDFLARE_API_TOKEN);
 let api;
 if(mode!=='--stop-now') {
  api=loadApi(mode==='--arm'?Date.parse(plan.expires_at):Date.now());
  const app=await api(`/containers/applications/${plan.application_id}`,'GET');
  assertApplication(selected,app,plan,prepared);
  if(mode==='--check'){console.log(JSON.stringify({identity_verified:true,stop_at:new Date(stopAt).toISOString(),mutations:false}));return;}
  save({armed:true,pid:process.pid});
  while(Date.now()<stopAt){await delay(Math.min(20000,stopAt-Date.now()));save({armed:true,pid:process.pid});}
 }
 // Exactly one budget: manual emergency includes entry work; armed cleanup ends by lease expiry.
 const timing=cleanupTiming(plan,mode==='--stop-now'
  ?{emergency:true,wallNow:enteredWall,monotonicNow:enteredAt}
  :{emergency:false});
 let partial={status:'FAIL',shutdown_confirmed:false,reason:'cleanup_unconfirmed',
  container_application_absent:false,ingress_closed:false,budget_exhausted:false,
  cleanup_budget_ms:timing.budgetMs,cleanup_started_at:timing.startedAt,
  cleanup_deadline_at:timing.deadlineAt,cleanup_late_ms:timing.lateMs,emergency_cleanup:timing.emergency};
 let result;
 try {
  save({armed:false,...partial,phase:'cleanup_intent'});
  api??=loadApi(Date.parse(timing.deadlineAt));
  result=await stopStaging(plan,api,sleep,{context:selected,prepared,timing,
   onProgress:state=>{partial=state;save({armed:false,...state});}});
 } catch(error) {
  result=error.cleanupResult??{...partial,status:'FAIL',shutdown_confirmed:false,
   reason:'cleanup_refused_or_access_unavailable',budget_exhausted:monotonic()>=timing.deadline,
   cleanup_elapsed_ms:Math.max(0,Math.ceil(monotonic()-timing.started))};
 }
 save({armed:false,...result,phase:'cleanup_finished'});
 writeFileSync(`${selected.auditRoot}/cloudflare-staging-shutdown.json`,JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
 if(result.status!=='PASS'){
  console.error('ISP shutdown unconfirmed; immediate scoped emergency cleanup required. Do not start another window.');
  process.exitCode=1;
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('ISP watchdog failed; shutdown remains unconfirmed. Inspect private state and stop the exact ISP application immediately. No credentials displayed.');process.exitCode=1;});
