import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {LEASE2,LEASE3,leaseContext,validatePreparedRelease,preparedTuple} from './staging-lease-context.mjs';
import {LEASE3_POLICY as P} from './lease3-release-policy.mjs';
import {assertHostedRuntimeMode,assertActiveStagingAdmission,assertAdmissionSnapshotDigest} from './active-staging-admission.mjs';
import {immutableObservationProof,reconcileObservationCases} from './immutable-acceptance-evidence.mjs';
import {Transport} from './hosted-acceptance.mjs';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const stamp=value=>new Date(value).toISOString();
const clone=structuredClone;
const FIXED_NOW=Date.parse('2026-10-27T04:01:00Z'),PID=86420;
const APP='11111111-2222-4333-8444-555555555555',ROLLBACK='22222222-3333-4444-8555-666666666666',ROLLBACK_DEPLOY='33333333-4444-4555-8666-777777777777',ACTIVE='44444444-5555-4666-8777-888888888888',ACTIVE_DEPLOY='55555555-6666-4777-8888-999999999999';
function fixture(now=FIXED_NOW){
 const start=Math.floor(now/1000)*1000-60000,end=start+55*60000;
 const record=validatePreparedRelease({version:1,lease_id:LEASE3,account:P.account,worker:P.worker,application_name:P.worker,application_id:APP,namespace_id:'1'.repeat(32),class_name:P.class_name,worker_source:'2'.repeat(40),rails_source:P.rails_source,image_digest:P.image_digest,rollback_worker_version:ROLLBACK,rollback_deployment_id:ROLLBACK_DEPLOY,activation:false},LEASE3);
 const prepared={...record,prepared_release_sha256:sha(encode(record))};
 const runtime={APP_HOST:P.app_host,RAILS_ENV:'production',ISP_DEMO_MODE:'false',ISP_ACCOUNT_EMAILS_ENABLED:'false',ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED:'false',ISP_CONTAINER_ENABLED:'true',ISP_STAGING_KEY:'9'.repeat(64),ISP_STAGING_LEASE:LEASE3,APPLICATION_ID:APP,NAMESPACE_ID:prepared.namespace_id,CANDIDATE_COMMIT:prepared.worker_source,RAILS_SOURCE:P.rails_source,IMAGE_DIGEST:P.image_digest,ROLLBACK_WORKER_VERSION:ROLLBACK,PREPARED_RELEASE_SHA256:prepared.prepared_release_sha256,ISP_STAGING_START_AT:stamp(start),ISP_STAGING_EXPIRES_AT:stamp(end),CLOUDFLARE_WORKER_VERSION:ACTIVE,CLOUDFLARE_DEPLOYMENT_ID:ACTIVE_DEPLOY};
 const plan={...preparedTuple(prepared),start_at:runtime.ISP_STAGING_START_AT,expires_at:runtime.ISP_STAGING_EXPIRES_AT},state={...plan,armed:true,pid:PID,updated_at:stamp(now),stop_at:stamp(end-5*60000)},active={...preparedTuple(prepared),activation:true,ingress_enabled:true,worker_version:ACTIVE,deployment_id:ACTIVE_DEPLOY};
 const value={context:leaseContext(LEASE3),prepared,runtime,plan,state,active,start,end,now};refresh(value);return value;
}
function refresh(f){
 f.runtimeBytes=encode(f.runtime);f.planBytes=encode(f.plan);f.activeBytes=encode(f.active);f.handoff={version:1,prepared_release_sha256:f.prepared.prepared_release_sha256,runtime_sha256:sha(f.runtimeBytes),watchdog_plan_sha256:sha(f.planBytes),bootstrap_cleanup_retired:true};f.handoffBytes=encode(f.handoff);return f;
}
function input(f,overrides={}){return {context:f.context,prepared:f.prepared,expectedRuntime:f.runtime,runtimeBytes:f.runtimeBytes,planBytes:f.planBytes,handoffBytes:f.handoffBytes,activeBytes:f.activeBytes,state:f.state,now:f.now,pidAlive:pid=>pid===PID,...overrides};}

test('actual admission accepts strict lease3 tuple and exact raw handoff with a live watchdog',()=>{
 const f=fixture(),proof=assertActiveStagingAdmission(input(f));assert.equal(proof.runtime.RAILS_ENV,'production');assert.equal(proof.active.worker_version,ACTIVE);assert.ok(Object.isFrozen(proof.snapshot));assert.deepEqual(proof.snapshot,{runtime_sha256:sha(f.runtimeBytes),plan_sha256:sha(f.planBytes),active_sha256:sha(f.activeBytes),prepared_release_sha256:f.prepared.prepared_release_sha256,watchdog_pid:PID});assert.doesNotThrow(()=>assertActiveStagingAdmission(input(f,{expectedSnapshot:proof.snapshot})));
});
test('hosted mode requires exact host, production and all disabled mail/demo flags',()=>{
 const f=fixture();assert.equal(assertHostedRuntimeMode(f.runtime),f.runtime);
 for(const change of [{APP_HOST:'foreign.invalid'},{RAILS_ENV:undefined},{RAILS_ENV:'development'},{RAILS_ENV:'test'},{ISP_DEMO_MODE:'true'},{ISP_ACCOUNT_EMAILS_ENABLED:'true'},{ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED:'true'}])assert.throws(()=>assertHostedRuntimeMode({...f.runtime,...change}),/hosted_runtime_mode_required/);
});
test('admission refuses retired context and sealed runtime/application/namespace mismatches',()=>{
 const f=fixture();assert.throws(()=>assertActiveStagingAdmission(input(f,{context:leaseContext(LEASE2)})));
 for(const change of [{ISP_STAGING_LEASE:LEASE2},{APPLICATION_ID:ACTIVE},{NAMESPACE_ID:P.predecessor.namespace_id},{CANDIDATE_COMMIT:'f'.repeat(40)},{RAILS_SOURCE:'f'.repeat(40)},{IMAGE_DIGEST:'sha256:'+'f'.repeat(64)},{PREPARED_RELEASE_SHA256:'f'.repeat(64)}]){const bad=fixture();Object.assign(bad.runtime,change);refresh(bad);assert.throws(()=>assertActiveStagingAdmission(input(bad)));}
});
test('runtime and raw handoff replacement fail before PID admission',()=>{
 const f=fixture();let checked=0;
 assert.throws(()=>assertActiveStagingAdmission(input(f,{expectedRuntime:{...f.runtime,APP_HOST:'foreign.invalid'},pidAlive:()=>{checked++;return true;}})),/execution_runtime_replaced/);
 for(const change of [{runtime_sha256:'f'.repeat(64)},{watchdog_plan_sha256:'f'.repeat(64)},{prepared_release_sha256:'f'.repeat(64)},{bootstrap_cleanup_retired:false},{extra:true}])assert.throws(()=>assertActiveStagingAdmission(input(f,{handoffBytes:encode({...f.handoff,...change}),pidAlive:()=>{checked++;return true;}})),/handoff/);
 assert.throws(()=>assertActiveStagingAdmission(input(f,{runtimeBytes:Buffer.concat([f.runtimeBytes,Buffer.from(' ')]),pidAlive:()=>{checked++;return true;}})),/handoff/);assert.equal(checked,0);
});
test('active receipt must pin current distinct version/deployment and enabled ingress',()=>{
 for(const change of [{worker_version:ROLLBACK},{worker_version:APP},{deployment_id:ROLLBACK_DEPLOY},{deployment_id:APP},{ingress_enabled:false},{activation:false}]){const f=fixture();Object.assign(f.active,change);refresh(f);assert.throws(()=>assertActiveStagingAdmission(input(f)));}
});
test('dead stale future disarmed or mismatched watchdog cannot admit work',()=>{
 for(const change of [{armed:false},{pid:0},{pid:1.5},{stop_at:stamp(FIXED_NOW)},{updated_at:stamp(FIXED_NOW-45001)},{updated_at:stamp(FIXED_NOW+5001)},{namespace_id:P.predecessor.namespace_id}]){const f=fixture();Object.assign(f.state,change);assert.throws(()=>assertActiveStagingAdmission(input(f)));}
 for(const pidAlive of [()=>false,()=>{throw Error('unknown');},undefined])assert.throws(()=>assertActiveStagingAdmission(input(fixture(),{pidAlive})),/watchdog_process_unavailable/);
});
test('fixed runtime reserve and required remaining duration are strict',()=>{
 const f=fixture(),remaining=f.end-600000-f.now;assert.doesNotThrow(()=>assertActiveStagingAdmission(input(f,{minimumRemainingMs:remaining-1})));assert.throws(()=>assertActiveStagingAdmission(input(f,{minimumRemainingMs:remaining})),/cleanup_reserve/);assert.throws(()=>assertActiveStagingAdmission(input(f,{now:f.start-1})),/cleanup_reserve/);
 for(const minimumRemainingMs of [-1,NaN,Infinity])assert.throws(()=>assertActiveStagingAdmission(input(f,{minimumRemainingMs})));
});
test('accepted snapshot pins byte identity of runtime plan active receipt and watchdog PID',()=>{
 const f=fixture(),initial=assertActiveStagingAdmission(input(f)).snapshot;
 for(const key of Object.keys(initial))assert.throws(()=>assertActiveStagingAdmission(input(f,{expectedSnapshot:{...initial,[key]:key==='watchdog_pid'?PID+1:'f'.repeat(64)}})),/execution_admission_replaced/);
 const changed=fixture();changed.state.pid=PID+1;assert.throws(()=>assertActiveStagingAdmission(input(changed,{expectedSnapshot:initial,pidAlive:()=>true})),/execution_admission_replaced/);
});
test('parent snapshot digest rejects coordinated valid record replacement and invalid digest',()=>{
 const f=fixture(),first=assertActiveStagingAdmission(input(f)).snapshot,digest=sha(Buffer.from(JSON.stringify(first)));assert.equal(assertAdmissionSnapshotDigest(first,digest),first);
 const replaced=fixture();replaced.runtime.CLOUDFLARE_WORKER_VERSION=APP;replaced.active.worker_version=APP;refresh(replaced);const next=assertActiveStagingAdmission(input(replaced)).snapshot;assert.notDeepEqual(next,first);assert.throws(()=>assertAdmissionSnapshotDigest(next,digest),/parent_execution_admission_replaced/);
 for(const invalid of [undefined,null,'','bad',digest.toUpperCase(),'f'.repeat(64)])assert.throws(()=>assertAdmissionSnapshotDigest(first,invalid),/parent_execution_admission_replaced/);
});

function observationFixture(published=true){
 const observation={version:1,lease_id:LEASE3,run_marker:'qa-20261027-0123456789ab',target:{database:'synthetic-readonly'},captured_at:stamp(FIXED_NOW),events:[{id:123,published,label:'synthetic café'}]};
 const raw=Buffer.from('\ufeff'+JSON.stringify(observation,null,4).replaceAll('\n','\r\n')+'\r\n');
 const state={lease_id:LEASE3,run_marker:observation.run_marker,target:clone(observation.target),cases:{event_publish:{id:'event_publish',http:'PASS',status:'BLOCKED',db:[{collection:'events',where:{id:123},count:1,equals:{published:true}}],observed_after:stamp(FIXED_NOW-1000),assertions:[],reason:'Awaiting independent observation'}}};
 const retained=new Map(),calls=[];
 const seal=(id,batch,bytes)=>{calls.push(['seal',id,batch]);assert.equal(state.cases[id].status,'BLOCKED');const previous=retained.get(id);const proof=immutableObservationProof(bytes,previous);if(previous===undefined)retained.set(id,Buffer.from(bytes));return {...proof,file:'D:/synthetic-evidence/'+batch+'-'+id+'.json'};};
 const rulesMatch=(value,rules)=>{calls.push(['rules']);assert.deepEqual(rules,state.cases.event_publish.db);return value.events?.some(row=>row.id===123&&row.published===true)===true;};
 return {observation,raw,state,retained,calls,seal,rulesMatch,inventory:{event_publish:['event-publish','events']}};
}
const reconciliation=(f,extra={})=>({state:f.state,raw:f.raw,inventory:f.inventory,seal:f.seal,rulesMatch:f.rulesMatch,leaseId:LEASE3,now:FIXED_NOW,...extra});

test('immutable proof hashes formatted original bytes including BOM and Unicode',()=>{
 const f=observationFixture(),proof=immutableObservationProof(f.raw);assert.equal(proof.sha256,sha(f.raw));assert.equal(proof.length,f.raw.length);assert.notEqual(proof.sha256,sha(encode(f.observation)));assert.deepEqual(immutableObservationProof(f.raw,Buffer.from(f.raw)),proof);assert.throws(()=>immutableObservationProof(f.raw,Buffer.concat([f.raw,Buffer.from(' ')])),/preserve the original capture/);
 for(const bad of [null,[],f.raw.toString(),Buffer.alloc(0),Buffer.alloc(16777217)])assert.throws(()=>immutableObservationProof(bad),/Bounded raw observation/);
});
test('reconciliation seals exact raw bytes before a case can become PASS',()=>{
 const f=observationFixture();assert.equal(reconcileObservationCases(reconciliation(f)),1);const entry=f.state.cases.event_publish;assert.equal(entry.status,'PASS');assert.equal(entry.http,'PASS');assert.equal(entry.observation_sha256,sha(f.raw));assert.equal(entry.db_observed_at,f.observation.captured_at);assert.deepEqual(f.retained.get('event_publish'),f.raw);assert.deepEqual(f.calls.map(row=>row[0]),['rules','seal']);assert.equal(entry.assertions.length,1);
});
test('reconciliation parses raw independently and cannot accept a separate forged observation',()=>{
 const f=observationFixture(false),forged={...f.observation,events:[{id:123,published:true}]};let seen;
 assert.equal(reconcileObservationCases(reconciliation(f,{observation:forged,rulesMatch:value=>{seen=value;return value.events[0].published;}})),1);assert.equal(seen.events[0].published,false);assert.notEqual(seen,forged);assert.equal(f.state.cases.event_publish.status,'FAIL');assert.equal(f.state.cases.event_publish.observation_sha256,sha(f.raw));
});
test('existing different immutable capture and storage failure preserve BLOCKED disposition',()=>{
 for(const failure of ['existing','storage']){const f=observationFixture(),before=clone(f.state);if(failure==='existing')f.retained.set('event_publish',encode(f.observation));const seal=failure==='storage'?()=>{throw Error('synthetic storage unavailable');}:f.seal;assert.throws(()=>reconcileObservationCases(reconciliation(f,{seal})));assert.deepEqual(f.state,before);}
});
test('incorrect seal hash length or file identity cannot promote a case',()=>{
 for(const change of [{sha256:'f'.repeat(64)},{length:0},{file:undefined}]){const f=observationFixture(),before=clone(f.state),proof=immutableObservationProof(f.raw);assert.throws(()=>reconcileObservationCases(reconciliation(f,{seal:()=>({...proof,file:'D:/synthetic.json',...change})})),/Retained observation identity mismatch/);assert.deepEqual(f.state,before);}
});
test('FAIL or PASS cases retain their original evidence and cannot be rebound to a later capture',()=>{
 for(const status of ['FAIL','PASS']){const f=observationFixture();Object.assign(f.state.cases.event_publish,{status,observation_sha256:'e'.repeat(64),observation_file:'D:/original.json'});const before=clone(f.state);assert.equal(reconcileObservationCases(reconciliation(f)),0);assert.deepEqual(f.state,before);assert.equal(f.calls.length,0);}
});
test('malformed stale foreign or future raw observations cannot close cases',()=>{
 for(const change of [{version:2},{lease_id:LEASE2},{run_marker:'foreign'},{target:{database:'foreign'}},{captured_at:'invalid'},{captured_at:stamp(FIXED_NOW+5001)},{captured_at:stamp(FIXED_NOW-1001)}]){const f=observationFixture(),before=clone(f.state);assert.equal(reconcileObservationCases(reconciliation(f,{raw:encode({...f.observation,...change})})),0);assert.deepEqual(f.state,before);assert.equal(f.calls.length,0);}
 const malformed=observationFixture(),before=clone(malformed.state);assert.throws(()=>reconcileObservationCases(reconciliation(malformed,{raw:Buffer.from('{broken')})));assert.deepEqual(malformed.state,before);assert.equal(malformed.calls.length,0);
});

test('admission rejects malformed oversized or nonobject raw records before PID probing',()=>{
 const f=fixture();let pidChecks=0;
 for(const key of ['runtimeBytes','planBytes','handoffBytes','activeBytes'])for(const raw of [Buffer.alloc(0),Buffer.alloc(16385),Buffer.from('[]'),'not raw bytes'])assert.throws(()=>assertActiveStagingAdmission(input(f,{[key]:raw,pidAlive:()=>{pidChecks++;return true;}})));assert.equal(pidChecks,0);
});
function httpHarness(events=[]){
 const pending=[];
 const requestImpl=(url,options,onResponse)=>{events.push('dispatch');const req=new EventEmitter();req.write=()=>events.push('write');req.end=()=>events.push('end');let ended=false;
  pending.push({url,options,respond(text='synthetic response'){assert.equal(ended,false);ended=true;const res=new EventEmitter();res.headers={'x-isp-trace':options.headers['x-isp-trace']};res.statusCode=200;res.destroy=error=>res.emit('error',error);onResponse(res);res.emit('data',Buffer.from(text));res.emit('end');}});return req;
 };
 return {pending,requestImpl,events};
}
const httpState=f=>({execution_started:stamp(f.start),request_count:0});
test('HTTP performs no dispatch persistence journal or counters when actual admission fails',async()=>{
 const f=fixture(Date.now());f.runtime.RAILS_ENV='development';refresh(f);const state=httpState(f),before=clone(state),http=httpHarness();let persists=0,admissions=0;
 const transport=new Transport(f.runtime,state,{admit:limit=>{admissions++;return assertActiveStagingAdmission(input(f,{now:Date.now(),minimumRemainingMs:limit}));},requestImpl:http.requestImpl,persistState:()=>{persists++;}});
 await assert.rejects(transport.request('member','/admin/events',{method:'POST',body:{type:'application/x-www-form-urlencoded',bytes:Buffer.from('synthetic=1')}}),/hosted_runtime_mode_required/);assert.equal(admissions,1);assert.equal(http.pending.length,0);assert.equal(persists,0);assert.deepEqual(state,before);assert.equal(transport.calls,0);assert.equal(transport.active,0);assert.equal(transport.traces.length,0);assert.equal(transport.jars.size,0);
});
test('admitted HTTP persists its UUID intent before dispatch and uses the exact request duration',async()=>{
 const f=fixture(Date.now()),state=httpState(f),http=httpHarness(),saved=[],limits=[],initial=assertActiveStagingAdmission(input(f)).snapshot;
 const transport=new Transport(f.runtime,state,{admit:limit=>{limits.push(limit);return assertActiveStagingAdmission(input(f,{now:Date.now(),minimumRemainingMs:limit,expectedSnapshot:initial}));},requestImpl:http.requestImpl,persistState:value=>{http.events.push('persist');saved.push(clone(value));}});
 const pending=transport.request('member','/member/dashboard');assert.deepEqual(http.events.slice(0,2),['persist','dispatch']);assert.equal(saved[0].request_journal.length,1);assert.equal(saved[0].request_journal[0].status,null);assert.equal(http.pending[0].options.headers['x-isp-trace'],saved[0].request_journal[0].id);assert.deepEqual(limits,[20000]);http.pending[0].respond();const response=await pending;assert.equal(response.status,200);assert.equal(saved.length,2);assert.equal(saved[1].request_journal[0].status,200);assert.equal(transport.active,0);
});
test('queued HTTP loses admission without any new dispatch persistence or intent after waiting',async()=>{
 const f=fixture(Date.now()),state=httpState(f),http=httpHarness(),saved=[],initial=assertActiveStagingAdmission(input(f)).snapshot;let admissions=0;
 const transport=new Transport(f.runtime,state,{admit:limit=>{admissions++;return assertActiveStagingAdmission(input(f,{now:Date.now(),minimumRemainingMs:limit,expectedSnapshot:initial}));},requestImpl:http.requestImpl,persistState:value=>saved.push(clone(value))});
 const first=transport.request('first','/member/dashboard'),second=transport.request('second','/library'),queued=transport.request('queued','/events');const queuedRefusal=assert.rejects(queued,/fresh_matching_watchdog_required/);assert.equal(http.pending.length,2);assert.equal(transport.waiters.length,1);assert.equal(saved.length,2);assert.equal(admissions,2);
 f.state.armed=false;http.pending[0].respond();await Promise.all([first,queuedRefusal]);assert.equal(admissions,3);assert.equal(http.pending.length,2);assert.equal(transport.calls,2);assert.equal(state.request_journal.length,2);assert.equal(transport.traces.length,2);assert.equal(transport.jars.has('queued'),false);assert.equal(saved.length,3);
 http.pending[1].respond();await second;assert.equal(saved.length,4);assert.equal(transport.active,0);assert.equal(transport.waiters.length,0);assert.equal(state.request_journal.some(row=>row.alias==='queued'),false);
});
test('failed durable HTTP intent prevents request bytes from being dispatched',async()=>{
 const f=fixture(Date.now()),state=httpState(f),http=httpHarness();let persists=0;
 const transport=new Transport(f.runtime,state,{admit:limit=>assertActiveStagingAdmission(input(f,{now:Date.now(),minimumRemainingMs:limit})),requestImpl:http.requestImpl,persistState:()=>{persists++;throw Error('synthetic intent capture unavailable');}});
 await assert.rejects(transport.request('member','/member/dashboard'),error=>/no request was dispatched/.test(error.message)&&!error.message.includes('synthetic intent capture unavailable'));assert.equal(persists,2);assert.equal(http.pending.length,0);assert.equal(http.events.length,0);assert.equal(transport.active,0);
});
