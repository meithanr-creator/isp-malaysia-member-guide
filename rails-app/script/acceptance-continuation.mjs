// Read-only planning. Importing this module performs no I/O.
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export const DEPENDENCY_KEYS=Object.freeze(['application_source','image_digest','worker_behavior_sha256','configuration_sha256','schema_sha256','historical_key_identity_sha256','seed_identity_sha256','services_sha256','scanner_sha256','checkpoint_sha256','fixture_ids_sha256']);
export const CURRENT_CHECK_IDS=Object.freeze(['deployment','private_gate','member_login','admin_mfa_login','storage','scanner']);
export const FULL_RESTORE_ADAPTER_AVAILABLE=false;
const LIMITS={cases:63,artifacts:4096,artifactBytes:32*1024*1024,totalBytes:256*1024*1024};
const LATER_WINDOW=new Set(['restore_rollback','scanner_eicar_outage_integrity','dependency_host_proxy_failures','runtime_memory_overlap']);
const HEX=/^[a-f0-9]{64}$/,COMMIT=/^[a-f0-9]{40}$/,ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const identifier=value=>typeof value==='string'&&ID.test(value);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export class ContinuationRefused extends Error{constructor(code){super('Continuation evidence refused: '+code);this.code=code;}}
function need(ok,code){if(!ok)throw new ContinuationRefused(code);}
export function canonical(value){
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(object(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 need(value===null||['string','boolean'].includes(typeof value)||(typeof value==='number'&&Number.isFinite(value)),'invalid_json_value');return JSON.stringify(value);
}
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export const continuationDigest=value=>sha256(canonical(value));
const same=(a,b)=>canonical(a)===canonical(b);
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):NaN;
function reference(value){
 need(object(value)&&Object.keys(value).length===3&&typeof value.ref==='string'&&/^[A-Za-z0-9][A-Za-z0-9_./-]{0,239}$/.test(value.ref)&&value.ref.split('/').every(p=>p!=='.'&&p!=='..'&&p!=='')&&HEX.test(value.sha256)&&Number.isSafeInteger(value.length)&&value.length>=0&&value.length<=LIMITS.artifactBytes,'invalid_artifact_reference');return value;
}
function dependencies(value){
 need(object(value)&&Object.keys(value).length===DEPENDENCY_KEYS.length&&DEPENDENCY_KEYS.every(k=>Object.hasOwn(value,k)),'complete_dependency_vector_required');
 for(const k of DEPENDENCY_KEYS)need(k==='application_source'?COMMIT.test(value[k]):k==='image_digest'?/^sha256:[a-f0-9]{64}$/.test(value[k]):HEX.test(value[k]),'invalid_dependency_identity');
}
function run(value){need(object(value)&&identifier(value.run_id)&&identifier(value.lease_id)&&identifier(value.resource_id)&&identifier(value.deployment_id),'run_identity_required');dependencies(value.dependencies);}
function ledgerRows(ledger){
 need(ledger?.version===1&&Array.isArray(ledger.cases)&&ledger.cases.length===LIMITS.cases,'exact_63_case_ledger_required');
 const ids=ledger.cases.map(r=>r?.id);need(ids.every(id=>typeof id==='string'&&/^[a-z][a-z0-9_]{0,100}$/.test(id))&&new Set(ids).size===ids.length,'unique_case_ids_required');
 for(const row of ledger.cases)need(['PASS','FAIL','BLOCKED','NOT RUN','NOT_RUN','OWNER_DEPENDENCY'].includes(String(row.status).toUpperCase()),'unsupported_ledger_status');return ledger.cases;
}
export function validateContinuationManifest(manifest,ledger){
 const rows=ledgerRows(ledger);need(manifest?.version===1&&manifest.kind==='acceptance_continuation'&&manifest.ledger_sha256===continuationDigest(ledger),'manifest_ledger_binding_required');run(manifest.current);
 need(['functional','recovery_fault'].includes(manifest.window_kind),'separately_sealed_window_kind_required');
 need(Array.isArray(manifest.cases)&&manifest.cases.length===rows.length&&new Set(manifest.cases.map(r=>r?.id)).size===rows.length&&rows.every(r=>manifest.cases.some(m=>m?.id===r.id)),'complete_case_mapping_required');
 for(const m of manifest.cases){
  need(Array.isArray(m.dependencies)&&m.dependencies.length>0&&new Set(m.dependencies).size===m.dependencies.length&&m.dependencies.every(k=>DEPENDENCY_KEYS.includes(k))&&HEX.test(m.contract_sha256),'reviewed_case_dependencies_required');
  const omitted=DEPENDENCY_KEYS.filter(k=>!m.dependencies.includes(k));
  need(object(m.not_applicable)&&Object.keys(m.not_applicable).length===omitted.length&&omitted.every(k=>typeof m.not_applicable[k]==='string'&&m.not_applicable[k].length>=20&&m.not_applicable[k].length<=240),'complete_dependency_applicability_required');
  need(['none','write'].includes(m.mutation)&&['not_started','completed','pending','unknown'].includes(m.mutation_state),'explicit_mutation_state_required');
  need(object(m.pending)&&['read_only_reconciliation','reviewed_resume','isolated_new_fixture'].includes(m.pending.strategy),'explicit_pending_strategy_required');if(m.pending.evidence!==undefined)reference(m.pending.evidence);
 }return manifest;
}
function artifactReader(readArtifact){
 const cache=new Map();let bytesRead=0;
 return async function read(ref,json=true){
  reference(ref);const key=ref.ref+'|'+ref.sha256+'|'+ref.length;
  if(!cache.has(key)){
   need(typeof readArtifact==='function','artifact_reader_unavailable');need(cache.size<LIMITS.artifacts,'artifact_count_bound');
   const promise=(async()=>{let bytes;try{bytes=await readArtifact(ref.ref);}catch{throw new ContinuationRefused('artifact_unavailable');}
    need(bytes instanceof Uint8Array,'raw_artifact_bytes_required');bytes=Buffer.from(bytes);bytesRead+=bytes.length;
    need(bytes.length===ref.length&&bytes.length<=LIMITS.artifactBytes&&bytesRead<=LIMITS.totalBytes,'artifact_length_or_budget_mismatch');need(sha256(bytes)===ref.sha256,'artifact_hash_mismatch');return bytes;})();cache.set(key,promise);
  }
  const bytes=await cache.get(key);if(!json)return bytes;try{return JSON.parse(bytes.toString('utf8'));}catch{throw new ContinuationRefused('artifact_json_required');}
 };
}
function uniqueNames(items,key,code){need(Array.isArray(items)&&items.length<=1000&&items.every(i=>typeof i?.[key]==='string')&&new Set(items.map(i=>i[key])).size===items.length,code);}
const rawIdentity=ref=>({sha256:ref.sha256,length:ref.length});
async function checkpointState(state,read){
 need(object(state)&&state.complete===true,'complete_checkpoint_state_required');const database=await read(state.database);need(database?.complete===true,'complete_database_inventory_required');uniqueNames(database.tables,'name','complete_table_inventory_required');need(database.tables.length>0,'complete_table_inventory_required');const tables=[];
 for(const t of database.tables){need(/^[a-z_][a-z0-9_.]*$/.test(t.name)&&Number.isSafeInteger(t.row_count)&&t.row_count>=0,'invalid_table_inventory');const rows=await read(t.raw);need(Array.isArray(rows)&&rows.length===t.row_count,'complete_raw_table_rows_required');tables.push({name:t.name,row_count:t.row_count,raw:rawIdentity(t.raw)});}
 await read(state.schema,false);const sequences=await read(state.sequences);need(sequences?.complete===true&&Array.isArray(sequences.items),'complete_sequence_state_required');uniqueNames(sequences.items,'sequence','complete_sequence_state_required');
 for(const s of sequences.items)need(database.tables.some(t=>t.name===s.table)&&typeof s.column==='string'&&typeof s.owner==='string'&&s.owner.length>0&&typeof s.default==='string'&&s.default.length>0&&['increment','minimum','maximum','cache','last_value'].every(k=>typeof s[k]==='string'&&/^-?\d+$/.test(s[k]))&&BigInt(s.increment)!==0n&&BigInt(s.cache)>0n&&typeof s.cycle==='boolean'&&typeof s.is_called==='boolean'&&(s.high_water===null||(typeof s.high_water==='string'&&/^-?\d+$/.test(s.high_water))),'sequence_ownership_options_and_state_required');
 const ownership=await read(state.ownership);need(ownership?.complete===true,'complete_ownership_required');uniqueNames(ownership.tables,'name','complete_ownership_required');
 need(ownership.tables.every(t=>typeof t.owner==='string'&&t.owner.length>0)&&same(ownership.tables.map(t=>t.name).sort(),database.tables.map(t=>t.name).sort())&&ownership.sequence_count===sequences.items.length,'complete_ownership_required');
 uniqueNames(state.objects,'id','complete_object_inventory_required');const inventory=await read(state.object_inventory);need(inventory?.complete===true&&Array.isArray(inventory.items),'complete_object_inventory_required');const objects=[];
 for(const item of state.objects){
  need(identifier(item.id)&&HEX.test(item.key_sha256)&&Array.isArray(item.owner_ids)&&item.owner_ids.length>0&&item.owner_ids.every(id=>identifier(id))&&new Set(item.owner_ids).size===item.owner_ids.length&&['present','absent'].includes(item.state),'object_identity_and_ownership_required');need(object(await read(item.metadata)),'object_metadata_required');
  if(item.state==='present'){need(Number.isSafeInteger(item.length)&&item.length>0,'object_length_required');need((await read(item.bytes,false)).length===item.length,'object_length_mismatch');}else need(item.length===0&&item.bytes===null&&item.absence_observed===true,'explicit_object_absence_required');
  objects.push({id:item.id,key_sha256:item.key_sha256,owner_ids:[...item.owner_ids].sort(),state:item.state,length:item.length,bytes:item.bytes===null?null:rawIdentity(item.bytes),metadata:rawIdentity(item.metadata)});
 }
 const inventoryIds=objects.map(({id,key_sha256,state})=>({id,key_sha256,state})).sort((a,b)=>a.id.localeCompare(b.id));need(same([...inventory.items].sort((a,b)=>String(a.id).localeCompare(String(b.id))),inventoryIds),'object_inventory_coverage_mismatch');
 const fixtureIds=await read(state.fixture_ids);need(fixtureIds?.complete===true&&object(fixtureIds.groups)&&Object.keys(fixtureIds.groups).length>0,'complete_fixture_ids_required');for(const ids of Object.values(fixtureIds.groups))need(Array.isArray(ids)&&ids.every(id=>identifier(id))&&new Set(ids).size===ids.length,'invalid_fixture_ids');
 const identity={database:rawIdentity(state.database),tables:tables.sort((a,b)=>a.name.localeCompare(b.name)),schema:rawIdentity(state.schema),sequences:rawIdentity(state.sequences),ownership:rawIdentity(state.ownership),object_inventory:rawIdentity(state.object_inventory),objects:objects.sort((a,b)=>a.id.localeCompare(b.id)),fixture_ids:rawIdentity(state.fixture_ids)};
 return {sha256:continuationDigest(identity),schema_sha256:state.schema.sha256,fixture_ids_sha256:state.fixture_ids.sha256};
}
export async function verifyContinuationCheckpoint(checkpoint,current,readArtifact){run(current);return verifyCheckpoint(checkpoint,current,artifactReader(readArtifact));}
async function verifyCheckpoint(checkpoint,current,read){
 need(object(checkpoint),'checkpoint_unavailable');const seal=await read(checkpoint.seal),observed=await read(checkpoint.observation);
 need(seal?.version===1&&seal.kind==='quiescent_acceptance_checkpoint'&&identifier(seal.run_id)&&identifier(seal.lease_id)&&seal.quiescent===true&&Number.isFinite(stamp(seal.captured_at)),'quiescent_checkpoint_seal_required');
 need(observed?.version===1&&observed.kind==='acceptance_checkpoint_observation'&&observed.run_id===current.run_id&&observed.lease_id===current.lease_id&&observed.seal_sha256===checkpoint.seal.sha256&&observed.quiescent===true&&observed.before_fresh_login===true&&observed.sessions_created===0&&Number.isFinite(stamp(observed.captured_at))&&stamp(observed.captured_at)>=stamp(seal.captured_at),'checkpoint_must_precede_fresh_login');
 const baseline=await checkpointState(seal.state,read),actual=await checkpointState(observed.state,read);need(same(baseline,actual),'checkpoint_complete_state_mismatch');
 need(current.dependencies.checkpoint_sha256===baseline.sha256&&current.dependencies.schema_sha256===baseline.schema_sha256&&current.dependencies.fixture_ids_sha256===baseline.fixture_ids_sha256,'current_checkpoint_dependency_mismatch');
 return {verified:true,complete_state_sha256:baseline.sha256,captured_at:observed.captured_at,seal_sha256:checkpoint.seal.sha256,seal_run_id:seal.run_id,seal_lease_id:seal.lease_id,seal_captured_at:seal.captured_at,observation_sha256:checkpoint.observation.sha256};
}
async function currentChecks(ref,current,checkpoint,read,now){
 const receipt=await read(ref);need(receipt?.version===1&&receipt.kind==='current_acceptance_checks'&&['run_id','lease_id','resource_id','deployment_id'].every(k=>receipt[k]===current[k])&&receipt.fresh_sessions===true&&receipt.old_cookies_reused===false&&receipt.old_runtime_reused===false&&receipt.session_origin==='new_contexts','fresh_resource_checks_required');
 need(Number.isFinite(stamp(receipt.started_at))&&stamp(receipt.started_at)>stamp(checkpoint.captured_at)&&stamp(receipt.session_creation_started_at)>=stamp(receipt.started_at)&&Number.isFinite(stamp(receipt.finished_at))&&stamp(receipt.finished_at)>=stamp(receipt.session_creation_started_at)&&stamp(receipt.finished_at)<=now&&now-stamp(receipt.finished_at)<=60000,'current_checks_must_follow_checkpoint_and_be_fresh');
 need(Array.isArray(receipt.checks)&&receipt.checks.length===CURRENT_CHECK_IDS.length&&new Set(receipt.checks.map(c=>c.id)).size===CURRENT_CHECK_IDS.length&&CURRENT_CHECK_IDS.every(id=>receipt.checks.some(c=>c.id===id&&c.status==='PASS')),'all_current_checks_required');
 for(const check of receipt.checks){const proof=await read(check.evidence);need(proof?.kind==='current_acceptance_check'&&proof.id===check.id&&proof.status==='PASS'&&['run_id','lease_id','resource_id','deployment_id'].every(k=>proof[k]===current[k])&&stamp(proof.observed_at)>=stamp(receipt.started_at)&&stamp(proof.observed_at)<=stamp(receipt.finished_at),'current_check_evidence_binding');}
 return {verified:true,evidence_sha256:ref.sha256,ids:[...CURRENT_CHECK_IDS]};
}
async function carry(row,mapping,current,checkpoint,read){
 need(row.execution?.kind==='actual_hosted'&&identifier(row.execution.run_id)&&identifier(row.execution.lease_id)&&row.execution.run_id!==current.run_id&&row.execution.lease_id!==current.lease_id&&Array.isArray(row.assertions)&&row.assertions.length>0,'actual_historical_execution_required');
 const source=await read(row.run_evidence);run(source);need(source.version===1&&source.kind==='acceptance_run'&&source.run_id===row.execution.run_id&&source.lease_id===row.execution.lease_id&&source.resource_id!==current.resource_id&&source.deployment_id!==current.deployment_id,'historical_run_binding_mismatch');
 const result=await read(row.result_evidence),reconciliation=await read(row.reconciliation_evidence);
 need(result?.version===1&&result.kind==='hosted_case_result'&&result.execution==='actual_hosted'&&result.case_id===row.id&&result.status==='PASS'&&result.run_id===source.run_id&&result.lease_id===source.lease_id&&result.contract_sha256===mapping.contract_sha256&&same(result.declared_dependencies,mapping.dependencies)&&same(result.not_applicable,mapping.not_applicable)&&same(result.assertions,row.assertions)&&same(result.dependencies,source.dependencies),'actual_case_result_binding_mismatch');
 need(reconciliation?.version===1&&reconciliation.kind==='independent_case_reconciliation'&&reconciliation.case_id===row.id&&reconciliation.status==='PASS'&&reconciliation.independent===true&&reconciliation.run_id===source.run_id&&reconciliation.lease_id===source.lease_id&&reconciliation.result_sha256===row.result_evidence.sha256&&reconciliation.checkpoint_sha256===source.dependencies.checkpoint_sha256&&reconciliation.fixture_ids_sha256===source.dependencies.fixture_ids_sha256&&Number.isFinite(stamp(result.finished_at))&&stamp(reconciliation.observed_at)>=stamp(result.finished_at),'independent_reconciliation_required');
 need(checkpoint?.verified===true,'verified_checkpoint_required_for_carry');
 need(checkpoint.seal_run_id===source.run_id&&checkpoint.seal_lease_id===source.lease_id&&stamp(checkpoint.seal_captured_at)>=stamp(result.finished_at)&&stamp(checkpoint.seal_captured_at)>=stamp(reconciliation.observed_at),'post_run_checkpoint_source_binding_required');
 need(source.dependencies.checkpoint_sha256===checkpoint.complete_state_sha256&&source.dependencies.fixture_ids_sha256===current.dependencies.fixture_ids_sha256,'source_checkpoint_binding_mismatch');
 const changed=mapping.dependencies.filter(k=>source.dependencies[k]!==current.dependencies[k]);need(changed.length===0,'declared_dependencies_changed:'+changed.join(','));
 return {source_run_id:source.run_id,source_lease_id:source.lease_id,current_run_id:current.run_id,source_run_sha256:row.run_evidence.sha256,result_sha256:row.result_evidence.sha256,reconciliation_sha256:row.reconciliation_evidence.sha256,checkpoint_seal_sha256:checkpoint.seal_sha256,checkpoint_source_run_id:checkpoint.seal_run_id,checkpoint_source_lease_id:checkpoint.seal_lease_id,checkpoint_captured_at:checkpoint.seal_captured_at,compared_dependencies:Object.fromEntries(mapping.dependencies.map(k=>[k,current.dependencies[k]])),newly_executed:false};
}
async function pendingStrategy(row,mapping,current,read){
 const strategy=mapping.pending.strategy,uncertain=['pending','unknown'].includes(mapping.mutation_state);
 if(mapping.mutation==='none')need(strategy==='read_only_reconciliation','read_only_case_strategy_required');
 if(strategy==='read_only_reconciliation')return {strategy,mutation_authorized:false};
 need(mapping.mutation==='write','mutation_strategy_scope');const proof=await read(mapping.pending.evidence);
 need(proof?.version===1&&proof.case_id===row.id&&proof.current_run_id===current.run_id&&proof.current_lease_id===current.lease_id&&proof.original_evidence_preserved===true,'pending_strategy_binding_required');
 if(strategy==='reviewed_resume'){
  need(uncertain&&proof.kind==='reviewed_exact_operation_resume'&&proof.no_replay===true&&identifier(proof.prior_operation_id)&&typeof proof.next_step==='string'&&proof.next_step.length>0&&proof.next_step.length<=240&&proof.batch_replay===false,'reviewed_exact_resume_required');const observation=await read(proof.independent_reconciliation);
  need(observation?.operation_id===proof.prior_operation_id&&observation.status==='RECONCILED'&&observation.independent===true&&observation.resume_evidence_sha256===proof.decision_sha256&&HEX.test(proof.decision_sha256),'resume_reconciliation_required');
 }else need(proof.kind==='isolated_new_fixture_plan'&&proof.no_overlap===true&&HEX.test(proof.new_fixture_ids_sha256)&&proof.new_fixture_ids_sha256===current.dependencies.fixture_ids_sha256&&HEX.test(proof.old_fixture_ids_sha256)&&proof.old_fixture_ids_sha256!==proof.new_fixture_ids_sha256,'isolated_new_fixture_required');
 return {strategy,evidence_sha256:mapping.pending.evidence.sha256,mutation_authorized:false,uncertain_prior_mutation:uncertain};
}
function code(error){return error instanceof ContinuationRefused?error.code:'evidence_validation_failed';}
export async function planAcceptanceContinuation({ledger,manifest=null,readArtifact,providerAdmission,verifyProviderAdmission,now=Date.now()}={}){
 const rows=ledgerRows(ledger);need(Number.isSafeInteger(now),'fixed_planning_time_required');const blockers=[],read=artifactReader(readArtifact);let valid=false,checkpoint=null,checks=null,provider=false;
 if(manifest!==null){try{validateContinuationManifest(manifest,ledger);valid=true;}catch(error){blockers.push(code(error));}}else blockers.push('continuation_manifest_unavailable');
 if(valid){
  try{checkpoint=await verifyCheckpoint(manifest.checkpoint,manifest.current,read);}catch(error){blockers.push(code(error));}
  if(checkpoint){try{checks=await currentChecks(manifest.current_checks,manifest.current,checkpoint,read,now);}catch(error){blockers.push(code(error));}}else blockers.push('fresh_login_checks_wait_for_verified_checkpoint');
  try{
   // Only the provider policy's verifier interprets its opaque proof.
   need(typeof verifyProviderAdmission==='function','provider_policy_admission_unavailable');
   provider=await verifyProviderAdmission(providerAdmission,{run_id:manifest.current.run_id,lease_id:manifest.current.lease_id,resource_id:manifest.current.resource_id,deployment_id:manifest.current.deployment_id,purpose:'active_acceptance_continuation',checkpoint_observation_sha256:checkpoint?.observation_sha256??null,current_checks_sha256:checks?.evidence_sha256??null,now})===true;need(provider,'provider_policy_admission_refused');
  }catch(error){blockers.push(code(error));}
 }else blockers.push('provider_policy_admission_unavailable','checkpoint_unavailable','fresh_resource_checks_required');
 const cases=[];
 for(const row of rows){
  const entry={id:row.id,previous_status:String(row.status).toUpperCase(),status:'BLOCKED',newly_executed:false,blockers:[]},mapping=valid?manifest.cases.find(m=>m.id===row.id):null;
  if(entry.previous_status==='PASS')entry.historical_evidence={verified:false,disposition:'HISTORICAL_REFERENCE_ONLY',source_run_id:typeof row.execution?.run_id==='string'?row.execution.run_id:null,source_lease_id:typeof row.execution?.lease_id==='string'?row.execution.lease_id:null,newly_executed:false};
  if(!mapping)entry.blockers.push('case_mapping_unavailable');
  if(entry.previous_status==='OWNER_DEPENDENCY'||row.id==='sender_lost_mfa')entry.blockers.push('owner_dependency_outside_private_window');
  if(row.id==='restore_rollback')entry.blockers.push('full_restore_adapter_unavailable');
  if(mapping&&LATER_WINDOW.has(row.id)&&manifest.window_kind!=='recovery_fault')entry.blockers.push('separate_recovery_fault_window_required');
  if(mapping&&entry.blockers.length===0){
   if(entry.previous_status==='PASS'){try{
    const historical=await carry(row,mapping,manifest.current,checkpoint,read);
    entry.historical_evidence={...historical,verified:true,disposition:'VERIFIED_HISTORICAL_ONLY'};
    need(checkpoint?.verified===true&&checks?.verified===true&&provider===true,'current_checks_and_active_provider_admission_required_for_carry');
    entry.carry=historical;entry.status='PASS_CARRIED';entry.label='PASS carried from '+historical.source_run_id;
   }catch(error){entry.blockers.push(code(error));}}
   if(entry.status!=='PASS_CARRIED'){try{entry.pending=await pendingStrategy(row,mapping,manifest.current,read);}catch(error){entry.blockers.push(code(error));}if(entry.blockers.length===0)entry.status='PENDING';}
  }cases.push(entry);
 }
 const carried=cases.filter(r=>r.status==='PASS_CARRIED');
 return {version:1,kind:'acceptance_continuation_plan',status:blockers.length||cases.some(r=>r.blockers.length)?'BLOCKED':'PLANNED',ledger_sha256:continuationDigest(ledger),inventory_count:rows.length,actual_existing_pass_count:rows.filter(r=>String(r.status).toUpperCase()==='PASS').length,carried_pass_count:carried.length,newly_executed_pass_count:0,pending_ids:cases.filter(r=>r.status!=='PASS_CARRIED').map(r=>r.id),carry_provenance:carried.map(r=>({id:r.id,label:r.label,...r.carry})),blockers:[...new Set(blockers)],checkpoint:checkpoint??{verified:false},current_checks:checks??{verified:false,required_ids:[...CURRENT_CHECK_IDS]},provider_policy_admission_verified:provider,full_restore_adapter_available:FULL_RESTORE_ADAPTER_AVAILABLE,execution_authority:false,provider_requests:0,credentials_read:false,old_cookie_or_runtime_reuse:false,scope:'virtual_browser_only; physical_devices_and_native_installation_outside_accepted_scope',cases};
}
async function main(args){
 // CLI I/O is isolated from the pure API; no environment secrets are read.
 const fs=await import('node:fs/promises'),path=await import('node:path');need(args[0]==='--plan','only_read_only_plan_supported');let manifestPath=null,evidenceRoot=null;
 for(let i=1;i<args.length;i+=2){need(['--manifest','--evidence-root'].includes(args[i])&&typeof args[i+1]==='string','unsupported_plan_argument');if(args[i]==='--manifest'){need(manifestPath===null,'duplicate_plan_argument');manifestPath=args[i+1];}else{need(evidenceRoot===null,'duplicate_plan_argument');evidenceRoot=args[i+1];}}
 const dPath=value=>{need(typeof value==='string'&&/^D:[\\/]/i.test(value),'drive_d_required');return path.resolve(value);};
 const ledgerBytes=await fs.readFile(new URL('../audit/staging-2/acceptance-closure-ledger.json',import.meta.url));need(ledgerBytes.length<=4*1024*1024,'ledger_size_bound');const ledger=JSON.parse(ledgerBytes.toString('utf8'));let manifest=null,reader;
 if(manifestPath!==null){
  const selected=await fs.realpath(dPath(manifestPath));dPath(selected);const stat=await fs.stat(selected);need(stat.isFile()&&stat.size<=4*1024*1024,'manifest_size_bound');const bytes=await fs.readFile(selected);need(bytes.length<=4*1024*1024,'manifest_size_bound');manifest=JSON.parse(bytes.toString('utf8'));const root=await fs.realpath(dPath(evidenceRoot??path.dirname(selected)));dPath(root);
  reader=async ref=>{const selected=await fs.realpath(path.resolve(root,ref));need(/^D:[\\/]/i.test(selected)&&selected.toLowerCase().startsWith((root+path.sep).toLowerCase()),'artifact_outside_selected_d_root');const stat=await fs.stat(selected);need(stat.isFile()&&stat.size<=LIMITS.artifactBytes,'artifact_size_bound');return fs.readFile(selected);};
 }else need(evidenceRoot===null,'manifest_required_for_evidence_root');
 console.log(JSON.stringify(await planAcceptanceContinuation({ledger,manifest,readArtifact:reader}),null,2));
 // BLOCKED is a successfully produced plan, never permission to execute.
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify({status:'BLOCKED',code:code(error),execution_authority:false,provider_requests:0,credentials_read:false}));process.exitCode=1;});
