import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {LEASE3_POLICY as P,lease3Context,lease3Migration,lease3ImageRef,buildLease3InactiveConfig,validateLease3InactiveConfig,validateLease3PreparedRelease,assertLease3Namespace,assertLease3ApplicationRows,assertLease3CleanupIdentity,assertLease3Preflight,assertLease3SafetyBoundary,validateLease3AccessGrant,validateLease3RuntimeGrant,assertLease3RuntimeGrantAdmission,assertObservedContainer} from './lease3-release-policy.mjs';
const NOW=Date.parse('2026-10-27T04:00:00Z'),AT='2026-10-27T04:00:00Z',NS='3'.repeat(32),SOURCE='6'.repeat(40);
const APP='44444444-5555-4666-8777-888888888888',VER='22222222-3333-4444-8555-666666666666',DEP='33333333-4444-4555-8666-777777777777';
const hash=value=>createHash('sha256').update(JSON.stringify(value,null,2)+'\n').digest('hex');
const copy=structuredClone;
const secretNames=['SECRET_KEY_BASE','ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY','ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY','ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT','ISP_STAGING_KEY','DATABASE_URL','STORAGE_BUCKET','AWS_REGION','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','STORAGE_ENDPOINT','STORAGE_FORCE_PATH_STYLE','MAIL_FROM'];
const vars=()=>({ISP_CONTAINER_ENABLED:'false',APP_HOST:P.app_host,ISP_STAGING_START_AT:'',ISP_STAGING_EXPIRES_AT:'',ISP_DEMO_MODE:'false',ISP_ACCOUNT_EMAILS_ENABLED:'false',ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED:'false',DB_SSLMODE:'verify-full'});
function config(){return {name:P.worker,account_id:P.account,compatibility_date:P.compatibility_date,workers_dev:false,preview_urls:false,routes:[],observability:{enabled:false},vars:vars(),containers:[{name:P.worker,class_name:P.predecessor.class_name,scheduling_policy:'default',image:lease3ImageRef(),instance_type:'standard-2',max_instances:1,observability:{enabled:false}}],durable_objects:{bindings:[{name:'RAILS_CONTAINER',class_name:P.predecessor.class_name}]},migrations:[{tag:'rails-container-v1',new_sqlite_classes:['RailsContainer']},{tag:'rails-staging-v2',new_sqlite_classes:['RailsStaging2']}]};}
function observation(){
 const version={id:P.predecessor.worker_version,annotations:{'workers/message':P.predecessor.worker_source+' bundle:'+P.predecessor.module_sha256},resources:{bindings:[...Object.entries(vars()).map(([name,text])=>({name,text,type:'plain_text'})),...secretNames.map(name=>({name,type:'secret_text'})),{name:'RAILS_CONTAINER',type:'durable_object_namespace',class_name:P.predecessor.class_name,namespace_id:P.predecessor.namespace_id}],script_runtime:{compatibility_date:P.compatibility_date,migration_tag:P.predecessor.migration_tag,containers:[{class_name:P.predecessor.class_name}]}}};
 const first={deployment:{id:P.predecessor.deployment_id,versions:[{version_id:version.id,percentage:100}]},version};
 return {observed_at:AT,account:{id:P.account},completeness:{applications:true,namespaces:true,instances:true},first,last:copy(first),content:{entrypoint:'index.mjs',modules:[{name:'index.mjs',sha256:P.predecessor.module_sha256}]},migration_tag:P.predecessor.migration_tag,ingress:{enabled:false,previews_enabled:false},trigger:{script_id:P.trigger.script_id,trigger_uuid:P.trigger.trigger_uuid,build_command:P.trigger.command,deploy_command:P.trigger.command},controller:{state:'absent',observed_at:AT},namespaces:P.retired.map(row=>({id:row.namespace_id,class:row.class_name,script:P.worker})),applications:[],dependencies:{database:{...P.database,status:'PASS',read_only:true,ssl_verified:true,evidence_sha256:'a'.repeat(64),observed_at:AT},storage:{...P.storage,status:'PASS',read_only:true,private:true,access_verified:true,evidence_sha256:'b'.repeat(64),observed_at:AT}}};
}
const app=()=>({id:APP,account_id:P.account,name:P.worker,durable_objects:{namespace_id:NS},scheduling_policy:'default',configuration:{image:lease3ImageRef(),instance_type:'standard-2'},instances:0,max_instances:1,observability:{logs:{enabled:false}}});
const prepared=()=>({version:1,lease_id:P.lease_id,account:P.account,worker:P.worker,application_name:P.worker,application_id:APP,namespace_id:NS,class_name:P.class_name,worker_source:SOURCE,rails_source:P.rails_source,image_digest:P.image_digest,rollback_worker_version:VER,rollback_deployment_id:DEP,activation:false});
function boundary(phase){const value=observation();value.namespaces.push({id:NS,class:P.class_name,script:P.worker});if(phase!=='create'){value.applications=[app()];value.application=app();value.instances=[];}return value;}
const boundaryOptions=phase=>({phase,namespaceId:NS,applicationId:APP,baselineNamespaceIds:P.retired.map(row=>row.namespace_id),now:NOW});
function grants(){
 const authority={purpose:'credential-access',owner_authorized:true,lease_id:P.lease_id,account:P.account,worker:P.worker,reference:'Synthetic owner access reference',credential_kind:'api-token',token_id:'1'.repeat(32),starts_at:'2026-10-27T03:59:00Z',expires_at:'2026-10-27T04:59:00Z'};
 const accessGrant={version:1,purpose:'credential-access',owner_authorized:true,lease_id:P.lease_id,account:P.account,worker:P.worker,human_grant_reference:authority.reference,authority_sha256:hash(authority),runtime_authorized:false,cumulative_test_ceiling_usd:5,credential_kind:authority.credential_kind,token_id:authority.token_id,starts_at:authority.starts_at,expires_at:authority.expires_at};
 const sealed=prepared(),preparedHash=hash(sealed),runtimeAuthority={purpose:'runtime-window',owner_authorized:true,lease_id:P.lease_id,account:P.account,worker:P.worker,reference:'Synthetic owner runtime reference',runtime_start_at:AT,runtime_expires_at:'2026-10-27T04:55:00Z',prepared_release_sha256:preparedHash,reserved_test_usd:0.5,cumulative_test_ceiling_usd:5};
 const grant={version:1,purpose:'runtime-window',owner_authorized:true,lease_id:P.lease_id,account:P.account,worker:P.worker,human_grant_reference:runtimeAuthority.reference,authority_sha256:hash(runtimeAuthority),runtime_authorized:true,package_sha256:'a'.repeat(64),helper_sha256:'b'.repeat(64),worker_source:SOURCE,ci_run_id:123,prepared_release_sha256:preparedHash,credential_access_sha256:hash(accessGrant),credential_kind:authority.credential_kind,token_id:authority.token_id,image_digest:P.image_digest,cumulative_test_ceiling_usd:5,cleanup_reserve_minutes:10,runtime_start_at:AT,runtime_expires_at:runtimeAuthority.runtime_expires_at,reserved_test_usd:0.5,cumulative_budget_ledger_sha256:'c'.repeat(64)};
 return {authority,accessGrant,runtimeAuthority,grant,options:{authority,accessGrant,runtimeAuthority,prepared:sealed,preparedHash,packageHash:grant.package_sha256,helperHash:grant.helper_sha256,source:SOURCE,ciRun:123,remainingTestUsd:1,budgetLedgerHash:'c'.repeat(64),now:NOW}};
}

test('lease3 is explicit, immutable and isolated from both historical leaves',()=>{
 const c=lease3Context(P.lease_id);assert.equal(c.privateRoot,P.private_root);assert.equal(c.credentialSelector,P.credential_selector);assert.ok(Object.isFrozen(P.predecessor));
 for(const id of [undefined,'legacy-1','rails-staging-2','rails-staging-3/../rails-staging-2'])assert.throws(()=>lease3Context(id));
 assert.deepEqual(lease3Migration(),{old_tag:'rails-staging-v2',new_tag:'rails-staging-v3',steps:[{new_sqlite_classes:['RailsStaging3']}]});
});
test('config migration preserves both old classes, image and blank inactive flags',()=>{
 const old=config(),before=copy(old),next=buildLease3InactiveConfig(old);assert.deepEqual(old,before);assert.equal(next.containers[0].image,old.containers[0].image);assert.equal(next.containers[0].class_name,'RailsStaging3');assert.deepEqual(next.migrations,[...old.migrations,{tag:'rails-staging-v3',new_sqlite_classes:['RailsStaging3']}]);assert.equal(next.vars.ISP_STAGING_START_AT,'');assert.equal(next.vars.ISP_STAGING_EXPIRES_AT,'');assert.ok(Object.isFrozen(next.vars));assert.doesNotThrow(()=>validateLease3InactiveConfig(next));
});
test('config refuses enabled routes, changed image, extra bindings and migration deletion',()=>{
 for(const mutate of [x=>x.workers_dev=true,x=>x.preview_urls=true,x=>x.routes.push('example.invalid/*'),x=>x.vars.ISP_CONTAINER_ENABLED='true',x=>x.vars.ISP_STAGING_START_AT=AT,x=>x.vars.DATABASE_URL='synthetic',x=>x.containers[0].image='foreign',x=>x.containers[0].max_instances=2,x=>x.durable_objects.bindings[0].script_name='foreign',x=>x.migrations.pop(),x=>x.migrations.push({tag:'bad',deleted_classes:['RailsContainer']})]){const bad=config();mutate(bad);assert.throws(()=>buildLease3InactiveConfig(bad));}
});
test('preflight proves exact actual inactive v2 source, module and 100-percent deployment',()=>{
 const value=assertLease3Preflight(observation(),{now:NOW});assert.equal(value.predecessor.worker_version,'0a619974-23df-4ae3-9870-9e6e12fcc943');assert.equal(value.predecessor.deployment_id,'82e1b292-6886-4526-8941-a3854cfe18c2');assert.deepEqual(value.baseline_namespace_ids,P.retired.map(row=>row.namespace_id).sort());assert.equal(value.activation,false);
});
test('preflight rejects stale, partial, foreign-account, parallel and active observations',()=>{
 for(const mutate of [x=>x.observed_at='2026-10-27T03:58:59Z',x=>x.observed_at='2026-10-27T04:00:06Z',x=>x.account.id='foreign',x=>x.completeness.applications=false,x=>x.completeness.namespaces=false,x=>x.controller.state='unknown',x=>x.controller.observed_at='2026-10-27T03:58:59Z',x=>x.ingress.enabled=true,x=>x.ingress.previews_enabled=true,x=>x.trigger.deploy_command='deploy',x=>x.content.modules[0].sha256='f'.repeat(64),x=>x.last.version.id=VER,x=>x.first.deployment.versions[0].percentage=99,x=>x.first.version.resources.bindings[0].text='true']){const bad=observation();mutate(bad);assert.throws(()=>assertLease3Preflight(bad,{now:NOW}));}
 assert.throws(()=>assertLease3Preflight(observation(),{now:NaN}));
});
test('preflight requires exact unique bindings and actual v2 migration/runtime metadata',()=>{
 for(const mutate of [x=>x.migration_tag='rails-container-v1',x=>x.first.version.resources.script_runtime.compatibility_date='2026-10-25',x=>x.first.version.resources.bindings.pop(),x=>x.first.version.resources.bindings.push(copy(x.first.version.resources.bindings[0])),x=>x.first.version.annotations['workers/message']='annotation-only']){const bad=observation();mutate(bad);bad.last=copy(bad.first);assert.throws(()=>assertLease3Preflight(bad,{now:NOW}));}
});
test('both retired namespaces must remain intact and v3 must be absent before upload',()=>{
 for(const index of [0,1])for(const mutate of [x=>x.namespaces.splice(index,1),x=>x.namespaces[index].class='Other',x=>x.namespaces[index].preview=true,x=>x.namespaces[index].script='foreign']){const bad=observation();mutate(bad);assert.throws(()=>assertLease3Preflight(bad,{now:NOW}));}
 const bad=observation();bad.namespaces.push({id:NS,class:P.class_name,script:P.worker});assert.throws(()=>assertLease3Preflight(bad,{now:NOW}));
});
test('database and storage must each have fresh exact read-only access evidence',()=>{
 for(const mutate of [x=>x.dependencies.database.ssl_verified=false,x=>x.dependencies.database.pg_major=17,x=>x.dependencies.database.project='foreign',x=>x.dependencies.database.read_only=false,x=>x.dependencies.storage.private=false,x=>x.dependencies.storage.access_verified=false,x=>x.dependencies.storage.observed_at='2026-10-27T03:58:59Z']){const bad=observation();mutate(bad);assert.throws(()=>assertLease3Preflight(bad,{now:NOW}));}
});
test('late v1/v2 applications block every create, seal and activation boundary',()=>{
 for(const phase of ['create','seal','activate']){assert.doesNotThrow(()=>assertLease3SafetyBoundary(boundary(phase),boundaryOptions(phase)));for(const retired of P.retired){const bad=boundary(phase);bad.applications.push({...app(),id:VER,name:'renamed',durable_objects:{namespace_id:retired.namespace_id}});assert.throws(()=>assertLease3SafetyBoundary(bad,boundaryOptions(phase)));}}
});
test('sealing and activation require independent exact zero-instance application detail',()=>{
 for(const phase of ['seal','activate'])for(const mutate of [x=>x.application.account_id='foreign',x=>x.application.name='foreign',x=>x.application.configuration.image='foreign',x=>x.application.instances=1,x=>x.instances=[{status:{state:'running'}}],x=>x.completeness.instances=false,x=>x.namespaces.push({id:'4'.repeat(32),class:P.class_name,script:P.worker}),x=>x.namespaces.splice(0,1),x=>x.ingress.enabled=true]){const bad=boundary(phase);mutate(bad);assert.throws(()=>assertLease3SafetyBoundary(bad,boundaryOptions(phase)));}
});
test('namespace and application ownership refuse both retired roots and baseline adoption',()=>{
 for(const retired of P.retired)assert.throws(()=>assertLease3Namespace(retired.namespace_id));assert.throws(()=>assertLease3Namespace(NS,[NS]));assert.throws(()=>assertLease3Namespace(NS,['bad']));
 assert.equal(assertLease3ApplicationRows([app()],{phase:'seal',namespaceId:NS,applicationId:APP}).id,APP);
 for(const change of [{account_id:'foreign'},{name:'foreign'},{id:P.retired[0].application_id},{durable_objects:{namespace_id:P.predecessor.namespace_id}}])assert.throws(()=>assertLease3ApplicationRows([{...app(),...change}],{phase:'seal',namespaceId:NS,applicationId:APP}));
 assert.throws(()=>assertLease3ApplicationRows([app()],{phase:'seal',namespaceId:NS,applicationId:APP,baselineApplicationIds:[APP]}));
});
test('exact cleanup ownership works without runtime or live grant and never adopts v2',()=>{
 const owned=prepared();assert.equal(assertLease3CleanupIdentity(app(),owned),true);assert.equal(assertLease3CleanupIdentity(null,owned),true);
 for(const change of [{lease_id:'rails-staging-2'},{namespace_id:P.predecessor.namespace_id},{application_id:P.retired[0].application_id}])assert.throws(()=>assertLease3CleanupIdentity(app(),{...owned,...change}));assert.throws(()=>assertLease3CleanupIdentity({...app(),account_id:'foreign'},owned));assert.throws(()=>assertLease3CleanupIdentity(app(),owned,{baselineApplicationIds:[APP]}));
});
test('prepared release has exactly fourteen fields and a new same-class inactive rollback',()=>{
 assert.equal(Object.keys(validateLease3PreparedRelease(prepared())).length,14);
 for(const change of [{lease_id:'rails-staging-2'},{class_name:'RailsStaging2'},{namespace_id:P.predecessor.namespace_id},{rollback_worker_version:P.predecessor.worker_version},{rollback_deployment_id:P.predecessor.deployment_id},{rails_source:'f'.repeat(40)},{image_digest:'sha256:'+'f'.repeat(64)},{activation:true},{extra:true}])assert.throws(()=>validateLease3PreparedRelease({...prepared(),...change}));
});
test('credential access has exact separate human authority and never authorizes runtime',()=>{
 const f=grants();assert.equal(validateLease3AccessGrant(f.accessGrant,{authority:f.authority,now:NOW}).runtime_authorized,false);
 for(const change of [{purpose:'runtime-window'},{runtime_authorized:true},{token_id:'2'.repeat(32)},{authority_sha256:'f'.repeat(64)},{expires_at:'2026-10-27T05:00:00Z'}])assert.throws(()=>validateLease3AccessGrant({...f.accessGrant,...change},{authority:f.authority,now:NOW}));assert.throws(()=>validateLease3AccessGrant(f.accessGrant,{authority:f.authority,now:NOW+3600000}));
});
test('access longer than one hour needs explicit owner approval of the same exact duration',()=>{
 const f=grants();f.authority.expires_at='2026-10-27T06:59:00Z';f.accessGrant.expires_at=f.authority.expires_at;f.accessGrant.authority_sha256=hash(f.authority);assert.throws(()=>validateLease3AccessGrant(f.accessGrant,{authority:f.authority,now:NOW}));f.authority.longer_access_approved=true;f.accessGrant.authority_sha256=hash(f.authority);assert.doesNotThrow(()=>validateLease3AccessGrant(f.accessGrant,{authority:f.authority,now:NOW}));
});
test('runtime is separately approved, sealed and bound to source, package and cumulative ledger',()=>{
 const f=grants(),value=validateLease3RuntimeGrant(f.grant,f.options);assert.equal(value.end-value.start,55*60000);assert.equal(value.activation,false);
 for(const change of [{runtime_authorized:false},{package_sha256:'f'.repeat(64)},{prepared_release_sha256:'f'.repeat(64)},{credential_access_sha256:'f'.repeat(64)},{cumulative_budget_ledger_sha256:'f'.repeat(64)},{reserved_test_usd:1.01},{cleanup_reserve_minutes:0},{runtime_expires_at:'2026-10-27T04:55:01Z'},{runtime_start_at:'2026-10-27T04:00:00.001Z'}])assert.throws(()=>validateLease3RuntimeGrant({...f.grant,...change},f.options));
 assert.throws(()=>validateLease3RuntimeGrant(f.grant,{...f.options,runtimeAuthority:f.authority}));assert.throws(()=>validateLease3RuntimeGrant(f.grant,{...f.options,remainingTestUsd:0}));
});
test('existing runtime can only reuse its original unchanged grant and full sealed tuple',()=>{
 const f=grants(),p=f.options.prepared,runtime={ISP_STAGING_LEASE:P.lease_id,APPLICATION_ID:APP,NAMESPACE_ID:NS,CANDIDATE_COMMIT:SOURCE,RAILS_SOURCE:P.rails_source,IMAGE_DIGEST:P.image_digest,ROLLBACK_WORKER_VERSION:p.rollback_worker_version,PREPARED_RELEASE_SHA256:f.options.preparedHash,ISP_STAGING_START_AT:AT,ISP_STAGING_EXPIRES_AT:f.grant.runtime_expires_at};
 const options={...f.options,existingRuntime:runtime,existingRuntimeGrant:copy(f.grant)};assert.doesNotThrow(()=>validateLease3RuntimeGrant(f.grant,options));assert.throws(()=>validateLease3RuntimeGrant(f.grant,{...options,existingRuntimeGrant:null}));assert.throws(()=>validateLease3RuntimeGrant(f.grant,{...options,existingRuntimeGrant:{...f.grant,reserved_test_usd:0.4}}));assert.throws(()=>validateLease3RuntimeGrant(f.grant,{...options,existingRuntime:{...runtime,NAMESPACE_ID:P.predecessor.namespace_id}}));
});
test('runtime grant admission is process-local, tuple-bound and expires before cleanup reserve',()=>{
 const f=grants(),admission=validateLease3RuntimeGrant(f.grant,f.options),options={preparedHash:f.options.preparedHash,now:NOW,minimumRemainingMs:5*60000};assert.equal(assertLease3RuntimeGrantAdmission(admission,options).application_id,APP);
 for(const clone of [copy(admission),{...admission},JSON.parse(JSON.stringify(admission)),{}])assert.throws(()=>assertLease3RuntimeGrantAdmission(clone,options));assert.throws(()=>assertLease3RuntimeGrantAdmission(admission,{...options,preparedHash:'f'.repeat(64)}));assert.throws(()=>assertLease3RuntimeGrantAdmission(admission,{...options,now:NOW+45*60000}));assert.throws(()=>assertLease3RuntimeGrantAdmission(admission,{...options,minimumRemainingMs:46*60000}));
});

test('missing namespace and conflicting retired-class namespaces fail closed',()=>{
 assert.throws(()=>assertLease3ApplicationRows([{...app(),durable_objects:{}}],{phase:'seal',applicationId:APP}));
 const before=observation();before.namespaces.push({id:'5'.repeat(32),class:P.predecessor.class_name,script:P.worker});assert.throws(()=>assertLease3Preflight(before,{now:NOW}));
 const later=boundary('activate');later.namespaces.push({id:'5'.repeat(32),class:P.retired[0].class_name,script:P.worker});assert.throws(()=>assertLease3SafetyBoundary(later,boundaryOptions('activate')));
});

test('provider container proof accepts exact legacy and documented mixed exports',()=>{
 assert.doesNotThrow(()=>assertObservedContainer({containers:[{class_name:P.class_name}]},P.class_name));
 const runtime={exports:{default:{type:'entrypoint'},RailsContainer:{type:'durable-object',storage:'sqlite',container:'retired'},[P.class_name]:{type:'durable-object',storage:'sqlite',container:'isp-member-production',state:'created'}}};assert.equal(assertObservedContainer(runtime,P.class_name,{expectedContainerName:'isp-member-production'}).container_name,'isp-member-production');
 runtime.containers=[{class_name:P.class_name,name:'isp-member-production'}];assert.doesNotThrow(()=>assertObservedContainer(runtime,P.class_name));runtime.containers[0].name='foreign';assert.throws(()=>assertObservedContainer(runtime,P.class_name));
});
test('documented exports refuse missing class, non-SQLite/unstable/boolean and name mismatch',()=>{
 const entry={type:'durable-object',storage:'sqlite',container:'isp-member-production'};
 for(const change of [{type:'entrypoint'},{storage:'memory'},{state:'tombstone'},{state:'transferred'},{container:true},{container:''}])assert.throws(()=>assertObservedContainer({exports:{[P.class_name]:{...entry,...change}}},P.class_name));assert.throws(()=>assertObservedContainer({containers:[{class_name:P.class_name}],exports:{default:{type:'entrypoint'}}},P.class_name));assert.throws(()=>assertObservedContainer({exports:{[P.class_name]:entry}},P.class_name,{expectedContainerName:'foreign'}));
});

test('predecessor migration tag must come from the actual same observed runtime',()=>{
 const missing=observation();delete missing.first.version.resources.script_runtime.migration_tag;missing.last=copy(missing.first);assert.throws(()=>assertLease3Preflight(missing,{now:NOW}));
 const documented=observation();for(const point of ['first','last']){const runtime=documented[point].version.resources.script_runtime;delete runtime.containers;runtime.exports={default:{type:'entrypoint'},[P.predecessor.class_name]:{type:'durable-object',storage:'sqlite',container:'observed-container'}};}assert.doesNotThrow(()=>assertLease3Preflight(documented,{now:NOW}));
});
