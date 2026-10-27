import test from 'node:test';
import assert from 'node:assert/strict';
import {C,SECRET_NAMES,canonical,hash,instant,validateCI,validateGrant,workerMetadata,applicationRequest,verifyWorker,selectOwnedApplication,verifyInactiveApplication,preparedRecord,oneShot,runtimeObjects,bootstrapFence,finishHandoffRecords,completeEnvelope,staleLockRecovery,activationAdmission,activationMetadata,admitProviderRequest,failureShutdown} from './lease2-provision-core.mjs';
const NOW=Date.parse('2026-10-27T04:00:00Z'),SOURCE='6'.repeat(40),BUNDLE='7'.repeat(64),NS='8'.repeat(32);
const NONCE='11111111-2222-4333-8444-555555555555',VER='22222222-3333-4444-8555-666666666666',DEP='33333333-4444-4555-8666-777777777777',APP='44444444-5555-4666-8777-888888888888';
const config={compatibility_date:'2026-10-26',vars:{ISP_CONTAINER_ENABLED:'false',APP_HOST:C.host,ISP_STAGING_START_AT:'',ISP_STAGING_EXPIRES_AT:'',ISP_DEMO_MODE:'false',ISP_ACCOUNT_EMAILS_ENABLED:'false',ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED:'false',DB_SSLMODE:'verify-full'}};
function fixtures(){
 const seed=Object.fromEntries(SECRET_NAMES.slice(0,5).map((k,i)=>[k,String(i+1).repeat(k==='SECRET_KEY_BASE'?128:64)]));
 const secrets={...seed,DATABASE_URL:'postgresql://synthetic:synthetic@ep-delicate-frost-a1o15wrb.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full',STORAGE_BUCKET:'isp-staging-private',AWS_REGION:'auto',AWS_ACCESS_KEY_ID:'syntheticA'.repeat(3),AWS_SECRET_ACCESS_KEY:'syntheticB'.repeat(5),STORAGE_ENDPOINT:'https://'+C.account+'.r2.cloudflarestorage.com',STORAGE_FORCE_PATH_STYLE:'true',MAIL_FROM:'staging@planterapp.co'};
 const metadata=workerMetadata(config,secrets,{source:SOURCE,nonce:NONCE,bundleHash:BUNDLE});
 const intent={nonce:NONCE,source:SOURCE,bundle_sha256:BUNDLE,baseline:{deployment:{id:C.oldDeployment},version:{id:C.oldVersion},namespace_ids:[C.oldNamespace],application_ids:[C.oldApp]}};
 const observed={deployment:{id:DEP,versions:[{version_id:VER,percentage:100}]},version:{id:VER,annotations:metadata.annotations,resources:{bindings:metadata.bindings.map(b=>b.type==='secret_text'?{name:b.name,type:b.type}:b.type==='durable_object_namespace'?{...b,namespace_id:NS}:b),script_runtime:{compatibility_date:config.compatibility_date,containers:metadata.containers}}},namespaces:[{id:NS,class:C.className,script:C.worker}],content:{entrypoint:'index.mjs',modules:[{name:'index.mjs',sha256:BUNDLE}]},ingress:{enabled:false,previews_enabled:false}};
 const app={id:APP,account_id:C.account,...applicationRequest(NS)};
 const worker=verifyWorker(observed,intent,config),prepared=preparedRecord({source:SOURCE,worker,app});
 const context={purpose:'inactive-provision',packageHash:'a'.repeat(64),helperHash:'b'.repeat(64),source:SOURCE,ciRun:123,now:NOW};
 const grant={version:1,owner_authorized:true,human_grant_reference:'Actual human approval reference',account:C.account,worker:C.worker,lease_id:C.lease,purpose:'inactive-provision',cumulative_test_ceiling_usd:5,image_digest:C.digest,config_sha256:C.configHash,package_sha256:context.packageHash,helper_sha256:context.helperHash,worker_source:SOURCE,ci_run_id:123,starts_at:'2026-10-27T03:59:00Z',expires_at:'2026-10-27T04:59:00Z',runtime_authorized:false,install_worker_bindings:true,credential_kind:'oauth'};
 return {seed,secrets,metadata,intent,observed,app,worker,prepared,context,grant};
}
test('Worker-first metadata enables the class without an app creation definition',()=>{
 const f=fixtures();assert.deepEqual(f.metadata.containers,[{class_name:C.className}]);assert.deepEqual(f.metadata.migrations,{old_tag:'rails-container-v1',new_tag:C.migration,steps:[{new_sqlite_classes:[C.className]}]});assert.equal(f.metadata.bindings.find(x=>x.name==='ISP_CONTAINER_ENABLED').text,'false');
 const a=applicationRequest(NS);assert.equal(a.instances,0);assert.equal(a.max_instances,1);assert.equal(a.scheduling_policy,'default');assert.equal(a.configuration.instance_type,'standard-2');
});
test('exact CI source, run and each required successful check are mandatory',()=>{
 const proof={run:{id:123,head_sha:SOURCE,repository:{full_name:C.repository},event:'push',head_branch:'production-readiness',path:'.github/workflows/rails-ci.yml',status:'completed',conclusion:'success'},check_runs:C.checks.map(name=>({name,head_sha:SOURCE,app:{slug:'github-actions'},details_url:'https://github.com/'+C.repository+'/actions/runs/123/job/1',status:'completed',conclusion:'success'})),bundle_sha256:BUNDLE,files:{}};
 assert.equal(validateCI(proof,SOURCE),123);
 for(const mutate of [p=>p.run.head_sha='f'.repeat(40),p=>p.check_runs.pop(),p=>p.check_runs[0].conclusion='failure',p=>p.check_runs[0].details_url='https://github.com/other/actions/runs/1/job/1']){const bad=structuredClone(proof);mutate(bad);assert.throws(()=>validateCI(bad,SOURCE));}
});
test('image-only, expired, altered-package and longer grants cannot provision',()=>{
 const {grant,context}=fixtures();assert.doesNotThrow(()=>validateGrant(grant,context));
 for(const change of [{purpose:'image-upload-only'},{runtime_authorized:true},{package_sha256:'f'.repeat(64)},{owner_authorized:false},{expires_at:'2026-10-27T05:00:01Z'},{credential_kind:'ambient'}])assert.throws(()=>validateGrant({...grant,...change},context));
 assert.throws(()=>validateGrant(grant,{...context,now:NOW+3600000}));assert.doesNotThrow(()=>validateGrant(grant,{...context,now:NOW+3600000,allowExpired:true}));
 assert.throws(()=>instant('2026-10-27T04:00:00.000Z'));
});
test('source annotation cannot replace verified serving module bytes',()=>{
 const f=fixtures();for(const mutate of [x=>x.content.modules[0].sha256='f'.repeat(64),x=>x.content.modules.push({name:'extra.mjs',sha256:BUNDLE}),x=>x.version.resources.script_runtime.containers=[],x=>x.version.resources.bindings.find(x=>x.name==='ISP_CONTAINER_ENABLED').text='true',x=>x.ingress.enabled=true]){const bad=structuredClone(f.observed);mutate(bad);assert.throws(()=>verifyWorker(bad,f.intent,config));}
});
test('a fresh namespace requires both baseline exclusion and unique version binding',()=>{
 const f=fixtures();assert.throws(()=>verifyWorker(f.observed,{...f.intent,baseline:{...f.intent.baseline,namespace_ids:[NS]}},config));
 const bad=structuredClone(f.observed);bad.namespaces.push({id:'9'.repeat(32),class:C.className,script:C.worker});assert.throws(()=>verifyWorker(bad,f.intent,config));
});
test('cleanup ownership refuses foreign account, name, namespace and prior app',()=>{
 const f=fixtures();assert.equal(selectOwnedApplication([f.app],NS).id,APP);
 for(const change of [{account_id:'foreign'},{name:'foreign'},{durable_objects:{namespace_id:C.oldNamespace}},{id:C.oldApp}])assert.throws(()=>selectOwnedApplication([{...f.app,...change}],NS));
 assert.throws(()=>selectOwnedApplication([f.app,{...f.app,id:NONCE}],NS));assert.equal(selectOwnedApplication([],NS),null);
});
test('zero requested instances never substitutes for the actual instance list',()=>{
 const f=fixtures();assert.doesNotThrow(()=>verifyInactiveApplication(f.app,[]));assert.throws(()=>verifyInactiveApplication(f.app,[{status:{state:'running'}}]));
 for(const change of [{instances:1},{max_instances:2},{scheduling_policy:'durable_object'},{configuration:{...f.app.configuration,image:'foreign'}}])assert.throws(()=>verifyInactiveApplication({...f.app,...change},[]));
});
test('durable intent failure prevents any provider mutation',async()=>{
 let writes=0,reads=0;await assert.rejects(oneShot({kind:'worker-put',intent:{},writeIntent:()=>{throw Error('disk unavailable');},writeOutcome:()=>{},mutate:()=>{writes++;},reconcile:()=>{reads++;}}));assert.equal(writes,0);assert.equal(reads,0);
});
test('lost POST response is observed but never replayed or silently advanced',async()=>{
 const records=new Map();let mutations=0,reads=0;const options={kind:'app-post',intent:{namespace_id:NS},writeIntent:(k,v)=>{assert.equal(records.has(k),false);records.set(k,v);},writeOutcome:(k,v)=>records.set(k+'-outcome',v),mutate:()=>{mutations++;throw Error('response lost after creating app');},reconcile:()=>{reads++;return {id:APP,namespace_id:NS};}};
 await assert.rejects(oneShot(options));assert.equal(records.get('app-post-outcome').observed.id,APP);assert.equal(records.get('app-post-outcome').uncertain,true);await assert.rejects(oneShot(options));assert.equal(mutations,1);assert.equal(reads,1);
});
test('successful transport plus missing readback remains uncertain',async()=>{
 let outcome;await assert.rejects(oneShot({kind:'worker-put',intent:{},writeIntent:()=>{},writeOutcome:(k,v)=>{outcome=v;},mutate:()=>{},reconcile:()=>{throw Error('readback unavailable');}}));assert.equal(outcome.request_returned_success,true);assert.equal(outcome.uncertain,true);
});
test('abort fence is terminal while cleanup itself remains allowed',()=>{
 assert.throws(()=>bootstrapFence({aborted:true}));assert.doesNotThrow(()=>bootstrapFence({aborted:true},{cleanup:true}));assert.throws(()=>bootstrapFence({handedOff:true},{cleanup:true}));assert.throws(()=>bootstrapFence({handedOff:true}));
});
test('partial handoff has no terminal fence until both exact output files exist',()=>{
 const intent={prepared_release_sha256:'a'.repeat(64),plan:{id:'plan'},runtime:{id:'runtime'}},files=new Map();let calls=0;
 const io={writeOrVerify:(name,value)=>{if(++calls===2)throw Error('simulated second-file failure');if(files.has(name))assert.equal(files.get(name),canonical(value));else files.set(name,canonical(value));}};
 assert.throws(()=>finishHandoffRecords(intent,io));assert.equal(files.has('watchdog-plan.json'),true);assert.equal(files.has('watchdog-handoff.json'),false);
 calls=100;finishHandoffRecords(intent,io);assert.equal(files.has('runtime.json'),true);assert.equal(files.has('watchdog-handoff.json'),true);
 files.set('watchdog-plan.json','tampered');assert.throws(()=>finishHandoffRecords(intent,io));
});
test('runtime writer preserves seed, binds sealed SHA and needs its own 55-minute grant',()=>{
 const f=fixtures(),preparedHash=hash(canonical(f.prepared)),grant={...f.grant,purpose:'runtime-window',runtime_authorized:true,prepared_release_sha256:preparedHash,runtime_start_at:'2026-10-27T04:00:00Z',runtime_expires_at:'2026-10-27T04:55:00Z',cleanup_reserve_minutes:10};
 const input={prepared:f.prepared,preparedHash,seed:f.seed,secrets:f.secrets,grant,packageHash:f.context.packageHash,helperHash:f.context.helperHash,ciRun:123,now:NOW},result=runtimeObjects(input);
 assert.equal(result.runtime.ISP_STAGING_KEY,f.seed.ISP_STAGING_KEY);assert.equal(result.runtime.PREPARED_RELEASE_SHA256,preparedHash);assert.equal(result.plan.namespace_id,NS);assert.equal(result.activation,false);
 for(const change of [{runtime_expires_at:'2026-10-27T04:55:01Z'},{prepared_release_sha256:'f'.repeat(64)},{runtime_start_at:'2026-10-27T04:00:00.000Z'}])assert.throws(()=>runtimeObjects({...input,grant:{...grant,...change}}));
 assert.throws(()=>runtimeObjects({...input,secrets:{...f.secrets,ISP_STAGING_KEY:'f'.repeat(64)}}));
});

test('all provider pagination forms fail before claiming a complete list',()=>{
 assert.deepEqual(completeEnvelope({success:true,result:[],result_info:{count:0,total_count:0,total_pages:1,page:1}}),[]);
 for(const extra of [{result_info:{cursor:'next'}},{result_info:{cursors:{after:'next'}}},{has_more:true},{result_info:{has_more:true}},{result_info:{total_count:1}},{result_info:{count:1}},{result_info:{total_pages:2}},{result_info:{page:2}},{next_page_token:'next'}])assert.throws(()=>completeEnvelope({success:true,result:[],...extra}));
});
test('stale lock recovery rejects live, unknown, reused and changed identities',()=>{
 const lock={pid:1234,nonce:NONCE,mode:'--provision',at:'2026-10-27T04:00:00.000Z'},input={lock,currentHash:'a'.repeat(64),expectedNonce:NONCE,expectedHash:'a'.repeat(64),pidState:'absent'};
 assert.match(staleLockRecovery(input),/lock-history/);
 for(const change of [{pidState:'live'},{pidState:'unknown'},{expectedNonce:VER},{expectedHash:'b'.repeat(64)},{lock:{...lock,pid:-1}}])assert.throws(()=>staleLockRecovery({...input,...change}));
});
test('handoff repair after the runtime file exists preserves the frozen expired window',()=>{
 const intent={prepared_release_sha256:'a'.repeat(64),plan:{expires_at:'2000-01-01T00:00:00Z'},runtime:{ISP_STAGING_EXPIRES_AT:'2000-01-01T00:00:00Z'}},files=new Map();let fail=true;
 const io={writeOrVerify:(name,value)=>{if(name==='watchdog-handoff.json'&&fail)throw Error('power loss before terminal marker');if(files.has(name))assert.equal(files.get(name),canonical(value));else files.set(name,canonical(value));}};
 assert.throws(()=>finishHandoffRecords(intent,io));assert.equal(files.size,2);fail=false;finishHandoffRecords(intent,io);assert.equal(files.size,3);assert.match(files.get('runtime.json'),/2000-01-01/);
});
test('activation metadata retains exact namespace and container attachment without migration replay',()=>{
 const f=fixtures(),runtime={...config.vars,ISP_CONTAINER_ENABLED:'true',ISP_STAGING_START_AT:'2026-10-27T04:00:00Z',ISP_STAGING_EXPIRES_AT:'2026-10-27T04:55:00Z'};
 const active=activationMetadata(f.metadata,f.prepared,runtime,VER);assert.equal(Object.hasOwn(active,'migrations'),false);assert.equal(active.bindings.find(x=>x.name==='RAILS_CONTAINER').namespace_id,NS);assert.deepEqual(active.containers,[{class_name:C.className}]);assert.equal(f.metadata.migrations.new_tag,C.migration);
});

test('activation requires exact completed handoff, matching live watchdog and early admission',()=>{
 const f=fixtures(),preparedHash=hash(canonical(f.prepared)),grant={...f.grant,purpose:'runtime-window',runtime_authorized:true,prepared_release_sha256:preparedHash,runtime_start_at:'2026-10-27T04:00:00Z',runtime_expires_at:'2026-10-27T04:55:00Z',cleanup_reserve_minutes:10};
 const outputs=runtimeObjects({prepared:f.prepared,preparedHash,seed:f.seed,secrets:f.secrets,grant,packageHash:f.context.packageHash,helperHash:f.context.helperHash,ciRun:123,now:NOW});
 const runtimeHash=hash(canonical(outputs.runtime)),planHash=hash(canonical(outputs.plan)),state={...outputs.plan,armed:true,pid:1234,updated_at:'2026-10-27T04:00:00Z',stop_at:'2026-10-27T04:50:00Z'};
 const input={prepared:f.prepared,preparedHash,runtime:outputs.runtime,plan:outputs.plan,state,handoff:{version:1,prepared_release_sha256:preparedHash,runtime_sha256:runtimeHash,watchdog_plan_sha256:planHash,bootstrap_cleanup_retired:true},runtimeHash,planHash,now:NOW,pidAlive:true};
 assert.doesNotThrow(()=>activationAdmission(input));
 for(const change of [{pidAlive:false},{handoff:null},{handoff:{...input.handoff,runtime_sha256:'f'.repeat(64)}},{state:{...state,armed:false}},{state:{...state,updated_at:'2026-10-27T03:59:00Z'}},{now:NOW+120001},{now:NOW+46*60000,early:false}])assert.throws(()=>activationAdmission({...input,...change}));
});

test('disk failure in the abort marker or receipt cannot prevent emergency shutdown',async()=>{
 let stops=0;const result=await failureShutdown({persistAbort:()=>{throw Error('disk full');},stop:()=>{stops++;return {container_application_absent:true,ingress_closed:true};},persistResult:()=>{throw Error('disk still full');}});
 assert.equal(stops,1);assert.equal(result.abort_persisted,false);assert.equal(result.shutdown_confirmed,true);
});
test('activation request exhaustion cannot spend the separate emergency budget',()=>{
 assert.throws(()=>admitProviderRequest({normal:120,emergency:0}));assert.deepEqual(admitProviderRequest({normal:120,emergency:0},{emergency:true}),{normal:120,emergency:1});assert.throws(()=>admitProviderRequest({normal:0,emergency:120},{emergency:true}));
});
test('all fractional grant/runtime timestamps are refused, including nonzero milliseconds',()=>{
 for(const value of ['2026-10-27T04:00:00.001Z','2026-10-27T04:00:00.100Z','2026-10-27T04:00:00.999Z'])assert.throws(()=>instant(value));
});
