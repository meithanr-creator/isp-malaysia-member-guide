// Pure recovery preparation. No filesystem, credentials, subprocesses, network or provider calls.
import {createHash} from 'node:crypto';
export const PROJECT='royal-glitter-45740959', PARENT='br-floral-tree-a1hpnagn';
export const PARENT_HOST='ep-delicate-frost-a1o15wrb.ap-southeast-1.aws.neon.tech';
export const BUCKET='isp-staging-private', LEASE='rails-staging-2';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HEX=/^[a-f0-9]{64}$/, COMMIT=/^[a-f0-9]{40}$/;
const HOST=/^ep-[a-z0-9-]+\.ap-southeast-1\.aws\.neon\.tech$/;
const PURPOSES=['SECRET_KEY_BASE','ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY','ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY','ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT'];
export class RecoveryRefused extends Error {}
function need(ok,code){if(!ok)throw new RecoveryRefused(code);}
function object(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);}
function exact(v,keys){need(object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)),'unexpected_fields');}
export function canonical(value){
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(object(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 need(value===null||typeof value==='string'||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value)),'invalid_json_value');
 return JSON.stringify(value);
}
export const sha256=value=>createHash('sha256').update(value).digest('hex');
export const digest=value=>sha256(canonical(value));
const same=(a,b)=>canonical(a)===canonical(b);
function time(value){need(typeof value==='string'&&/^\d{4}-\d\d-\d\dT/.test(value)&&Number.isFinite(Date.parse(value)),'invalid_time');return Date.parse(value);}
function reference(value){need(object(value)&&typeof value.ref==='string'&&/^[A-Za-z0-9][A-Za-z0-9_./:-]{0,255}$/.test(value.ref)&&!value.ref.includes('..')&&HEX.test(value.sha256),'invalid_evidence_reference');return value;}
function ids(values){need(Array.isArray(values)&&values.every(v=>Number.isSafeInteger(v)&&v>0)&&new Set(values).size===values.length,'invalid_fixture_ids');return [...values].sort((a,b)=>a-b);}
function parse(source){try{return JSON.parse(source);}catch{throw new RecoveryRefused('invalid_json');}}
export function validateDeadlines(window,now,{action=false,cleanup=false}={}){
 exact(window,['starts_at','action_deadline','cleanup_deadline','hard_deadline','known_spend_usd','reserved_usd','ceiling_usd']);
 const start=time(window.starts_at),a=time(window.action_deadline),c=time(window.cleanup_deadline),h=time(window.hard_deadline);
 need(start<a&&a<c&&c<=h&&h-start<=55*60000&&a-start<=45*60000&&h-a>=10*60000,'invalid_deadline_bounds');
 need(window.ceiling_usd===5&&[window.known_spend_usd,window.reserved_usd].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0)&&window.known_spend_usd+window.reserved_usd<=5,'cumulative_budget_exceeded');
 need(Number.isFinite(now)&&now<h,'expired_window');
 if(action)need(now>=start&&now<a,'action_deadline');
 if(cleanup)need(now>=start&&now<c,'cleanup_deadline');
 return window;
}
function metadata(value){
 exact(value,['content_type','cache_control','content_disposition','content_encoding','content_language','user_metadata']);
 for(const name of ['content_type','cache_control','content_disposition','content_encoding','content_language'])need(value[name]===null||(typeof value[name]==='string'&&value[name].length<=2048&&!/[\r\n]/.test(value[name])),'invalid_object_metadata');
 need(object(value.user_metadata)&&Object.keys(value.user_metadata).length<=64,'invalid_object_metadata');
 for(const[k,v]of Object.entries(value.user_metadata))need(/^[a-z0-9_-]{1,128}$/.test(k)&&typeof v==='string'&&v.length<=2048&&!/[\r\n]/.test(v),'invalid_object_metadata');
 return value;
}
export function validateObjectManifest(value,binding){
 exact(value,['version','operation_id','lease_id','manifest_sha256','checkpoint_lsn','bucket','objects','historical_key_references']);
 need(value.version===1&&value.operation_id===binding.operation_id&&value.lease_id===binding.lease_id&&value.manifest_sha256===binding.manifest_sha256&&value.checkpoint_lsn===binding.checkpoint_lsn&&value.bucket===BUCKET,'object_manifest_binding');
 need(Array.isArray(value.objects)&&value.objects.length<=1000,'object_inventory_bound');
 const keys=new Set();
 for(const item of value.objects){
  exact(item,['key','state','roles','ledger_state','length','sha256','metadata','backup_relative_path','observation']);
  need(typeof item.key==='string'&&/^(?:[a-z0-9]{28,128}|managed-uploads\/[a-f0-9-]{36}\/[a-f0-9]{48})$/.test(item.key)&&!keys.has(item.key),'invalid_or_duplicate_object_key');keys.add(item.key);
  need(Array.isArray(item.roles)&&item.roles.length>0&&new Set(item.roles).size===item.roles.length&&item.roles.every(r=>['draft','preview','published','durable_ledger','pending','tombstone'].includes(r)),'object_roles');
  need(['none','pending','committed','tombstone'].includes(item.ledger_state),'object_ledger_state');
  reference(item.observation);
  if(item.state==='present'){
   need(Number.isSafeInteger(item.length)&&item.length>0&&item.length<=30*1024*1024&&HEX.test(item.sha256),'object_bytes_required');
   metadata(item.metadata);
   need(item.backup_relative_path==='objects/'+item.sha256+'.bin','object_backup_path');
  }else{
   need(item.state==='absent'&&item.roles.every(r=>['pending','tombstone','durable_ledger'].includes(r))&&['pending','tombstone'].includes(item.ledger_state),'absent_object_scope');
   need(item.length===null&&item.sha256===null&&item.metadata===null&&item.backup_relative_path===null,'absent_object_not_a_backup');
  }
 }
 need(Array.isArray(value.historical_key_references)&&value.historical_key_references.length===PURPOSES.length,'historical_key_references');
 const purposes=new Set();
 for(const item of value.historical_key_references){
  exact(item,['purpose','secret_store_ref','sealed_archive']);
  need(PURPOSES.includes(item.purpose)&&!purposes.has(item.purpose),'historical_key_references');purposes.add(item.purpose);
  need(typeof item.secret_store_ref==='string'&&/^recovery-keyset:[a-zA-Z0-9_./-]{1,160}#[A-Z_]+$/.test(item.secret_store_ref)&&item.secret_store_ref.endsWith('#'+item.purpose)&&!item.secret_store_ref.includes('..'),'historical_key_reference_only');
  reference(item.sealed_archive);
 }
 return value;
}
export function verifyObjectObservation(expected,actual,{backup=false}={}){
 need(object(actual)&&actual.key===expected.key,'object_key_mismatch');
 need(actual.state===expected.state,'object_presence_mismatch');
 if(expected.state==='absent')return {verified:true,absence_is_terminal_proof:false};
 need(actual.length===expected.length&&actual.sha256===expected.sha256&&same(actual.metadata,expected.metadata),'object_bytes_or_metadata_mismatch');
 if(backup)need(actual.backup_relative_path===expected.backup_relative_path,'object_backup_path');
 return {verified:true,scope:backup?'supplied_backup_observation':'supplied_object_observation'};
}
export function validateObjectCoverage(manifest,inventory,binding){
 exact(inventory,['version','operation_id','lease_id','manifest_sha256','checkpoint_lsn','keys']);
 need(inventory.version===1&&inventory.operation_id===binding.operation_id&&inventory.lease_id===binding.lease_id&&inventory.manifest_sha256===binding.manifest_sha256&&inventory.checkpoint_lsn===binding.checkpoint_lsn&&Array.isArray(inventory.keys),'checkpoint_key_inventory_binding');
 const seen=new Set();
 for(const key of inventory.keys){
  exact(key,['key','state','roles','ledger_state','length','source_refs']);
  need(!seen.has(key.key)&&Array.isArray(key.source_refs)&&key.source_refs.length>0,'checkpoint_key_inventory');seen.add(key.key);
  for(const ref of key.source_refs){exact(ref,['kind','id','slot']);need(['blob','managed_upload','revision'].includes(ref.kind)&&typeof ref.id==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(ref.id)&&['draft','preview','published','durable_ledger','pending','tombstone'].includes(ref.slot),'checkpoint_key_source');}
 }
 const selection=value=>({key:value.key,state:value.state,roles:[...value.roles].sort(),ledger_state:value.ledger_state,length:value.length});
 const sorted=values=>values.map(selection).sort((a,b)=>a.key.localeCompare(b.key));
 need(same(sorted(inventory.keys),sorted(manifest.objects)),'object_inventory_missing_extra_or_mismatched_key');
 return true;
}

export function prepareRecovery({request,manifestBytes,preparedBytes,checkpointInventoryBytes=null,now=Date.now()}){
 exact(request,['version','operation_id','lease_id','manifest_sha256','prepared_release_sha256','tooling_source','configuration_sha256','window','checkpoint','object_manifest']);
 need(request.version===1&&UUID.test(request.operation_id)&&request.lease_id===LEASE,'fresh_lease_required');
 need(sha256(manifestBytes)===request.manifest_sha256&&sha256(preparedBytes)===request.prepared_release_sha256,'stale_manifest_or_release');
 const manifest=parse(manifestBytes),prepared=parse(preparedBytes);
 need(manifest.version===1&&manifest.phase==='active'&&/^qa-\d{8}-[a-f0-9]{12}$/.test(manifest.run_marker),'active_fixture_manifest_required');
 need(same(manifest.target,{project:PROJECT,host:PARENT_HOST,database:'neondb'}),'wrong_parent');
 need(prepared.lease_id===LEASE&&prepared.activation===false&&prepared.prepared_release_sha256===undefined&&COMMIT.test(prepared.rails_source)&&COMMIT.test(prepared.worker_source)&&/^sha256:[a-f0-9]{64}$/.test(prepared.image_digest),'prepared_release_binding');
 need(COMMIT.test(request.tooling_source)&&HEX.test(request.configuration_sha256),'revision_binding');
 need(object(manifest.actors)&&object(manifest.records),'fixture_inventory');
 const actorIds=ids(Object.values(manifest.actors).map(a=>a.id));
 need(actorIds.length>0,'empty_actor_inventory');
 const recordIds=Object.fromEntries(Object.entries(manifest.records).map(([kind,rows])=>{need(Array.isArray(rows),'fixture_inventory');return[kind,ids(rows.map(r=>r.id))];}));
 validateDeadlines(request.window,now);
 const binding={operation_id:request.operation_id,lease_id:LEASE,run_marker:manifest.run_marker,manifest_sha256:request.manifest_sha256,prepared_release_sha256:request.prepared_release_sha256,rails_source:prepared.rails_source,worker_source:prepared.worker_source,tooling_source:request.tooling_source,image_digest:prepared.image_digest,configuration_sha256:request.configuration_sha256};
 const blockers=['reviewed_operation_specific_runtime_and_watchdog','provider_creation_and_independent_identity_observation','restored_application_member_admin_files_writes_restart_rollback'];
 let checkpoint=null,objects=null;
 if(request.checkpoint===null)blockers.push('hosted_populated_paused_consistent_checkpoint');
 else{
  checkpoint=request.checkpoint;
  exact(checkpoint,['lsn','captured_at','mutations_paused','population','reconciliation','inventory']);
  need(typeof checkpoint.lsn==='string'&&/^[0-9A-F]+\/[0-9A-F]+$/i.test(checkpoint.lsn)&&time(checkpoint.captured_at)>=time(request.window.starts_at)&&time(checkpoint.captured_at)<=now&&checkpoint.mutations_paused===true,'checkpoint_not_current_and_paused');
  need(same([...checkpoint.population].sort(),['consultation','discover_upload','event_upload','interest','publication_upload']),'checkpoint_population_incomplete');
  reference(checkpoint.reconciliation);reference(checkpoint.inventory);
 }
 if(request.object_manifest===null)blockers.push('verified_complete_private_object_backup_and_historical_keys');
 else{
  need(checkpoint!==null,'objects_without_checkpoint');
  objects=validateObjectManifest(request.object_manifest,{...binding,checkpoint_lsn:checkpoint.lsn});
  need(typeof checkpointInventoryBytes==='string'&&sha256(checkpointInventoryBytes)===checkpoint.inventory.sha256,'checkpoint_inventory_bytes_required');
  validateObjectCoverage(objects,parse(checkpointInventoryBytes),{...binding,checkpoint_lsn:checkpoint.lsn});
  for(const role of ['draft','preview','published','durable_ledger'])need(objects.objects.some(o=>o.state==='present'&&o.roles.includes(role)),'object_role_inventory_incomplete');
 }
 const plan={version:1,kind:'recovery_preparation_only',binding,parent:{project:PROJECT,branch_id:PARENT,host:PARENT_HOST,database:'neondb',region:'aws-ap-southeast-1',pg_version:18},resource_name:'qa-recovery-'+request.operation_id,window:request.window,fixture_ids:{actors:actorIds,records:recordIds},checkpoint,object_manifest:objects,finalize_restore:false,execution_enabled:false,blocking_dependencies:blockers,status:'NOT RUN',steps:['capture_parent','backup_objects_and_keys','snapshot','restore_branch','verify_restored_inventory','restore_objects','start_pinned_application','member_admin_file_journeys','application_writes_and_all_sequences','fresh_process_restart_reads','rollback_parent_unchanged','cleanup_exact_resources'].map(id=>({id,status:'NOT RUN'}))};
 return {...plan,plan_sha256:digest(plan)};
}
export function validatePlan(plan){
 need(object(plan)&&HEX.test(plan.plan_sha256),'invalid_plan');
 const {plan_sha256,...body}=plan;need(digest(body)===plan_sha256&&plan.execution_enabled===false&&plan.finalize_restore===false,'plan_seal_mismatch');return plan;
}
export function createJournal(plan){validatePlan(plan);return {version:1,operation_id:plan.binding.operation_id,plan_sha256:plan.plan_sha256,events:[]};}
function checkJournal(journal,plan){
 validatePlan(plan);need(journal.version===1&&journal.operation_id===plan.binding.operation_id&&journal.plan_sha256===plan.plan_sha256&&Array.isArray(journal.events),'journal_binding');
 let prior=plan.plan_sha256;
 for(let i=0;i<journal.events.length;i++){const {sha256:hash,...entry}=journal.events[i];need(entry.sequence===i+1&&entry.previous_sha256===prior&&digest(entry)===hash,'journal_chain');prior=hash;}
 return prior;
}
const ACTIONS=['capture-parent','backup-objects','snapshot-create','branch-restore','endpoint-create','verify-restored','restore-objects','application-journeys','sequence-writes','restart','rollback-parent','cleanup'];
export function appendJournal(journal,plan,event,now=Date.now()){
 const previous=checkJournal(journal,plan);exact(event,['action','status','resource','evidence']);
 need(ACTIONS.includes(event.action)&&['started','observed','failed','ambiguous','resource-recorded'].includes(event.status),'journal_event');
 if(event.status==='started'){
  validateDeadlines(plan.window,now,event.action==='cleanup'?{cleanup:true}:{action:true});
  need(!journal.events.some(e=>e.action===event.action&&e.status==='started'),'no_replay');
 }else{
  need(journal.events.some(e=>e.action===event.action&&e.status==='started'),'event_without_start');
 }
 need(event.resource===null||object(event.resource),'journal_resource');
 if(event.resource!==null){
  exact(event.resource,['type','id','name','source_id','host']);
  const r=event.resource;need(['snapshot','branch','endpoint'].includes(r.type)&&typeof r.id==='string'&&/^[a-z0-9-]{8,128}$/.test(r.id)&&r.name===plan.resource_name,'resource_identity');
  need(r.id!==PARENT&&r.host!==PARENT_HOST,'parent_resource_forbidden');
  need(typeof r.source_id==='string'&&(r.host===null||HOST.test(r.host)),'resource_identity');
 }
 if(event.evidence!==null)reference(event.evidence);
 if(event.status==='resource-recorded')need(['snapshot-create','branch-restore','endpoint-create'].includes(event.action)&&event.resource!==null,'resource_recording_scope');
 const entry={sequence:journal.events.length+1,previous_sha256:previous,at:new Date(now).toISOString(),...event};
 return {...journal,events:[...journal.events,{...entry,sha256:digest(entry)}]};
}
// Selected raw fields follow @neon/sdk 7.5.0. Snapshot restores are independent roots,
// not ordinary forks. Local source_id denotes recorded operation provenance only.
export function validateCreatedTarget(plan,receipt,journal){
 checkJournal(journal,plan);
 exact(receipt,['operation_id','plan_sha256','project','snapshot','restore_request','restore_response','completed_operations','branch','endpoint','before','independent_observation']);
 need(receipt.operation_id===plan.binding.operation_id&&receipt.plan_sha256===plan.plan_sha256&&plan.checkpoint!==null,'created_target_binding');
 const {project,snapshot:s,branch:b,endpoint:e,before,restore_request:request,restore_response:response}=receipt;
 need(project.id===PROJECT&&project.region_id==='aws-ap-southeast-1'&&project.pg_version===18,'created_target_project');
 exact(before,['branches','endpoints','snapshots']);
 need([before.branches,before.endpoints,before.snapshots].every(Array.isArray)&&before.branches.some(v=>v.id===PARENT&&v.default===true),'before_inventory_required');
 need(typeof s.id==='string'&&/^[a-zA-Z0-9-]{8,128}$/.test(s.id)&&s.source_branch_id===PARENT&&s.name===plan.resource_name&&s.lsn===plan.checkpoint.lsn&&!before.snapshots.some(v=>v.id===s.id),'snapshot_lineage');
 exact(request,['method','path','body']);exact(request.body,['name','finalize_restore']);
 need(request.method==='POST'&&request.path==='/projects/'+PROJECT+'/snapshots/'+s.id+'/restore'&&request.body.name===plan.resource_name&&request.body.finalize_restore===false,'restore_request_binding');
 need(object(response)&&object(response.branch)&&response.branch.id===b.id&&response.branch.project_id===PROJECT&&response.branch.name===plan.resource_name,'restore_response_binding');
 need(Array.isArray(response.operations)&&response.operations.length>0&&Array.isArray(receipt.completed_operations)&&receipt.completed_operations.length===response.operations.length&&new Set(response.operations.map(o=>o.id)).size===response.operations.length,'restore_operations');
 for(const op of response.operations)need(receipt.completed_operations.some(done=>done.id===op.id&&done.project_id===PROJECT&&done.branch_id===b.id&&['finished','skipped'].includes(done.status)),'restore_operation_incomplete');
 need(/^br-[a-z0-9-]+$/.test(b.id)&&b.project_id===PROJECT&&b.id!==PARENT&&b.name===plan.resource_name&&b.parent_id===undefined&&b.default===false&&(b.primary===undefined||b.primary===false)&&b.protected===false&&b.current_state==='ready'&&!before.branches.some(v=>v.id===b.id),'isolated_snapshot_root_required');
 need(/^ep-[a-z0-9-]+$/.test(e.id)&&e.project_id===PROJECT&&e.region_id===project.region_id&&e.branch_id===b.id&&e.type==='read_write'&&e.host!==PARENT_HOST&&HOST.test(e.host)&&!e.host.includes('-pooler.')&&!before.endpoints.some(old=>old.id===e.id||old.host===e.host)&&e.autoscaling_limit_min_cu===0.25&&e.autoscaling_limit_max_cu===0.25&&[0,300].includes(e.suspend_timeout_seconds),'isolated_endpoint_required');
 for(const[type,value,source_id,host]of [['snapshot',s,PARENT,null],['branch',b,s.id,null],['endpoint',e,b.id,e.host]])need(journal.events.some(row=>row.status==='resource-recorded'&&same(row.resource,{type,id:value.id,name:plan.resource_name,source_id,host})),'resource_not_journaled');
 need(journal.events.some(row=>row.action==='branch-restore'&&row.status==='started'&&row.evidence?.sha256===digest(request))&&journal.events.some(row=>row.action==='branch-restore'&&row.status==='resource-recorded'&&row.resource?.id===b.id&&row.evidence?.sha256===digest(response)),'restore_journal_request_response');
 reference(receipt.independent_observation);
 return {operation_id:plan.binding.operation_id,plan_sha256:plan.plan_sha256,project:PROJECT,branch_id:b.id,endpoint_id:e.id,host:e.host,database:'neondb',sslmode:'verify-full',write_authorized:false,reported_default:b.default,reported_primary:b.primary??null,derived_lineage:'recorded_snapshot_restore_request_and_response'};
}
export function validateTargetConnection(target,connectionString){
 let url;try{url=new URL(connectionString);}catch{throw new RecoveryRefused('target_connection');}
 need(target.write_authorized===false&&target.project===PROJECT&&target.branch_id!==PARENT&&target.host!==PARENT_HOST&&HOST.test(target.host),'isolated_target_required');
 need(['postgres:','postgresql:'].includes(url.protocol)&&url.hostname===target.host&&url.pathname==='/neondb'&&url.username&&url.password&&!url.hash&&(!url.port||url.port==='5432')&&url.searchParams.getAll('sslmode').length===1&&url.searchParams.get('sslmode')==='verify-full'&&[...url.searchParams.keys()].every(k=>['sslmode','channel_binding'].includes(k))&&url.searchParams.getAll('channel_binding').length<=1&&(!url.searchParams.has('channel_binding')||url.searchParams.get('channel_binding')==='require'),'target_connection');
 return true;
}
export function sequenceWriteEvidence(plan,target,baseline,evidence){
 validatePlan(plan);need(target.operation_id===plan.binding.operation_id&&target.plan_sha256===plan.plan_sha256&&target.branch_id!==PARENT&&target.host!==PARENT_HOST&&target.write_authorized===false,'sequence_target_binding');
 need(Array.isArray(baseline)&&Array.isArray(evidence)&&baseline.length===evidence.length,'sequence_coverage');
 const names=new Set();
 for(const seq of baseline){
  const row=evidence.find(v=>v.sequence===seq.sequence);
  need(row&&!names.has(row.sequence),'sequence_coverage');names.add(row.sequence);
  need(row.operation_id===target.operation_id&&row.endpoint_id===target.endpoint_id&&row.branch_id===target.branch_id&&row.application_write===true&&row.fresh_connection_read===true&&row.collision===false&&row.options_sha256===seq.options_sha256,'sequence_write_identity');
  need(Array.isArray(row.generated_ids)&&row.generated_ids.length>0&&new Set(row.generated_ids).size===row.generated_ids.length&&row.generated_ids.every(v=>typeof v==='string'&&/^-?\d+$/.test(v)),'sequence_ids');
  const increasing=BigInt(seq.increment)>0n,high=seq.high_water===null?null:BigInt(seq.high_water);
  need(row.generated_ids.every(id=>high===null||(increasing?BigInt(id)>high:BigInt(id)<high)),'sequence_collision_highwater');
  reference(row.observation);
 }
 return {validated:true,status:'NOT RUN',scope:'supplied_evidence_consistency_only',writes_executed:false};
}
export function cleanupReconciliation(plan,journal,receipt){
 checkJournal(journal,plan);need(object(receipt)&&Array.isArray(receipt.absent)&&Array.isArray(receipt.preserved)&&Array.isArray(receipt.before_endpoints),'cleanup_receipt');
 const resources=journal.events.filter(e=>e.status==='resource-recorded').map(e=>e.resource);
 const missing=resources.filter(r=>!receipt.absent.some(v=>v.type===r.type&&v.id===r.id));
 const originals=receipt.before_endpoints.filter(e=>!receipt.preserved.some(v=>same(v,e)));
 return {status:missing.length||originals.length?'BLOCKED':'NOT RUN',scope:'supplied_cleanup_observation_consistency_only',unresolved_resources:missing,original_endpoints_not_confirmed:originals,created_resource_ids_retained:resources,provider_absence_executed:false};
}



