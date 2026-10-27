import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validatePlan,cleanupTiming,validateWatchdogHandoff,stopStaging,makeApi,makeCredentialApi,CLEANUP_BUDGET_MS} from './cloudflare-staging-watchdog.mjs';
import {LEASE2,leaseContext,validatePreparedRelease,preparedTuple} from './staging-lease-context.mjs';
const plan=()=>{const now=Date.now();return {account:'a9720867333b64a4f8ee70cdfd673eb9',worker:'isp-member-production',application_name:'isp-member-production',application_id:'11111111-2222-3333-4444-555555555555',start_at:new Date(now-60000).toISOString(),expires_at:new Date(now+54*60000).toISOString()};};
const app={name:'isp-member-production'};
function fakeTime(p=plan(),budgetMs=300000){
 let now=0;
 const timing={...cleanupTiming(p,{monotonicNow:0}),budgetMs,deadline:budgetMs};
 return {timing,clock:()=>now,pause:async ms=>{now+=ms;},advance:ms=>{now+=ms;},get now(){return now;}};
}
function freshFixture(){
 const prepared={...validatePreparedRelease({version:1,lease_id:LEASE2,account:'a9720867333b64a4f8ee70cdfd673eb9',worker:'isp-member-production',application_name:'isp-member-production',application_id:'11111111-2222-4333-8444-555555555555',namespace_id:'1'.repeat(32),class_name:'RailsStaging2',worker_source:'2'.repeat(40),rails_source:'3'.repeat(40),image_digest:'sha256:'+'4'.repeat(64),rollback_worker_version:'22222222-3333-4444-8555-666666666666',rollback_deployment_id:'33333333-4444-4555-8666-777777777777',activation:false}),prepared_release_sha256:'5'.repeat(64)};
 return {prepared,context:leaseContext(LEASE2),freshPlan:{...plan(),...preparedTuple(prepared)},app:{id:prepared.application_id,name:prepared.application_name,account_id:prepared.account,durable_objects:{namespace_id:prepared.namespace_id}}};
}

test('identity and duration refuse unrelated resources and excess time',()=>{
 const p=plan();assert.equal(validatePlan(p).stopAt,Date.parse(p.expires_at)-300000);
 assert.throws(()=>validatePlan({...p,worker:'other'}));
 assert.throws(()=>validatePlan({...p,account:'other'}));
 assert.throws(()=>validatePlan({...p,application_id:'../../other'}));
 assert.throws(()=>validatePlan({...p,expires_at:new Date(Date.now()+60*60000).toISOString()}));
});

test('armed cleanup has one monotonic deadline capped at lease expiry and records lateness',()=>{
 const p=plan(),end=Date.parse(p.expires_at);
 const normal=cleanupTiming(p,{emergency:false,wallNow:end-300000,monotonicNow:7});
 assert.equal(normal.deadline,300007);assert.equal(normal.budgetMs,CLEANUP_BUDGET_MS);assert.equal(normal.lateMs,0);
 const late=cleanupTiming(p,{emergency:false,wallNow:end-120000,monotonicNow:50});
 assert.equal(late.deadline,120050);assert.equal(late.budgetMs,120000);assert.equal(late.lateMs,180000);
 const expired=cleanupTiming(p,{emergency:false,wallNow:end+2000,monotonicNow:99});
 assert.equal(expired.deadline,99);assert.equal(expired.budgetMs,0);assert.equal(expired.lateMs,302000);
 const emergency=cleanupTiming(p,{emergency:true,wallNow:end+2000,monotonicNow:99});
 assert.equal(emergency.deadline,300099);assert.equal(emergency.emergency,true);
 assert.equal(p.expires_at,new Date(end).toISOString());
});

test('no mutations occur for a mismatched application and sanitized partial evidence survives',async()=>{
 const calls=[];await assert.rejects(stopStaging(plan(),async(path,method)=>{calls.push(method);return {name:'another-project'};}),error=>{
  assert.equal(error.cleanupResult.status,'FAIL');assert.equal(error.cleanupResult.container_application_absent,false);return true;
 });
 assert.deepEqual(calls,['GET']);
});

test('persists intent before mutation, deletes before ingress verification and confirms both controls',async()=>{
 const calls=[],progress=[];let deleted=false;
 const result=await stopStaging(plan(),async(path,method='GET')=>{
  calls.push([path,method]);if(method!=='GET')assert.equal(progress.includes('cleanup_intent'),true);
  if(path.endsWith('/subdomain'))return {enabled:false,previews_enabled:false};
  if(method==='DELETE'){deleted=true;return {message:'Deleting'};}
  return deleted?null:app;
 },async()=>{},{onProgress:state=>progress.push(state.phase)});
 assert.equal(result.status,'PASS');assert.equal(result.shutdown_confirmed,true);
 assert.equal(result.container_application_absent,true);assert.equal(result.ingress_closed,true);
 assert.deepEqual(calls.map(c=>c[1]),['GET','POST','DELETE','GET','GET']);
 assert.equal(calls[2][0].includes('/containers/applications/'),true);
});

test('failed intent persistence prevents all provider calls',async()=>{
 let calls=0;
 await assert.rejects(stopStaging(plan(),async()=>{calls++;return app;},async()=>{},{onProgress:()=>{throw Error('Disk unavailable');}}));
 assert.equal(calls,0);
});

test('ingress API failure still removes compute but reports FAIL at the same deadline',async()=>{
 const p=plan(),time=fakeTime(p),calls=[];let deleted=false;
 const result=await stopStaging(p,async(path,method='GET')=>{
  calls.push([path,method,time.now]);
  if(path.endsWith('/subdomain'))throw Error('Provider unavailable');
  if(method==='DELETE'){deleted=true;return {};}
  return deleted?null:app;
 },time.pause,{...time});
 assert.equal(result.status,'FAIL');assert.equal(result.shutdown_confirmed,false);
 assert.equal(result.container_application_absent,true);assert.equal(result.ingress_closed,false);
 assert.equal(result.budget_exhausted,true);assert.equal(result.cleanup_elapsed_ms,300000);
 assert.equal(calls.findIndex(([,method])=>method==='DELETE'),2);
 assert.equal(calls.every(([, ,at])=>at<300000),true);
});

test('missing ingress response never blocks prompt compute deletion or becomes an invented ingress PASS',async()=>{
 const p=plan(),time=fakeTime(p,15000);let deleted=false;
 const result=await stopStaging(p,async(path,method='GET')=>{
  if(path.endsWith('/subdomain'))return null;
  if(method==='DELETE'){deleted=true;return {};}
  return deleted?null:app;
 },time.pause,{...time});
 assert.equal(deleted,true);assert.equal(result.container_application_absent,true);
 assert.equal(result.ingress_closed,false);assert.equal(result.status,'FAIL');assert.equal(result.budget_exhausted,true);
});

test('pending deletion consumes only one absolute budget with no outer retry reset',async()=>{
 const p=plan(),time=fakeTime(p),timeouts=[];let polls=0;
 const result=await stopStaging(p,async(path,method='GET',body,allow404,options)=>{
  assert.equal(options.deadline,300000);timeouts.push(options.timeoutMs);
  if(path.endsWith('/subdomain'))return {enabled:false,previews_enabled:false};
  if(method==='DELETE')return {};
  polls++;return app;
 },time.pause,{...time});
 assert.equal(result.status,'FAIL');assert.equal(result.reason,'cleanup_budget_exhausted');
 assert.equal(result.container_application_absent,false);assert.equal(result.ingress_closed,true);
 assert.equal(result.cleanup_elapsed_ms,300000);assert.equal(result.budget_exhausted,true);
 assert.equal(polls,120);assert.equal(timeouts.every(ms=>ms>0&&ms<=15000),true);
});

test('slow successful requests share remaining time and cannot acquire another five minutes',async()=>{
 const p=plan(),time=fakeTime(p),calls=[];
 const result=await stopStaging(p,async(path,method='GET',body,allow404,options)=>{
  const before=time.now;assert.equal(options.timeoutMs,Math.min(15000,300000-before));
  calls.push([method,before,options.timeoutMs]);time.advance(options.timeoutMs);
  return path.endsWith('/subdomain')?{enabled:false,previews_enabled:false}:app;
 },time.pause,{...time});
 assert.equal(result.status,'FAIL');assert.equal(result.cleanup_elapsed_ms,300000);
 assert.equal(result.budget_exhausted,true);assert.equal(calls.at(-1)[1]+calls.at(-1)[2],300000);
 assert.equal(calls.every(([,at])=>at<300000),true);
});

test('failed requests retry only inside the same deadline and cannot mutate without verified identity',async()=>{
 const p=plan(),time=fakeTime(p,31000),calls=[];
 const result=await stopStaging(p,async(path,method,body,allow404,options)=>{
  calls.push(method);time.advance(options.timeoutMs);throw Error('Unavailable');
 },time.pause,{...time});
 assert.equal(result.status,'FAIL');assert.equal(result.budget_exhausted,true);
 assert.equal(result.container_application_absent,false);assert.deepEqual(calls,['GET','GET']);
 assert.equal(time.now,31000);
});

test('uncertain DELETE is reconciled by exact GET before another scoped delete',async()=>{
 const p=plan(),time=fakeTime(p,30000),calls=[];let deletes=0;
 const result=await stopStaging(p,async(path,method='GET')=>{
  calls.push([path,method]);
  if(path.endsWith('/subdomain'))return {enabled:false,previews_enabled:false};
  if(method==='DELETE'){deletes++;if(deletes===1)throw Error('Response lost');return {};}
  return deletes>=2?null:app;
 },time.pause,{...time});
 assert.equal(result.status,'PASS');assert.equal(deletes,2);
 const deleteIndexes=calls.flatMap(([,method],i)=>method==='DELETE'?[i]:[]);
 for(const i of deleteIndexes){assert.deepEqual(calls[i+1],[calls[i][0],'GET']);}
 assert.equal(calls.filter(([path,method])=>method==='DELETE').every(([path])=>path===`/containers/applications/${p.application_id}`),true);
});

test('already absent exact compute still closes ingress without DELETE',async()=>{
 const methods=[];
 const result=await stopStaging(plan(),async(path,method='GET')=>{methods.push(method);return path.endsWith('/subdomain')?{enabled:false,previews_enabled:false}:null;},async()=>{});
 assert.equal(result.status,'PASS');assert.equal(result.container_application_absent,true);
 assert.equal(methods.includes('DELETE'),false);assert.deepEqual(methods,['GET','POST','GET']);
});

test('expired armed budget performs no request and does not report shutdown',async()=>{
 const p=plan(),end=Date.parse(p.expires_at),timing=cleanupTiming(p,{emergency:false,wallNow:end+1,monotonicNow:0});let calls=0;
 const result=await stopStaging(p,async()=>{calls++;return app;},async()=>{},{clock:()=>0,timing});
 assert.equal(calls,0);assert.equal(result.status,'FAIL');assert.equal(result.budget_exhausted,true);
 assert.equal(result.cleanup_late_ms,300001);assert.equal(result.container_application_absent,false);
});

test('fresh watchdog cannot fall through legacy or proceed without sealed identity',async()=>{
 const f=freshFixture(),calls=[],api=async(...args)=>{calls.push(args);return f.app;};
 await assert.rejects(stopStaging(f.freshPlan,api,async()=>{}));
 await assert.rejects(stopStaging(f.freshPlan,api,async()=>{},{context:leaseContext(),prepared:f.prepared}));
 await assert.rejects(stopStaging({...f.freshPlan,prepared_release_sha256:'6'.repeat(64)},api,async()=>{},{context:f.context,prepared:f.prepared}));
 assert.deepEqual(calls,[]);
});

test('fresh watchdog rejects wrong account, app or namespace before mutation',async()=>{
 const f=freshFixture();
 for(const observed of [{...f.app,account_id:'other'},{...f.app,id:f.prepared.rollback_worker_version},{...f.app,durable_objects:{namespace_id:'a0e936fb9d634f59b1caaa1896b07a1f'}}]){
  const calls=[];await assert.rejects(stopStaging(f.freshPlan,async(path,method='GET')=>{calls.push([path,method]);return observed;},async()=>{},{context:f.context,prepared:f.prepared}));
  assert.deepEqual(calls,[[`/containers/applications/${f.prepared.application_id}`,'GET']]);
 }
});

test('foreign identity during deletion reconciliation terminates without another mutation',async()=>{
 const f=freshFixture(),calls=[];let deleted=false;
 await assert.rejects(stopStaging(f.freshPlan,async(path,method='GET')=>{
  calls.push([path,method]);if(path.endsWith('/subdomain'))return {enabled:false,previews_enabled:false};
  if(method==='DELETE'){deleted=true;return {};}
  return deleted?{...f.app,account_id:'other'}:f.app;
 },async()=>{},{context:f.context,prepared:f.prepared}),error=>{
  assert.equal(error.cleanupResult.status,'FAIL');assert.equal(error.cleanupResult.container_application_absent,false);return true;
 });
 assert.deepEqual(calls.map(([,method])=>method),['GET','POST','DELETE','GET']);
});

test('post-expiry fresh emergency stop needs sealed identity and no runtime input or lease extension',async()=>{
 const f=freshFixture(),end=Date.now()-60000;
 f.freshPlan={...f.freshPlan,start_at:new Date(end-55*60000).toISOString(),expires_at:new Date(end).toISOString()};
 const before=JSON.stringify(f.freshPlan),timing=cleanupTiming(f.freshPlan,{emergency:true,monotonicNow:0});let deleted=false;
 const result=await stopStaging(f.freshPlan,async(path,method='GET')=>{
  if(path.endsWith('/subdomain'))return {enabled:false,previews_enabled:false};
  if(method==='DELETE'){deleted=true;return {};}
  return deleted?null:f.app;
 },async()=>{},{context:f.context,prepared:f.prepared,timing,clock:()=>0});
 assert.equal(result.status,'PASS');assert.equal(result.emergency_cleanup,true);assert.equal(result.cleanup_budget_ms,300000);
 assert.equal(JSON.stringify(f.freshPlan),before);
});

test('real stalled request is aborted at remaining deadline with explicit unconfirmed failure',async()=>{
 const p=plan(),started=performance.now(),timing={...cleanupTiming(p,{monotonicNow:started}),deadline:started+30,budgetMs:30};let signal;
 const result=await stopStaging(p,async(path,method,body,allow404,options)=>{signal=options.signal;return new Promise(()=>{});},undefined,{timing});
 assert.equal(signal.aborted,true);assert.equal(result.status,'FAIL');assert.equal(result.budget_exhausted,true);
 assert.equal(result.container_application_absent,false);assert.ok(performance.now()-started<1000);
});

test('provider response body stall shares fetch signal and the absolute cleanup deadline',async()=>{
 const p=plan(),started=performance.now(),timing={...cleanupTiming(p,{monotonicNow:started}),deadline:started+30,budgetMs:30};let signal,bodyStarted=false;
 const api=makeApi('synthetic-unit-token',{fetchImpl:async(url,options)=>{
  signal=options.signal;return {status:200,ok:true,json:()=>{bodyStarted=true;return new Promise(()=>{});}};
 }});
 const result=await stopStaging(p,api,undefined,{timing});
 assert.equal(bodyStarted,true);assert.equal(signal.aborted,true);assert.equal(result.status,'FAIL');assert.equal(result.budget_exhausted,true);
});

test('successful null/array provider application payload is ambiguous, not application absence',async()=>{
 for(const value of [null,[],false]){
  const api=makeApi('synthetic-unit-token',{fetchImpl:async()=>({status:200,ok:true,json:async()=>({success:true,result:value})})});
  await assert.rejects(api(`/containers/applications/${plan().application_id}`,'GET',undefined,true),/ambiguous/);
 }
 const api=makeApi('synthetic-unit-token',{fetchImpl:async()=>({status:404,ok:false,json:async()=>{throw Error('Must not parse404');}})});
 assert.equal(await api(`/containers/applications/${plan().application_id}`,'GET',undefined,true),null);
});

test('provider client refuses unrelated paths before fetch',async()=>{
 let calls=0;const api=makeApi('synthetic-unit-token',{fetchImpl:async()=>{calls++;throw Error('Must not fetch');}});
 await assert.rejects(api('/containers/applications/../../other','DELETE'));
 await assert.rejects(api('/workers/scripts/another-project/subdomain','POST',{}));
 assert.equal(calls,0);
});

test('fresh arming requires the complete exact five-field handoff and hashes of actual bytes',()=>{
 const f=freshFixture(),runtime=Buffer.from('{"synthetic_runtime":true}\n'),planBytes=Buffer.from(JSON.stringify(f.freshPlan,null,2)+'\n');
 const marker={version:1,prepared_release_sha256:f.prepared.prepared_release_sha256,
  runtime_sha256:createHash('sha256').update(runtime).digest('hex'),
  watchdog_plan_sha256:createHash('sha256').update(planBytes).digest('hex'),bootstrap_cleanup_retired:true};
 assert.equal(validateWatchdogHandoff(marker,runtime,planBytes,f.prepared),true);
 for(const invalid of [null,{...marker,bootstrap_cleanup_retired:false},{...marker,unexpected:true},
  {...marker,version:2},{...marker,prepared_release_sha256:'a'.repeat(64)},
  {...marker,runtime_sha256:'b'.repeat(64)},{...marker,watchdog_plan_sha256:'c'.repeat(64)}]){
  assert.throws(()=>validateWatchdogHandoff(invalid,runtime,planBytes,f.prepared));
 }
 assert.throws(()=>validateWatchdogHandoff(marker,Buffer.concat([runtime,Buffer.from(' ')]),planBytes,f.prepared));
 assert.throws(()=>validateWatchdogHandoff(marker,runtime,Buffer.concat([planBytes,Buffer.from(' ')]),f.prepared));
 assert.throws(()=>validateWatchdogHandoff(marker,runtime,planBytes,null));
});

test('OAuth selected client uses actual expiry and scoped identity without API-token verification',async()=>{
 const calls=[],now=Date.now(),credential={kind:'oauth',token:'synthetic-unit-oauth-token',expires_at:new Date(now+60000).toISOString(),token_id:null};
 const api=makeCredentialApi(credential,{requiredUntil:now+30000,now:()=>now,fetchImpl:async(url)=>{
  calls.push(url);return {ok:true,status:200,json:async()=>({success:true,result:app})};
 }});
 assert.deepEqual(await api(`/containers/applications/${plan().application_id}`),app);
 assert.equal(calls.length,1);assert.equal(calls[0].includes('/user/tokens/verify'),false);
 assert.throws(()=>makeCredentialApi(credential,{requiredUntil:now+60000,now:()=>now}));
});

test('API selected client verifies actual active expiry through deadline before scoped requests',async()=>{
 const calls=[],now=Date.now(),credential={kind:'api-token',token:'synthetic-unit-api-token',expires_at:null,token_id:null};
 const api=makeCredentialApi(credential,{requiredUntil:now+30000,now:()=>now,fetchImpl:async(url)=>{
  calls.push(url);return {ok:true,status:200,json:async()=>({success:true,result:url.endsWith('/user/tokens/verify')
   ?{status:'active',id:'1'.repeat(32),expires_on:new Date(now+60000).toISOString()}:app})};
 }});
 await api(`/containers/applications/${plan().application_id}`);
 await api(`/containers/applications/${plan().application_id}`);
 assert.equal(calls.filter(url=>url.endsWith('/user/tokens/verify')).length,1);
 assert.equal(calls[0],'https://api.cloudflare.com/client/v4/user/tokens/verify');
});

test('insufficient actual API expiry cannot reach a scoped mutation or fallback provider',async()=>{
 const calls=[],now=Date.now(),credential={kind:'api-token',token:'synthetic-unit-api-token',expires_at:null,token_id:null};
 const api=makeCredentialApi(credential,{requiredUntil:now+30000,now:()=>now,fetchImpl:async(url)=>{
  calls.push(url);return {ok:true,status:200,json:async()=>({success:true,result:{status:'active',id:'1'.repeat(32),expires_on:new Date(now+10000).toISOString()}})};
 }});
 await assert.rejects(api(`/containers/applications/${plan().application_id}`,'DELETE'));
 assert.deepEqual(calls,['https://api.cloudflare.com/client/v4/user/tokens/verify']);
});

test('API-token verification body stall is bounded by the same cleanup deadline',async()=>{
 const p=plan(),started=performance.now(),timing={...cleanupTiming(p,{monotonicNow:started}),deadline:started+30,budgetMs:30};let signal;
 const api=makeCredentialApi({kind:'api-token',token:'synthetic-unit-api-token'},{fetchImpl:async(url,options)=>{
  assert.equal(url.endsWith('/user/tokens/verify'),true);signal=options.signal;
  return {ok:true,status:200,json:()=>new Promise(()=>{})};
 }});
 const result=await stopStaging(p,api,undefined,{timing});
 assert.equal(signal.aborted,true);assert.equal(result.status,'FAIL');assert.equal(result.budget_exhausted,true);
 assert.equal(result.container_application_absent,false);
});

test('fractional monotonic deadline validates its exact construction without cancellation error',async()=>{
 const p=plan(),started=2.0123442099999997,budgetMs=30,timing={...cleanupTiming(p,{monotonicNow:started}),deadline:started+budgetMs,budgetMs};
 assert.notEqual(timing.deadline-started,budgetMs);
 let calls=0;const result=await stopStaging(p,async()=>{calls++;throw Error('Expired budget must not send');},undefined,{timing,clock:()=>timing.deadline+1});
 assert.equal(result.status,'FAIL');assert.equal(result.budget_exhausted,true);assert.equal(calls,0);
 await assert.rejects(stopStaging(p,async()=>{},undefined,{timing:{...timing,deadline:timing.deadline+1},clock:()=>timing.deadline+2}),/deadline invalid/);
});
test('an early timer wakeup cannot prematurely exhaust the same absolute cleanup budget',async()=>{
 const p=plan(),time=fakeTime(p,30),scheduled=[];let signal,calls=0;
 const run=stopStaging(p,async(path,method,body,allow404,options)=>{calls++;signal=options.signal;return new Promise(()=>{});},time.pause,{timing:time.timing,clock:time.clock,setTimer:(fn,ms)=>{const timer={fn,ms};scheduled.push(timer);return timer;},clearTimer:()=>{}});
 await Promise.resolve();assert.equal(calls,1);assert.equal(scheduled.length,1);assert.equal(scheduled[0].ms,30);
 time.advance(29);scheduled.shift().fn();assert.equal(signal.aborted,false);assert.equal(scheduled.length,1);assert.equal(scheduled[0].ms,1);
 time.advance(1);scheduled.shift().fn();const result=await run;
 assert.equal(signal.aborted,true);assert.equal(result.status,'FAIL');assert.equal(result.budget_exhausted,true);assert.equal(result.cleanup_budget_ms,30);assert.equal(calls,1);assert.equal(scheduled.length,0);
});