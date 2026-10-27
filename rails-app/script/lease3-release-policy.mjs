// Pure lease-3 policy only. No private files, credential loading, provider calls or activation.
import {createHash} from 'node:crypto';
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const account='a9720867333b64a4f8ee70cdfd673eb9',worker='isp-member-production';
export const LEASE3_POLICY=freeze({
 version:1,lease_id:'rails-staging-3',account,worker,application_name:worker,class_name:'RailsStaging3',compatibility_date:'2026-10-26',
 private_root:'D:/Projects/isp-rails-tools/isp-staging-private/leases/rails-staging-3',
 credential_root:'D:/Projects/isp-rails-tools/isp-staging-private',audit_root:'D:/Projects/isp-member-rails/audit/staging-3',
 credential_selector:'D:/Projects/isp-rails-tools/isp-staging-private/leases/rails-staging-3/provision-credential-provider.json',
 app_host:'isp-member-production.meithan-r.workers.dev',rails_source:'80d32fddf88251a6608ba047a577ce16efe8c834',
 image_digest:'sha256:152480a896060eae82a380dc54f651e199ff1585cd5dd805d0d51b9f3a587d2a',
 predecessor:{lease_id:'rails-staging-2',class_name:'RailsStaging2',namespace_id:'8ff8ea955b644da5b0cb2759e3c01c65',
  worker_version:'0a619974-23df-4ae3-9870-9e6e12fcc943',deployment_id:'82e1b292-6886-4526-8941-a3854cfe18c2',
  worker_source:'99a8ef4cadb79da495e3359a1cffdff3e82e3667',module_sha256:'8aa140362efef24fa0125e0127d0a5d08e8edf5bd211edfa56e84e7cfa481a2f',migration_tag:'rails-staging-v2'},
 retired:[{lease_id:'legacy-1',class_name:'RailsContainer',namespace_id:'a0e936fb9d634f59b1caaa1896b07a1f',application_id:'a03ae965-44e9-40b6-9c10-3f8f2c659c34'},
  {lease_id:'rails-staging-2',class_name:'RailsStaging2',namespace_id:'8ff8ea955b644da5b0cb2759e3c01c65',application_id:null}],
 required_exports:['RailsContainer','RailsStaging2','RailsStaging3'],migration_tag:'rails-staging-v3',
 runtime_limit_ms:55*60000,cleanup_reserve_minutes:10,cumulative_test_ceiling_usd:5,
 trigger:{script_id:'2add92d700014660819ef6b5d266f104',trigger_uuid:'338f5327-8486-4f8a-aa9a-b0ee4739f427',
  command:'node -e "console.log(\'ISP deployment is disabled; use the reviewed manual release procedure.\')"'},
 database:{project:'royal-glitter-45740959',host:'ep-delicate-frost-a1o15wrb.ap-southeast-1.aws.neon.tech',database:'neondb',pg_major:18,sslmode:'verify-full'},
 storage:{bucket:'isp-staging-private',endpoint:'https://'+account+'.r2.cloudflarestorage.com'}
});
const P=LEASE3_POLICY;
const runtimeGrantAdmissions=new WeakMap();
const SECRET_NAMES=['SECRET_KEY_BASE','ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY','ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY','ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT','ISP_STAGING_KEY','DATABASE_URL','STORAGE_BUCKET','AWS_REGION','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','STORAGE_ENDPOINT','STORAGE_FORCE_PATH_STYLE','MAIL_FROM'];
const PREPARED_FIELDS=['version','lease_id','account','worker','application_name','application_id','namespace_id','class_name','worker_source','rails_source','image_digest','rollback_worker_version','rollback_deployment_id','activation'];
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,null,2)+'\n';
const hex=(value,n)=>typeof value==='string'&&value.length===n&&/^[a-f0-9]+$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export class Lease3Refused extends Error{constructor(code='lease3_policy_refused'){super('Lease3 policy refused; inspect the recorded release boundary.');this.code=code;}}
const must=(condition,code)=>{if(!condition)throw new Lease3Refused(code);};
function utc(value){
 must(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value),'canonical_utc_required');
 const time=Date.parse(value);must(Number.isFinite(time)&&new Date(time).toISOString().replace('.000Z','Z')===value,'canonical_utc_required');return time;
}
function fresh(value,now){const time=Date.parse(value);must(Number.isFinite(now)&&typeof value==='string'&&Number.isFinite(time)&&time<=now+5000&&now-time<=60000,'fresh_observation_required');}
const same=(a,b)=>canonical(a)===canonical(b);
const sorted=value=>Object.fromEntries(Object.entries(value).sort());
const retiredApp=id=>P.retired.some(row=>row.application_id!==null&&row.application_id===id);
const retiredNamespace=id=>P.retired.some(row=>row.namespace_id===id);
function baselineIds(values,test,code){must(Array.isArray(values)&&values.every(test)&&new Set(values).size===values.length,code);}
export function lease3Context(selection){
 must(selection===P.lease_id,'explicit_lease3_selection_required');
 return freeze({leaseId:P.lease_id,fresh:true,privateRoot:P.private_root,credentialRoot:P.credential_root,auditRoot:P.audit_root,credentialSelector:P.credential_selector});
}
export function lease3Migration(){return freeze({old_tag:P.predecessor.migration_tag,new_tag:P.migration_tag,steps:[{new_sqlite_classes:[P.class_name]}]});}
export function assertLease3Namespace(namespaceId,baselineNamespaceIds=[]){
 must(hex(namespaceId,32),'fresh_namespace_required');baselineIds(baselineNamespaceIds,id=>hex(id,32),'complete_namespace_baseline_required');
 must(!P.retired.some(row=>row.namespace_id===namespaceId)&&!baselineNamespaceIds.includes(namespaceId),'retired_or_existing_namespace');return namespaceId;
}
export function assertLease3ApplicationRows(rows,{phase,namespaceId,applicationId,baselineApplicationIds=[]}={}){
 must(Array.isArray(rows)&&rows.length<100&&rows.every(row=>object(row)&&uuid(row.id)&&row.account_id===P.account&&typeof row.name==='string')&&new Set(rows.map(row=>row.id)).size===rows.length&&['create','seal','activate'].includes(phase),'complete_application_observation_required');baselineIds(baselineApplicationIds,uuid,'complete_application_baseline_required');
 if(namespaceId!==undefined)assertLease3Namespace(namespaceId);
 const related=rows.filter(row=>row?.name===P.worker||retiredApp(row?.id)||retiredNamespace(row?.durable_objects?.namespace_id)||
  (namespaceId!==undefined&&row?.durable_objects?.namespace_id===namespaceId));
 must(!related.some(row=>retiredApp(row.id)||retiredNamespace(row?.durable_objects?.namespace_id)),'retired_application_conflict');
 if(phase==='create'){must(related.length===0,'existing_application_conflict');return null;}
 must(hex(namespaceId,32)&&uuid(applicationId)&&!P.retired.some(row=>row.application_id===applicationId)&&!baselineApplicationIds.includes(applicationId),'fresh_application_required');
 must(related.length===1,'unique_application_required');const app=related[0];
 must(app.id===applicationId&&app.account_id===P.account&&app.name===P.worker&&app.durable_objects?.namespace_id===namespaceId,'application_identity_mismatch');return app;
}
export function assertLease3CleanupIdentity(app,prepared,{baselineNamespaceIds=[],baselineApplicationIds=[]}={}){
 must(prepared?.lease_id===P.lease_id&&prepared.account===P.account&&prepared.worker===P.worker&&prepared.class_name===P.class_name&&uuid(prepared.application_id),'cleanup_identity_required');
 assertLease3Namespace(prepared.namespace_id,baselineNamespaceIds);baselineIds(baselineApplicationIds,uuid,'complete_application_baseline_required');
 must(!retiredApp(prepared.application_id)&&!baselineApplicationIds.includes(prepared.application_id),'retired_application_conflict');
 if(app!==null)must(app?.id===prepared.application_id&&app.account_id===P.account&&app.name===P.worker&&app.durable_objects?.namespace_id===prepared.namespace_id,'application_identity_mismatch');
 // This pure identity boundary deliberately requires no runtime dates, live grant or handoff.
 return true;
}
function deployment(observed){
 const d=observed?.deployment,v=observed?.version;
 must(d?.id===P.predecessor.deployment_id&&v?.id===P.predecessor.worker_version&&d.versions?.length===1&&d.versions[0].version_id===v.id&&d.versions[0].percentage===100,'predecessor_deployment_mismatch');
 return v;
}
export function assertLease3Preflight(observation,{now=Date.now()}={}){
 must(object(observation),'preflight_observation_required');fresh(observation.observed_at,now);
 must(observation.account?.id===P.account,'selected_account_identity_required');
 must(observation.completeness?.applications===true&&observation.completeness?.namespaces===true,'complete_provider_lists_required');
 const version=deployment(observation.first);deployment(observation.last);must(same(observation.first,observation.last),'predecessor_changed_during_observation');
 must(version.annotations?.['workers/message']===P.predecessor.worker_source+' bundle:'+P.predecessor.module_sha256,'predecessor_source_mismatch');
 must(observation.content?.entrypoint==='index.mjs'&&observation.content.modules?.length===1&&observation.content.modules[0].name==='index.mjs'&&observation.content.modules[0].sha256===P.predecessor.module_sha256,'predecessor_module_mismatch');
 must(observation.migration_tag===P.predecessor.migration_tag&&version.resources?.script_runtime?.migration_tag===observation.migration_tag,'observed_v2_migration_required');
 const bindings=version.resources?.bindings;must(Array.isArray(bindings)&&bindings.length===8+SECRET_NAMES.length+1&&bindings.every(row=>object(row)&&typeof row.name==='string')&&new Set(bindings.map(row=>row.name)).size===bindings.length&&SECRET_NAMES.every(name=>bindings.filter(row=>row.name===name&&row.type==='secret_text').length===1),'predecessor_bindings_required');
 const vars=Object.fromEntries(bindings.filter(row=>row.type==='plain_text').map(row=>[row.name,row.text]));
 const expected={ISP_CONTAINER_ENABLED:'false',APP_HOST:P.app_host,ISP_STAGING_START_AT:'',ISP_STAGING_EXPIRES_AT:'',ISP_DEMO_MODE:'false',ISP_ACCOUNT_EMAILS_ENABLED:'false',ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED:'false',DB_SSLMODE:'verify-full'};
 must(same(sorted(vars),sorted(expected)),'predecessor_must_be_inactive');
 const bound=bindings.filter(row=>row.type==='durable_object_namespace');
 must(bound.length===1&&bound[0].name==='RAILS_CONTAINER'&&bound[0].class_name===P.predecessor.class_name&&bound[0].namespace_id===P.predecessor.namespace_id&&(bound[0].script_name===undefined||bound[0].script_name===P.worker),'predecessor_namespace_mismatch');
 must(version.resources?.script_runtime?.compatibility_date===P.compatibility_date,'predecessor_container_mismatch');assertObservedContainer(version.resources.script_runtime,P.predecessor.class_name,{expectedContainerName:observation.container_name});
 must(observation.ingress?.enabled===false&&observation.ingress.previews_enabled===false,'ingress_must_be_closed');
 const trigger=observation.trigger;must(trigger?.script_id===P.trigger.script_id&&trigger.trigger_uuid===P.trigger.trigger_uuid&&trigger.build_command===P.trigger.command&&trigger.deploy_command===P.trigger.command,'nop_controls_required');
 must(observation.controller?.state==='absent','parallel_controller_refused');fresh(observation.controller.observed_at,now);
 const namespaces=observation.namespaces;must(Array.isArray(namespaces)&&namespaces.length<1000&&namespaces.every(row=>hex(row.id,32))&&new Set(namespaces.map(row=>row.id)).size===namespaces.length,'complete_namespace_observation_required');
 for(const retired of P.retired){const matching=namespaces.filter(row=>row.id===retired.namespace_id);must(namespaces.filter(row=>row.script===P.worker&&row.class===retired.class_name).length===1&&matching.length===1&&matching[0].class===retired.class_name&&matching[0].script===P.worker&&matching[0].preview===undefined&&matching[0].dispatch_namespace===undefined,'retired_namespace_preservation_required');}
 must(!namespaces.some(row=>row.script===P.worker&&row.class===P.class_name),'new_namespace_already_exists');
 assertLease3ApplicationRows(observation.applications,{phase:'create'});
 const db=observation.dependencies?.database,r2=observation.dependencies?.storage;
 for(const receipt of [db,r2]){must(receipt?.status==='PASS'&&receipt.read_only===true&&hex(receipt.evidence_sha256,64),'dependency_read_evidence_required');fresh(receipt.observed_at,now);}
 must(Object.entries(P.database).every(([key,value])=>db[key]===value)&&db.ssl_verified===true,'database_identity_or_tls_mismatch');
 must(r2.bucket===P.storage.bucket&&r2.endpoint===P.storage.endpoint&&r2.private===true&&r2.access_verified===true,'private_storage_access_required');
 return freeze({version:1,lease_id:P.lease_id,account:P.account,worker:P.worker,observed_at:observation.observed_at,predecessor:P.predecessor,
  baseline_namespace_ids:namespaces.map(row=>row.id).sort(),baseline_application_ids:observation.applications.map(row=>row.id).sort(),
  database_evidence_sha256:db.evidence_sha256,storage_evidence_sha256:r2.evidence_sha256,activation:false});
}
function authorityScope(authority,purpose){
 must(object(authority)&&authority.purpose===purpose&&authority.owner_authorized===true&&authority.lease_id===P.lease_id&&authority.account===P.account&&authority.worker===P.worker&&typeof authority.reference==='string'&&authority.reference.trim().length>=12,'recorded_human_authority_required');
}
export function validateLease3AccessGrant(grant,{authority,now=Date.now()}={}){
 must(grant?.version===1&&grant.purpose==='credential-access'&&grant.lease_id===P.lease_id&&grant.account===P.account&&grant.worker===P.worker&&grant.owner_authorized===true&&grant.runtime_authorized===false&&grant.cumulative_test_ceiling_usd===5,'separate_access_grant_required');
 authorityScope(authority,'credential-access');must(grant.human_grant_reference===authority.reference&&grant.authority_sha256===hash(canonical(authority)),'recorded_access_authority_required');
 must(['oauth','api-token'].includes(grant.credential_kind)&&grant.credential_kind===authority.credential_kind&&grant.starts_at===authority.starts_at&&grant.expires_at===authority.expires_at,'access_period_must_match_authority');
 if(grant.credential_kind==='api-token')must(hex(grant.token_id,32)&&grant.token_id===authority.token_id,'exact_api_token_identity_required');
 const start=utc(grant.starts_at),end=utc(grant.expires_at);must(Number.isFinite(now)&&end>start&&start<=now&&now<end,'access_period_unavailable');
 if(end-start>60*60000)must(authority.longer_access_approved===true,'longer_access_requires_explicit_owner_approval');
 return freeze({start,end,credential_kind:grant.credential_kind,access_sha256:hash(canonical(grant)),runtime_authorized:false});
}
export function validateLease3RuntimeGrant(grant,{accessGrant,authority,runtimeAuthority,packageHash,helperHash,source,ciRun,prepared,preparedHash,existingRuntime=null,existingRuntimeGrant=null,remainingTestUsd,budgetLedgerHash,now=Date.now()}={}){
 const access=validateLease3AccessGrant(accessGrant,{authority,now});validateLease3PreparedRelease(prepared);
 must(grant?.version===1&&grant.purpose==='runtime-window'&&grant.lease_id===P.lease_id&&grant.account===P.account&&grant.worker===P.worker&&grant.owner_authorized===true&&grant.runtime_authorized===true,'separate_runtime_grant_required');
 authorityScope(runtimeAuthority,'runtime-window');must(grant.human_grant_reference===runtimeAuthority.reference&&grant.authority_sha256===hash(canonical(runtimeAuthority)),'recorded_runtime_authority_required');
 must(hex(packageHash,64)&&hex(helperHash,64)&&hex(source,40)&&source!==P.predecessor.worker_source&&prepared.worker_source===source&&Number.isSafeInteger(ciRun)&&ciRun>0&&hex(preparedHash,64),'reviewed_candidate_required');
 must(grant.package_sha256===packageHash&&grant.helper_sha256===helperHash&&grant.worker_source===source&&grant.ci_run_id===ciRun&&grant.prepared_release_sha256===preparedHash&&grant.credential_access_sha256===access.access_sha256&&grant.credential_kind===access.credential_kind,'runtime_provenance_mismatch');
 if(grant.credential_kind==='api-token')must(grant.token_id===accessGrant.token_id,'exact_api_token_identity_required');
 must(grant.image_digest===P.image_digest&&grant.cumulative_test_ceiling_usd===5&&grant.cleanup_reserve_minutes===10,'runtime_limits_required');
 const start=utc(grant.runtime_start_at),end=utc(grant.runtime_expires_at);
 must(end>start&&end-start<=P.runtime_limit_ms&&start>=access.start&&end<=access.end&&start<=now+60000&&now<end,'immutable_55_minute_window_required');
 must(runtimeAuthority.runtime_start_at===grant.runtime_start_at&&runtimeAuthority.runtime_expires_at===grant.runtime_expires_at&&runtimeAuthority.prepared_release_sha256===preparedHash&&runtimeAuthority.reserved_test_usd===grant.reserved_test_usd&&runtimeAuthority.cumulative_test_ceiling_usd===5,'runtime_period_must_match_authority');
 must(hex(budgetLedgerHash,64)&&grant.cumulative_budget_ledger_sha256===budgetLedgerHash&&Number.isFinite(remainingTestUsd)&&remainingTestUsd>=0&&remainingTestUsd<=5&&Number.isFinite(grant.reserved_test_usd)&&grant.reserved_test_usd>0&&grant.reserved_test_usd<=remainingTestUsd,'cumulative_budget_reservation_required');
 if(existingRuntimeGrant!==null)must(object(existingRuntimeGrant)&&same(existingRuntimeGrant,grant),'runtime_grant_replacement_refused');
 if(existingRuntime!==null){
  must(existingRuntimeGrant!==null,'existing_runtime_needs_original_grant');
  const expected={ISP_STAGING_LEASE:P.lease_id,APPLICATION_ID:prepared.application_id,NAMESPACE_ID:prepared.namespace_id,CANDIDATE_COMMIT:prepared.worker_source,RAILS_SOURCE:P.rails_source,IMAGE_DIGEST:P.image_digest,ROLLBACK_WORKER_VERSION:prepared.rollback_worker_version,PREPARED_RELEASE_SHA256:preparedHash,ISP_STAGING_START_AT:grant.runtime_start_at,ISP_STAGING_EXPIRES_AT:grant.runtime_expires_at};
  must(object(existingRuntime)&&Object.entries(expected).every(([key,value])=>existingRuntime[key]===value),'runtime_replacement_refused');
 }
 const admission=freeze({start,end,stop_at:end-5*60000,admission_cutoff:end-10*60000,access_sha256:access.access_sha256,runtime_grant_sha256:hash(canonical(grant)),reserved_test_usd:grant.reserved_test_usd,activation:false});
 runtimeGrantAdmissions.set(admission,{...admission,lease_id:P.lease_id,prepared_release_sha256:preparedHash,application_id:prepared.application_id,namespace_id:prepared.namespace_id});return admission;
}
// This process-local object proves grant validation only. Active receipt/watchdog checks remain mandatory.
export function assertLease3RuntimeGrantAdmission(admission,{preparedHash,now=Date.now(),minimumRemainingMs=0}={}){
 const proof=runtimeGrantAdmissions.get(admission);
 must(proof&&hex(preparedHash,64)&&proof.prepared_release_sha256===preparedHash&&Number.isFinite(now)&&Number.isFinite(minimumRemainingMs)&&minimumRemainingMs>=0&&now>=proof.start&&now<proof.admission_cutoff&&now+minimumRemainingMs<=proof.admission_cutoff,'verified_unexpired_runtime_grant_required');return freeze(structuredClone(proof));
}

export const lease3ImageRef=()=>'registry.cloudflare.com/'+P.account+'/isp-member-rails@'+P.image_digest;
const migrationHistory=()=>[{tag:'rails-container-v1',new_sqlite_classes:['RailsContainer']},{tag:P.predecessor.migration_tag,new_sqlite_classes:[P.predecessor.class_name]}];
const inactiveVars=()=>({ISP_CONTAINER_ENABLED:'false',APP_HOST:P.app_host,ISP_STAGING_START_AT:'',ISP_STAGING_EXPIRES_AT:'',ISP_DEMO_MODE:'false',ISP_ACCOUNT_EMAILS_ENABLED:'false',ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED:'false',DB_SSLMODE:'verify-full'});
function inactiveConfig(config,className,history){
 must(config?.name===P.worker&&config.account_id===P.account&&config.compatibility_date===P.compatibility_date&&config.workers_dev===false&&config.preview_urls===false&&same(config.routes,[])&&same(config.observability,{enabled:false}),'inactive_config_identity_required');
 must(object(config.vars)&&same(sorted(config.vars),sorted(inactiveVars())),'inactive_config_flags_required');
 must(config.containers?.length===1&&same(config.durable_objects,{bindings:[{name:'RAILS_CONTAINER',class_name:className}]}),'inactive_config_class_required');
 const c=config.containers[0];must(c.name===P.worker&&c.class_name===className&&c.scheduling_policy==='default'&&c.image===lease3ImageRef()&&c.instance_type==='standard-2'&&c.max_instances===1&&same(c.observability,{enabled:false}),'inactive_config_image_or_limits_mismatch');
 must(same(config.migrations,history),'migration_history_mismatch');return config;
}
export function buildLease3InactiveConfig(v2){
 inactiveConfig(v2,P.predecessor.class_name,migrationHistory());const config=structuredClone(v2);
 config.$schema='D:/Projects/isp-member-rails/cloudflare/node_modules/wrangler/config-schema.json';config.main='D:/Projects/isp-member-rails/cloudflare/staging/index.js';
 config.containers[0].class_name=P.class_name;config.durable_objects.bindings[0].class_name=P.class_name;config.migrations.push({tag:P.migration_tag,new_sqlite_classes:[P.class_name]});return freeze(validateLease3InactiveConfig(config));
}
export function validateLease3InactiveConfig(config){return inactiveConfig(config,P.class_name,[...migrationHistory(),{tag:P.migration_tag,new_sqlite_classes:[P.class_name]}]);}
export function validateLease3PreparedRelease(value){
 must(object(value)&&Object.keys(value).length===PREPARED_FIELDS.length&&PREPARED_FIELDS.every(key=>Object.hasOwn(value,key))&&value.version===1&&value.lease_id===P.lease_id&&value.account===P.account&&value.worker===P.worker&&value.application_name===P.worker&&value.class_name===P.class_name&&value.activation===false,'lease3_prepared_record_required');
 assertLease3Namespace(value.namespace_id);must(uuid(value.application_id)&&!retiredApp(value.application_id)&&hex(value.worker_source,40)&&value.worker_source!==P.predecessor.worker_source&&value.rails_source===P.rails_source&&value.image_digest===P.image_digest,'prepared_release_identity_mismatch');
 must(uuid(value.rollback_worker_version)&&![P.predecessor.worker_version,'d6978392-76ac-4208-aaf9-e907be1939c0'].includes(value.rollback_worker_version)&&uuid(value.rollback_deployment_id)&&![P.predecessor.deployment_id,'1847c5bc-7b6e-4c0a-9eee-657f7c3476f1'].includes(value.rollback_deployment_id),'fresh_inactive_rollback_required');return freeze(structuredClone(value));
}

// Call immediately before app POST, seal and activation; Worker/module verification is separate.
export function assertLease3SafetyBoundary(observation,{phase,namespaceId,applicationId,baselineNamespaceIds=[],baselineApplicationIds=[],now=Date.now()}={}){
 must(object(observation)&&['create','seal','activate'].includes(phase),'explicit_live_boundary_required');fresh(observation.observed_at,now);
 must(observation.account?.id===P.account&&observation.completeness?.applications===true&&observation.completeness?.namespaces===true,'complete_selected_account_observation_required');
 assertLease3Namespace(namespaceId,baselineNamespaceIds);
 must(observation.ingress?.enabled===false&&observation.ingress.previews_enabled===false,'ingress_must_be_closed');
 const t=observation.trigger;must(t?.script_id===P.trigger.script_id&&t.trigger_uuid===P.trigger.trigger_uuid&&t.build_command===P.trigger.command&&t.deploy_command===P.trigger.command,'nop_controls_required');
 must(observation.controller?.state==='absent','parallel_controller_refused');fresh(observation.controller.observed_at,now);
 const rows=observation.namespaces;must(Array.isArray(rows)&&rows.length<1000&&rows.every(row=>object(row)&&hex(row.id,32))&&new Set(rows.map(row=>row.id)).size===rows.length,'complete_namespace_observation_required');
 for(const retired of P.retired){const found=rows.filter(row=>row.id===retired.namespace_id);must(rows.filter(row=>row.script===P.worker&&row.class===retired.class_name).length===1&&found.length===1&&found[0].class===retired.class_name&&found[0].script===P.worker&&found[0].preview===undefined&&found[0].dispatch_namespace===undefined,'retired_namespace_preservation_required');}
 const current=rows.filter(row=>row.script===P.worker&&row.class===P.class_name);must(current.length===1&&current[0].id===namespaceId&&current[0].preview===undefined&&current[0].dispatch_namespace===undefined,'unique_fresh_namespace_required');
 const app=assertLease3ApplicationRows(observation.applications,{phase,namespaceId,applicationId,baselineApplicationIds});
 if(app){
  const detail=assertLease3ApplicationRows([observation.application],{phase,namespaceId,applicationId,baselineApplicationIds});
  must(detail.scheduling_policy==='default'&&detail.configuration?.image===lease3ImageRef()&&detail.configuration.instance_type==='standard-2'&&detail.instances===0&&detail.max_instances===1&&(detail.observability?.logs?.enabled===false||detail.configuration?.observability?.logs?.enabled===false),'inactive_application_configuration_required');
  must(observation.completeness?.instances===true&&Array.isArray(observation.instances)&&observation.instances.length===0,'actual_zero_instances_required');
 }
 const db=observation.dependencies?.database,r2=observation.dependencies?.storage;
 for(const receipt of [db,r2]){must(receipt?.status==='PASS'&&receipt.read_only===true&&hex(receipt.evidence_sha256,64),'dependency_read_evidence_required');fresh(receipt.observed_at,now);}
 must(Object.entries(P.database).every(([key,value])=>db[key]===value)&&db.ssl_verified===true,'database_identity_or_tls_mismatch');
 must(r2.bucket===P.storage.bucket&&r2.endpoint===P.storage.endpoint&&r2.private===true&&r2.access_verified===true,'private_storage_access_required');
 return freeze({lease_id:P.lease_id,phase,namespace_id:namespaceId,application_id:app?.id??null,observed_at:observation.observed_at,activation:false});
}

// Known provider representations only; mixed Worker/retired exports remain permitted.
export function assertObservedContainer(runtime,className,{expectedContainerName}={}){
 must(object(runtime)&&typeof className==='string','observed_container_required');let legacy=false,documented=false,legacyName;
 if(runtime.containers!==undefined){
  must(Array.isArray(runtime.containers)&&runtime.containers.length===1&&runtime.containers[0]?.class_name===className,'observed_container_mismatch');legacy=true;legacyName=runtime.containers[0].name;
  if(legacyName!==undefined)must(typeof legacyName==='string'&&legacyName.length>0&&legacyName.length<=128,'observed_container_name_required');
 }
 let exportName;
 if(runtime.exports!==undefined){
  must(object(runtime.exports)&&Object.hasOwn(runtime.exports,className),'observed_container_export_required');const entry=runtime.exports[className];
  must(object(entry)&&entry.type==='durable-object'&&entry.storage==='sqlite'&&(entry.state===undefined||entry.state==='created')&&typeof entry.container==='string'&&entry.container.length>0&&entry.container.length<=128,'observed_container_export_mismatch');exportName=entry.container;documented=true;
 }
 must(legacy||documented,'observed_container_required');
 if(expectedContainerName!==undefined)must(typeof expectedContainerName==='string'&&expectedContainerName.length>0&&expectedContainerName.length<=128&&(legacyName===undefined||legacyName===expectedContainerName)&&(!documented||exportName===expectedContainerName),'observed_container_name_mismatch');
 if(legacy&&documented&&legacyName!==undefined)must(legacyName===exportName,'conflicting_container_representations');
 return freeze({class_name:className,container_name:exportName??legacyName??null});
}
