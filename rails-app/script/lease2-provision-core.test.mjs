import test from 'node:test';
import assert from 'node:assert/strict';
import {ProviderRequestError} from './provider-request-outcome.mjs';
import {C,SECRET_NAMES,canonical,hash,instant,validateCI,validateGrant,workerMetadata,applicationRequest,verifyWorker,selectOwnedApplication,verifyInactiveApplication,preparedRecord,oneShot,runtimeObjects,bootstrapFence,finishHandoffRecords,completeEnvelope,staleLockRecovery,assertHistoricalControllerState,activationAdmission,assertActiveIngressReadback,activationMetadata,admitProviderRequest,failureShutdown} from './lease2-provision-core.mjs';
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

test('one-shot preserves HTTP mutation evidence separately from failed reconciliation and never retries',async()=>{
 const base={request_id:NONCE,method:'POST',endpoint:'/accounts/'+C.account+'/containers/applications',request_sha256:'a'.repeat(64),request_hash_scope:'wire-body',fetch_invoked:true,headers_received:true,http_status:403,stage:'http_error',body_state:'complete',parse_state:'json',provider_success:false,error_codes:[10000],ok:false};
 const read={...base,request_id:VER,method:'GET',endpoint:'/accounts/'+C.account+'/containers/applications/'+APP,http_status:500};
 let stored,calls=0;
 await assert.rejects(oneShot({kind:'app-post',intent:{},writeIntent:()=>{},writeOutcome:(_kind,value)=>{stored=value;},
  mutate:()=>{calls++;throw new ProviderRequestError({...base,headers:{Authorization:'never-copy-token'},message:'private-provider-message'});},
  reconcile:()=>{throw new ProviderRequestError(read);}}),error=>error.provider_outcome.http_status===403);
 assert.equal(calls,1);assert.equal(stored.uncertain,true);assert.equal(stored.request_returned_success,false);
 assert.equal(stored.request_outcome.http_status,403);assert.deepEqual(stored.request_outcome.error_codes,[10000]);
 assert.equal(stored.reconciliation_failed,true);assert.equal(stored.reconciliation_request_outcome.http_status,500);
 assert.equal(JSON.stringify(stored).includes('never-copy-token'),false);assert.equal(JSON.stringify(stored).includes('private-provider-message'),false);
});

test('successful provider response stays distinct from later local reconciliation rejection',async()=>{
 const outcome={request_id:NONCE,method:'POST',endpoint:'/accounts/'+C.account+'/containers/applications',request_sha256:'a'.repeat(64),request_hash_scope:'wire-body',fetch_invoked:true,headers_received:true,http_status:200,stage:'complete',body_state:'complete',parse_state:'json',provider_success:true,error_codes:[],ok:true};
 let stored;
 await assert.rejects(oneShot({kind:'app-post',intent:{},writeIntent:()=>{},writeOutcome:(_kind,value)=>{stored=value;},
  mutate:()=>({value:{id:APP},provider_outcome:outcome}),reconcile:()=>{throw Error('identity mismatch');}}));
 assert.equal(stored.request_returned_success,true);assert.equal(stored.request_outcome.http_status,200);assert.equal(stored.request_outcome.ok,true);
 assert.equal(stored.reconciliation_failed,true);assert.equal(stored.reconciliation_request_outcome,null);assert.equal(stored.uncertain,true);
});

test('emergency stop still runs while incomplete request evidence prevents a clean shutdown claim',async()=>{
 let stopped=0;
 const result=await failureShutdown({persistAbort:()=>{throw Error('disk full');},stop:()=>{stopped++;return {container_application_absent:true,ingress_closed:true,provider_evidence_complete:false};},persistResult:()=>{throw Error('disk full');}});
 assert.equal(stopped,1);assert.equal(result.result.container_application_absent,true);assert.equal(result.shutdown_confirmed,false);
});

test('diagnostic work preserves the complete reviewed default-policy zero-instance payload',()=>{
 assert.deepEqual(applicationRequest(NS),{name:C.worker,scheduling_policy:'default',configuration:{image:'registry.cloudflare.com/'+C.account+'/isp-member-rails@'+C.digest,instance_type:'standard-2'},instances:0,max_instances:1,durable_objects:{namespace_id:NS},observability:{logs:{enabled:false}}});
});

import fs from 'node:fs';
import {releaseProtocol} from './lease2-provision-core.mjs';
import {LEASE3_POLICY,buildLease3InactiveConfig} from './lease3-release-policy.mjs';
const third=releaseProtocol('rails-staging-3');
function fixture3(){
 const f=fixtures(),v2=JSON.parse(fs.readFileSync(new URL('../cloudflare/staging/wrangler.jsonc',import.meta.url),'utf8'));v2.$schema='D:/Projects/isp-member-rails/cloudflare/node_modules/wrangler/config-schema.json';v2.main='D:/Projects/isp-member-rails/cloudflare/staging/index.js';v2.containers[0].class_name='RailsStaging2';v2.containers[0].image=third.imageRef();v2.durable_objects.bindings[0].class_name='RailsStaging2';v2.migrations.push({tag:'rails-staging-v2',new_sqlite_classes:['RailsStaging2']});
 const cfg=buildLease3InactiveConfig(v2),metadata=third.workerMetadata(cfg,f.secrets,{source:SOURCE,nonce:NONCE,bundleHash:BUNDLE});
 const intent={...f.intent,baseline:{deployment:{id:LEASE3_POLICY.predecessor.deployment_id},version:{id:LEASE3_POLICY.predecessor.worker_version},namespace_ids:LEASE3_POLICY.retired.map(row=>row.namespace_id),application_ids:[]}};
 const observed={...f.observed,version:{...f.observed.version,annotations:metadata.annotations,resources:{bindings:metadata.bindings.map(b=>b.type==='secret_text'?{name:b.name,type:b.type}:b.type==='durable_object_namespace'?{...b,namespace_id:NS}:b),script_runtime:{compatibility_date:cfg.compatibility_date,containers:metadata.containers}}},namespaces:[...LEASE3_POLICY.retired.map(row=>({id:row.namespace_id,class:row.class_name,script:C.worker})),{id:NS,class:third.C.className,script:C.worker}]};
 const app={id:APP,account_id:C.account,...third.applicationRequest(NS)},worker=third.verifyWorker(observed,intent,cfg),prepared=third.preparedRecord({source:SOURCE,worker,app});return {...f,cfg,metadata,intent,observed,app,worker,prepared};
}
test('two fixed protocols preserve old constants and select exact actual v2 predecessor for lease3',()=>{
 assert.equal(C.oldNamespace,'a0e936fb9d634f59b1caaa1896b07a1f');assert.equal(C.oldVersion,'d6978392-76ac-4208-aaf9-e907be1939c0');assert.equal(releaseProtocol().C,C);assert.equal(third.C.oldNamespace,LEASE3_POLICY.predecessor.namespace_id);assert.equal(third.C.configHash,'dc4a3ff927acbf677a6cba86f77155396ccef02b9d36e8f2d8d79b303d901783');assert.throws(()=>releaseProtocol('legacy-1'));
 for(const old of LEASE3_POLICY.retired)assert.throws(()=>third.applicationRequest(old.namespace_id));
});
test('lease3 metadata/config use one new class migration, exact new config and unchanged image',()=>{
 const f=fixture3();assert.deepEqual(f.metadata.migrations,{old_tag:'rails-staging-v2',new_tag:'rails-staging-v3',steps:[{new_sqlite_classes:['RailsStaging3']}]});assert.equal(f.metadata.annotations['workers/tag'],'isp-v3-'+NONCE);assert.equal(third.imageRef(),imageRefForTest());assert.doesNotThrow(()=>third.validateConfig(f.cfg,canonical(f.cfg)));assert.throws(()=>third.validateConfig(f.cfg,canonical({...f.cfg,preview_urls:true})));assert.equal(f.prepared.lease_id,'rails-staging-3');assert.equal(f.prepared.class_name,'RailsStaging3');
});
function imageRefForTest(){return 'registry.cloudflare.com/'+C.account+'/isp-member-rails@'+C.digest;}
test('lease3 refuses both retired app namespaces during observation and cleanup selection',()=>{
 const f=fixture3();for(const old of LEASE3_POLICY.retired){const late={...f.app,id:NONCE,name:'renamed',durable_objects:{namespace_id:old.namespace_id}};assert.throws(()=>third.selectOwnedApplication([f.app,late],NS));const bad=structuredClone(f.observed);bad.version.resources.bindings.find(b=>b.name==='RAILS_CONTAINER').namespace_id=old.namespace_id;assert.throws(()=>third.verifyWorker(bad,f.intent,f.cfg));}const missing=structuredClone(f.observed);missing.namespaces.splice(0,1);assert.throws(()=>third.verifyWorker(missing,f.intent,f.cfg));
});
test('documented mixed export response supports same namespace/module identity and rejects conflict',()=>{
 const f=fixture3(),runtime=f.observed.version.resources.script_runtime;delete runtime.containers;runtime.exports={default:{type:'entrypoint'},RailsStaging3:{type:'durable-object',storage:'sqlite',container:'documented'}};assert.doesNotThrow(()=>third.verifyWorker(f.observed,f.intent,f.cfg));runtime.containers=[{class_name:'RailsStaging2'}];assert.throws(()=>third.verifyWorker(f.observed,f.intent,f.cfg));
});
test('lease3 sole runtime writer satisfies actual hosted-mode prerequisite and immutable grant handoff',()=>{
 const f=fixture3(),preparedHash=hash(canonical(f.prepared)),scope={owner_authorized:true,lease_id:'rails-staging-3',account:C.account,worker:C.worker};
 const authority={...scope,purpose:'credential-access',reference:'Synthetic separate access authority',credential_kind:'oauth',starts_at:'2026-10-27T03:59:00Z',expires_at:'2026-10-27T04:59:00Z'};
 const accessGrant={...scope,version:1,purpose:'credential-access',human_grant_reference:authority.reference,authority_sha256:hash(canonical(authority)),credential_kind:'oauth',starts_at:authority.starts_at,expires_at:authority.expires_at,runtime_authorized:false,cumulative_test_ceiling_usd:5};
 const runtimeAuthority={...scope,purpose:'runtime-window',reference:'Synthetic separate runtime authority',runtime_start_at:'2026-10-27T04:00:00Z',runtime_expires_at:'2026-10-27T04:55:00Z',prepared_release_sha256:preparedHash,reserved_test_usd:0.5,cumulative_test_ceiling_usd:5};
 const grant={...f.grant,...scope,purpose:'runtime-window',runtime_authorized:true,authority_sha256:hash(canonical(runtimeAuthority)),human_grant_reference:runtimeAuthority.reference,prepared_release_sha256:preparedHash,credential_access_sha256:hash(canonical(accessGrant)),runtime_start_at:runtimeAuthority.runtime_start_at,runtime_expires_at:runtimeAuthority.runtime_expires_at,cleanup_reserve_minutes:10,reserved_test_usd:0.5,cumulative_budget_ledger_sha256:'c'.repeat(64)};
 const input={prepared:f.prepared,preparedHash,seed:f.seed,secrets:f.secrets,grant,packageHash:f.context.packageHash,helperHash:f.context.helperHash,ciRun:123,now:NOW,grantOptions:{authority,accessGrant,runtimeAuthority,remainingTestUsd:1,budgetLedgerHash:'c'.repeat(64)}};const out=third.runtimeObjects(input);assert.equal(out.runtime.ISP_STAGING_LEASE,'rails-staging-3');assert.equal(out.runtime.RAILS_ENV,'production');assert.equal(assertHostedRuntimeMode(out.runtime),out.runtime);for(const value of [undefined,'development','test'])assert.throws(()=>assertHostedRuntimeMode({...out.runtime,RAILS_ENV:value}));assert.equal(out.plan.class_name,'RailsStaging3');assert.equal(out.activation,false);assert.throws(()=>third.runtimeObjects({...input,grantOptions:{...input.grantOptions,remainingTestUsd:0}}));assert.throws(()=>third.runtimeObjects({...input,grant:{...grant,purpose:'inactive-provision',runtime_authorized:false,config_sha256:third.C.configHash},grantOptions:{...input.grantOptions,purpose:'inactive-provision'}}));assert.ok(Object.isFrozen(third.C.retiredNamespaces));
 const active=third.activationMetadata(f.metadata,f.prepared,out.runtime,VER);assert.equal(Object.hasOwn(active,'migrations'),false);assert.equal(active.annotations['workers/tag'],'isp-v3-'+VER);
});

test('late retired application blocks progress while exact own pre-seal emergency deletion remains selectable',()=>{
 const f=fixture3(),late={...f.app,id:NONCE,durable_objects:{namespace_id:LEASE3_POLICY.predecessor.namespace_id}};assert.throws(()=>third.selectOwnedApplication([late,f.app],NS));assert.equal(third.selectOwnedApplication([late,f.app],NS,[],{cleanup:true}).id,APP);assert.equal(third.selectOwnedApplication([late],NS,[],{cleanup:true}),null);assert.throws(()=>third.selectOwnedApplication([late],LEASE3_POLICY.predecessor.namespace_id,[],{cleanup:true}));assert.throws(()=>third.selectOwnedApplication([{...f.app,account_id:'foreign'}],NS,[],{cleanup:true}));
});

import {assertHostedRuntimeMode} from './active-staging-admission.mjs';

test('active ingress readback stays bound to reconciled PUT version, deployment, namespace and module',()=>{
 const f=fixture3(),runtime={...f.cfg.vars,ISP_CONTAINER_ENABLED:'true',ISP_STAGING_START_AT:'2026-10-27T04:00:00Z',ISP_STAGING_EXPIRES_AT:'2026-10-27T04:55:00Z'},metadata=third.activationMetadata(f.metadata,f.prepared,runtime,NONCE),activeConfig={...f.cfg,vars:runtime};
 const intent={nonce:NONCE,source:SOURCE,bundle_sha256:BUNDLE,baseline:{deployment:{id:f.prepared.rollback_deployment_id},version:{id:f.prepared.rollback_worker_version},namespace_ids:[]}};
 const observed=structuredClone(f.observed);observed.deployment={id:APP,versions:[{version_id:NONCE,percentage:100}]};observed.version.id=NONCE;observed.version.annotations=metadata.annotations;observed.version.resources.bindings=metadata.bindings.map(b=>b.type==='secret_text'?{name:b.name,type:b.type}:b.type==='durable_object_namespace'?{...b,namespace_id:NS}:b);
 const initial={...third.verifyWorker(observed,intent,activeConfig,false),module_sha256:observed.content.modules[0].sha256};assert.equal(third.assertActiveIngressReadback(initial,{...initial}).worker_version,NONCE);
 for(const change of [{worker_version:VER},{deployment_id:DEP},{namespace_id:'9'.repeat(32)},{module_sha256:'f'.repeat(64)},{module_sha256:undefined}])assert.throws(()=>third.assertActiveIngressReadback(initial,{...initial,...change}));
 const foreign=structuredClone(observed);foreign.deployment.id='55555555-6666-4777-8888-999999999999';const separatelyVerified={...third.verifyWorker(foreign,intent,activeConfig,false),module_sha256:BUNDLE};assert.throws(()=>third.assertActiveIngressReadback(initial,separatelyVerified));
 for(const change of [x=>x.content.modules[0].sha256='f'.repeat(64),x=>x.ingress.enabled=true,x=>x.ingress.previews_enabled=true]){const bad=structuredClone(observed);change(bad);assert.throws(()=>third.verifyWorker(bad,intent,activeConfig,false));}
 assert.throws(()=>assertActiveIngressReadback({...initial,module_sha256:undefined},initial));
});

import {preparedTuple} from './staging-lease-context.mjs';

const LEGACY_TERMINAL_SHA='13c2a72dee8b05dfb5645bedd7087ba77cc321e5accfc91aaab8cf483691f55c';
const legacyTerminal=()=>({armed:false,container_application_absent:true,ingress_closed:true,verified_at:'2026-10-26T09:55:57.343Z',application_id:C.oldApp,stop_at:'2026-10-26T09:54:50.000Z',updated_at:'2026-10-26T09:55:57.344Z'});
const retirementProof=()=>({retiredApplication:{application_id:C.oldApp,http_status:404,ok:true,absent:true},ingress:{enabled:false,previews_enabled:false},observedAt:new Date(NOW-1000).toISOString(),now:NOW});
function censusFixture(){
 const currentLock={pid:123,nonce:NONCE,mode:'--preflight',at:new Date(NOW-500).toISOString()};
 const own={pid:123,kind:'provision',fixed_identity:true,mode:'--preflight',created_at:new Date(NOW-1000).toISOString()};
 return {census:{version:1,complete:true,method:'Win32_Process',observed_at:new Date(NOW-1000).toISOString(),process_count:563,observer_pid:124,parent_pid:123,controllers:[own]},options:{currentPid:123,currentLock,currentNonce:NONCE,mode:'--preflight',now:NOW}};
}
test('only the exact retained legacy terminal raw record plus actual current404 and closed ingress can retire missing PID',()=>{
 assert.equal(third.assertHistoricalControllerState(legacyTerminal(),LEGACY_TERMINAL_SHA,retirementProof()),true);
 for(const value of [null,undefined,[],{},false,{...legacyTerminal(),pid:null},{...legacyTerminal(),pid:77},{...legacyTerminal(),status:'PASS'},{...legacyTerminal(),armed:true},{...legacyTerminal(),container_application_absent:false},{...legacyTerminal(),ingress_closed:false},{...legacyTerminal(),application_id:APP},{...legacyTerminal(),stop_at:'2026-10-26T09:54:51.000Z'},{...legacyTerminal(),verified_at:'2026-10-26T09:55:58.343Z'},{...legacyTerminal(),updated_at:'2026-10-26T09:55:58.344Z'}])assert.throws(()=>third.assertHistoricalControllerState(value,LEGACY_TERMINAL_SHA,retirementProof()));
 assert.throws(()=>third.assertHistoricalControllerState(legacyTerminal(),'f'.repeat(64),retirementProof()));
 for(const change of [{http_status:200},{http_status:403},{http_status:null},{ok:false},{absent:false},{application_id:APP}]){const proof=retirementProof();Object.assign(proof.retiredApplication,change);assert.throws(()=>third.assertHistoricalControllerState(legacyTerminal(),LEGACY_TERMINAL_SHA,proof));}
 for(const ingress of [{enabled:true,previews_enabled:false},{enabled:false,previews_enabled:true},{enabled:false},null])assert.throws(()=>third.assertHistoricalControllerState(legacyTerminal(),LEGACY_TERMINAL_SHA,{...retirementProof(),ingress}));
 for(const observedAt of [new Date(NOW-60001).toISOString(),new Date(NOW+5001).toISOString(),'invalid'])assert.throws(()=>third.assertHistoricalControllerState(legacyTerminal(),LEGACY_TERMINAL_SHA,{...retirementProof(),observedAt}));
 assert.throws(()=>assertHistoricalControllerState(legacyTerminal(),LEGACY_TERMINAL_SHA,retirementProof()));
});
test('complete current Windows census requires the exact own operator and fresh exclusive nonce',()=>{
 const f=censusFixture();assert.equal(third.assertControllerCensus(f.census,f.options),true);
 for(const change of [{complete:false},{version:2},{method:'snapshot'},{process_count:0},{process_count:8193},{observer_pid:123},{parent_pid:99},{controllers:[]},{controllers:null},{observed_at:new Date(NOW-60001).toISOString()},{observed_at:new Date(NOW+5001).toISOString()}])assert.throws(()=>third.assertControllerCensus({...f.census,...change},f.options));
 for(const patch of [{currentPid:99},{currentNonce:VER},{currentNonce:undefined},{mode:'--provision'},{currentLock:{...f.options.currentLock,nonce:VER}},{currentLock:{...f.options.currentLock,at:'invalid'}}])assert.throws(()=>third.assertControllerCensus(f.census,{...f.options,...patch}));
 for(const change of [{pid:0},{pid:'123'},{kind:'watchdog'},{fixed_identity:false},{mode:'--provision'},{created_at:'invalid'},{created_at:new Date(NOW+5001).toISOString()}])assert.throws(()=>third.assertControllerCensus({...f.census,controllers:[{...f.census.controllers[0],...change}]},f.options));
});
test('live old, foreign, duplicate or unclassified controllers never inherit an allowed PID exception',()=>{
 const f=censusFixture();
 for(const row of [{pid:125,kind:'watchdog',fixed_identity:true,mode:'--arm'},{pid:125,kind:'provision',fixed_identity:true,mode:'--provision'},{pid:125,kind:'other',fixed_identity:false,mode:'unknown'},{pid:123,kind:'provision',fixed_identity:true,mode:'--preflight'}])assert.throws(()=>third.assertControllerCensus({...f.census,controllers:[...f.census.controllers,{...row,created_at:new Date(NOW-2000).toISOString()}]},f.options));
 for(const allowedWatchdogPid of [0,-1,'125',123,125])assert.throws(()=>third.assertControllerCensus(f.census,{...f.options,allowedWatchdogPid}));
});
test('only exact current sealed armed watchdog with fixed --arm command may coexist with activation',()=>{
 const f=censusFixture(),prepared=fixture3().prepared,preparedHash='d'.repeat(64),tuple=preparedTuple({...prepared,prepared_release_sha256:preparedHash});
 const state={...tuple,pid:125,armed:true,updated_at:new Date(NOW-1000).toISOString(),stop_at:new Date(NOW+50*60000).toISOString()},watchdog={pid:125,kind:'watchdog',fixed_identity:true,mode:'--arm',created_at:new Date(NOW-2000).toISOString()};
 const census={...f.census,controllers:[...f.census.controllers,watchdog]},options={...f.options,allowedWatchdogPid:125,watchdogState:state,prepared,preparedHash};
 assert.equal(third.assertControllerCensus(census,options),true);
 for(const patch of [{armed:false},{pid:126},{namespace_id:'f'.repeat(32)},{lease_id:'rails-staging-2'},{updated_at:new Date(NOW-45001).toISOString()},{updated_at:new Date(NOW+5001).toISOString()},{stop_at:new Date(NOW).toISOString()}])assert.throws(()=>third.assertControllerCensus(census,{...options,watchdogState:{...state,...patch}}));
 for(const change of [{kind:'provision'},{fixed_identity:false},{mode:'--stop-now'},{mode:'--arm --extra'},{created_at:new Date(NOW+5000).toISOString()}])assert.throws(()=>third.assertControllerCensus({...census,controllers:[f.census.controllers[0],{...watchdog,...change}]},options));
 assert.throws(()=>third.assertControllerCensus(f.census,options));assert.throws(()=>third.assertControllerCensus(census,{...options,preparedHash:'f'.repeat(64)}));
});
test('each provider mutation boundary refuses a live competing controller before dispatch',async()=>{
 for(const boundary of ['worker-put','app-post','seal','active-worker-put','active-ingress-post']){
  const f=censusFixture();f.census.controllers.push({pid:125,kind:'watchdog',fixed_identity:true,mode:'--arm',created_at:new Date(NOW-2000).toISOString()});let dispatched=0,outcome;
  await assert.rejects(()=>third.oneShot({kind:boundary,intent:{boundary},writeIntent:()=>{},writeOutcome:(_kind,value)=>{outcome=value;},mutate:()=>{third.assertHistoricalControllerState(legacyTerminal(),LEGACY_TERMINAL_SHA,retirementProof());third.assertControllerCensus(f.census,f.options);dispatched++;},reconcile:()=>null}));
  assert.equal(dispatched,0);assert.equal(outcome.uncertain,true);
 }
});
