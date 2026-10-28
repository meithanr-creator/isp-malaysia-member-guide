import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {planAcceptanceContinuation,validateContinuationManifest,verifyContinuationCheckpoint,continuationDigest,sha256,CURRENT_CHECK_IDS,DEPENDENCY_KEYS} from './acceptance-continuation.mjs';
const actual=JSON.parse(readFileSync(new URL('../audit/staging-2/acceptance-closure-ledger.json',import.meta.url),'utf8'));
const clone=structuredClone,H=label=>sha256(Buffer.from(label));
const now=Date.parse('2026-10-27T04:02:00Z');
function fixture(){
 const artifacts=new Map();let next=0;
 const put=(value,label='artifact',raw=false)=>{const bytes=raw?Buffer.from(value):Buffer.from(JSON.stringify(value));const ref={ref:label+'-'+(++next)+'.json',sha256:sha256(bytes),length:bytes.length};artifacts.set(ref.ref,bytes);return ref;};
 const read=async ref=>{if(!artifacts.has(ref))throw Error('missing private artifact');return artifacts.get(ref);};
 const get=ref=>JSON.parse(artifacts.get(ref.ref).toString('utf8'));
 const refs={rows:put([{id:1,value:'synthetic'}],'rows'),schema:put('CREATE TABLE synthetic (id bigint PRIMARY KEY);','schema',true),sequences:put({complete:true,items:[{sequence:'public.synthetic_id_seq',table:'public.synthetic',column:'id',owner:'staging_owner',default:'nextval(synthetic_id_seq)',increment:'1',minimum:'1',maximum:'9223372036854775807',cache:'1',last_value:'1',is_called:true,cycle:false,high_water:'1'}]},'sequences'),ownership:put({complete:true,tables:[{name:'public.synthetic',owner:'staging_owner'}],sequence_count:1},'ownership'),metadata:put({content_type:'application/pdf',cache_control:'private,no-store',custom:{scan:'clean'}},'metadata'),bytes:put('synthetic object bytes','bytes',true),ids:put({complete:true,groups:{members:['member1'],objects:['object1']}},'ids')};
 const database=put({complete:true,tables:[{name:'public.synthetic',row_count:1,raw:refs.rows}]},'database');
 const item={id:'object1',key_sha256:H('private-key'),owner_ids:['member1'],state:'present',length:refs.bytes.length,bytes:refs.bytes,metadata:refs.metadata};
 const inventory=put({complete:true,items:[{id:item.id,key_sha256:item.key_sha256,state:item.state}]},'inventory');
 const state={complete:true,database,schema:refs.schema,sequences:refs.sequences,ownership:refs.ownership,object_inventory:inventory,objects:[item],fixture_ids:refs.ids};
 const identity=r=>({sha256:r.sha256,length:r.length});
 const checkpointHash=continuationDigest({database:identity(database),tables:[{name:'public.synthetic',row_count:1,raw:identity(refs.rows)}],schema:identity(refs.schema),sequences:identity(refs.sequences),ownership:identity(refs.ownership),object_inventory:identity(inventory),objects:[{id:item.id,key_sha256:item.key_sha256,owner_ids:item.owner_ids,state:item.state,length:item.length,bytes:identity(item.bytes),metadata:identity(item.metadata)}],fixture_ids:identity(refs.ids)});
 const deps=Object.fromEntries(DEPENDENCY_KEYS.map(k=>[k,H(k)]));Object.assign(deps,{application_source:'a'.repeat(40),image_digest:'sha256:'+H('image'),checkpoint_sha256:checkpointHash,schema_sha256:refs.schema.sha256,fixture_ids_sha256:refs.ids.sha256});
 const current={run_id:'fresh-run',lease_id:'fresh-lease',resource_id:'fresh-resource',deployment_id:'fresh-deployment',dependencies:deps};
 const seal=put({version:1,kind:'quiescent_acceptance_checkpoint',run_id:'original-run',lease_id:'original-lease',captured_at:'2026-10-27T03:00:00Z',quiescent:true,state},'seal');
 const observation=put({version:1,kind:'acceptance_checkpoint_observation',run_id:current.run_id,lease_id:current.lease_id,seal_sha256:seal.sha256,captured_at:'2026-10-27T04:00:00Z',quiescent:true,before_fresh_login:true,sessions_created:0,state:clone(state)},'observation');
 const tuple=Object.fromEntries(['run_id','lease_id','resource_id','deployment_id'].map(k=>[k,current[k]]));
 const checks=CURRENT_CHECK_IDS.map(id=>({id,status:'PASS',evidence:put({kind:'current_acceptance_check',id,status:'PASS',...tuple,observed_at:'2026-10-27T04:01:10Z'},'check-'+id)}));
 const checksRef=put({version:1,kind:'current_acceptance_checks',...tuple,started_at:'2026-10-27T04:01:00Z',session_creation_started_at:'2026-10-27T04:01:01Z',finished_at:'2026-10-27T04:01:30Z',fresh_sessions:true,old_cookies_reused:false,old_runtime_reused:false,session_origin:'new_contexts',checks},'checks');
 const ledger=clone(actual);for(const row of ledger.cases){row.status=row.id==='sender_lost_mfa'?'owner_dependency':'not_run';row.assertions=[];row.evidence=[];delete row.execution;}
 const manifest={version:1,kind:'acceptance_continuation',ledger_sha256:continuationDigest(ledger),current,window_kind:'functional',checkpoint:{seal,observation},current_checks:checksRef,cases:ledger.cases.map(row=>({id:row.id,contract_sha256:H('contract:'+row.id),dependencies:[...DEPENDENCY_KEYS],not_applicable:{},mutation:'none',mutation_state:'not_started',pending:{strategy:'read_only_reconciliation'}}))};
 const refresh=()=>{manifest.ledger_sha256=continuationDigest(ledger);};
 const pass=(id,declared=[...DEPENDENCY_KEYS])=>{
  const row=ledger.cases.find(r=>r.id===id),mapping=manifest.cases.find(r=>r.id===id);mapping.dependencies=declared;mapping.not_applicable=Object.fromEntries(DEPENDENCY_KEYS.filter(k=>!declared.includes(k)).map(k=>[k,'Synthetic reviewed case scope excludes this dependency.']));row.status='PASS';row.assertions=['Actual hosted assertion and persisted state matched'];row.execution={kind:'actual_hosted',run_id:'original-run',lease_id:'original-lease'};
  const source={version:1,kind:'acceptance_run',run_id:'original-run',lease_id:'original-lease',resource_id:'original-resource',deployment_id:'original-deployment',dependencies:clone(deps)};row.run_evidence=put(source,'source-run');
  row.result_evidence=put({version:1,kind:'hosted_case_result',execution:'actual_hosted',case_id:id,status:'PASS',run_id:source.run_id,lease_id:source.lease_id,contract_sha256:mapping.contract_sha256,declared_dependencies:mapping.dependencies,not_applicable:mapping.not_applicable,assertions:row.assertions,dependencies:source.dependencies,finished_at:'2026-10-27T02:50:00Z'},'result');
  row.reconciliation_evidence=put({version:1,kind:'independent_case_reconciliation',case_id:id,status:'PASS',independent:true,run_id:source.run_id,lease_id:source.lease_id,result_sha256:row.result_evidence.sha256,checkpoint_sha256:deps.checkpoint_sha256,fixture_ids_sha256:deps.fixture_ids_sha256,observed_at:'2026-10-27T02:51:00Z'},'reconciliation');refresh();return row;
 };
 const options=()=>({ledger,manifest,readArtifact:read,providerAdmission:Object.freeze({opaque:'test-authority-only'}),verifyProviderAdmission:async()=>true,now});
 return {artifacts,put,get,read,refs,state,ledger,manifest,current,pass,refresh,options};
}
const caseRow=(plan,id)=>plan.cases.find(r=>r.id===id);
const rowId='event_draft',otherId='publication_draft';
async function editedObservation(f,edit){const receipt=f.get(f.manifest.checkpoint.observation);await edit(receipt);f.manifest.checkpoint.observation=f.put(receipt,'edited-observation');}
test('actual unchanged ledger has zero PASS and all 63 IDs remain pending',async()=>{
 const before=JSON.stringify(actual),p=await planAcceptanceContinuation({ledger:actual,now});
 assert.equal(actual.cases.filter(r=>String(r.status).toUpperCase()==='PASS').length,0);assert.equal(p.actual_existing_pass_count,0);assert.equal(p.carried_pass_count,0);assert.equal(p.newly_executed_pass_count,0);assert.deepEqual(p.pending_ids,actual.cases.map(r=>r.id));assert.equal(p.execution_authority,false);assert.equal(p.provider_requests,0);assert.equal(p.credentials_read,false);assert.equal(JSON.stringify(actual),before);assert.ok(p.blockers.includes('continuation_manifest_unavailable'));
});
test('complete supplied checkpoint verifies while the planner preserves open cases and fixed gaps',async()=>{
 const f=fixture(),p=await planAcceptanceContinuation(f.options());assert.equal(p.checkpoint.verified,true);assert.equal(p.current_checks.verified,true);assert.equal(p.provider_policy_admission_verified,true);assert.equal(p.pending_ids.length,63);assert.equal(p.execution_authority,false);assert.ok(caseRow(p,'restore_rollback').blockers.includes('full_restore_adapter_unavailable'));assert.ok(caseRow(p,'sender_lost_mfa').blockers.includes('owner_dependency_outside_private_window'));
});
test('only actual reconciled historical PASS carries, with provenance and no new execution',async()=>{
 const f=fixture();f.pass(rowId);f.pass(otherId);const before=JSON.stringify(f.ledger),p=await planAcceptanceContinuation(f.options());assert.equal(p.carried_pass_count,2);assert.equal(p.pending_ids.length,61);assert.equal(p.newly_executed_pass_count,0);const row=caseRow(p,rowId);assert.equal(row.status,'PASS_CARRIED');assert.equal(row.label,'PASS carried from original-run');assert.equal(row.carry.source_lease_id,'original-lease');assert.equal(row.carry.current_run_id,'fresh-run');assert.equal(row.carry.newly_executed,false);assert.equal(JSON.stringify(f.ledger),before);
});
test('a changed declared dependency reopens only affected cases',async()=>{
 const f=fixture();f.pass(rowId,['application_source','services_sha256']);f.pass(otherId,['application_source','scanner_sha256']);f.current.dependencies.services_sha256=H('changed-service');const p=await planAcceptanceContinuation(f.options());assert.ok(caseRow(p,rowId).blockers.includes('declared_dependencies_changed:services_sha256'));assert.equal(caseRow(p,otherId).status,'PASS_CARRIED');assert.equal(p.carried_pass_count,1);assert.ok(p.pending_ids.includes(rowId));assert.ok(!p.pending_ids.includes(otherId));
});
test('a continuation cannot silently omit a historical declared dependency',async()=>{
 const f=fixture();f.pass(rowId);const m=f.manifest.cases.find(r=>r.id===rowId);m.dependencies=m.dependencies.filter(k=>k!=='services_sha256');m.not_applicable={services_sha256:'Synthetic continuation attempts to omit a historical dependency.'};f.current.dependencies.services_sha256=H('changed');const p=await planAcceptanceContinuation(f.options());assert.equal(p.carried_pass_count,0);assert.ok(caseRow(p,rowId).blockers.includes('actual_case_result_binding_mismatch'));
});
test('missing or duplicate mappings fail closed across the authoritative inventory',async()=>{
 for(const change of [m=>m.cases.pop(),m=>m.cases[0].id=m.cases[1].id]){const f=fixture();f.pass(rowId);change(f.manifest);const p=await planAcceptanceContinuation(f.options());assert.equal(p.carried_pass_count,0);assert.equal(p.pending_ids.length,63);assert.ok(p.blockers.includes('complete_case_mapping_required'));}
});
test('ledger binding, complete identity vector and reviewed case contract are required',()=>{
 for(const change of [f=>f.manifest.ledger_sha256=H('wrong'),f=>delete f.current.dependencies.seed_identity_sha256,f=>delete f.current.run_id,f=>delete f.current.resource_id,f=>f.manifest.cases[0].contract_sha256='unreviewed',f=>f.manifest.cases[0].dependencies=[],f=>delete f.manifest.cases[0].not_applicable]){const f=fixture();change(f);assert.throws(()=>validateContinuationManifest(f.manifest,f.ledger));}
});
test('missing, tampered and wrong-length evidence cannot carry PASS',async()=>{
 for(const change of [(f,r)=>f.artifacts.delete(r.result_evidence.ref),(f,r)=>f.artifacts.set(r.result_evidence.ref,Buffer.alloc(r.result_evidence.length,88)),(f,r)=>r.result_evidence.length++]){const f=fixture(),r=f.pass(rowId);change(f,r);f.refresh();const p=await planAcceptanceContinuation(f.options());assert.equal(p.carried_pass_count,0);assert.ok(p.pending_ids.includes(rowId));assert.ok(caseRow(p,rowId).blockers.length>0);}
});
test('simulated result, wrong case and unconfirmed reconciliation cannot become actual PASS',async()=>{
 for(const change of [(f,r)=>{const x=f.get(r.result_evidence);x.execution='simulation';r.result_evidence=f.put(x);},(f,r)=>{const x=f.get(r.result_evidence);x.case_id=otherId;r.result_evidence=f.put(x);},(f,r)=>{const x=f.get(r.reconciliation_evidence);x.independent=false;r.reconciliation_evidence=f.put(x);}]){const f=fixture(),r=f.pass(rowId);change(f,r);f.refresh();const p=await planAcceptanceContinuation(f.options());assert.equal(p.carried_pass_count,0);assert.ok(caseRow(p,rowId).blockers.length>0);}
});
test('checkpoint is mandatory before any fresh session changes',async()=>{
 for(const change of [x=>x.before_fresh_login=false,x=>x.sessions_created=1,x=>x.quiescent=false]){const f=fixture();f.pass(rowId);await editedObservation(f,change);const p=await planAcceptanceContinuation(f.options());assert.equal(p.carried_pass_count,0);assert.equal(p.checkpoint.verified,false);assert.equal(p.current_checks.verified,false);assert.ok(p.blockers.includes('checkpoint_must_precede_fresh_login'));}
});
test('changed complete database rows after a login fail checkpoint comparison',async()=>{
 const f=fixture();await editedObservation(f,x=>{const db=f.get(x.state.database);db.tables[0].raw=f.put([{id:1,value:'changed by fresh session'}]);x.state.database=f.put(db);});await assert.rejects(()=>verifyContinuationCheckpoint(f.manifest.checkpoint,f.current,f.read),/checkpoint_complete_state_mismatch/);
});
test('sequence values, ownership, IDs and object metadata are exact checkpoint dependencies',async()=>{
 for(const component of ['sequences','ownership','fixture_ids','metadata']){const f=fixture();await editedObservation(f,x=>{if(component==='metadata'){x.state.objects[0].metadata=f.put({content_type:'application/pdf',custom:{changed:true}});return;}const v=f.get(x.state[component]);if(component==='sequences')v.items[0].last_value='2';if(component==='ownership')v.tables[0].owner='other';if(component==='fixture_ids')v.groups.members=['member2'];x.state[component]=f.put(v);});await assert.rejects(()=>verifyContinuationCheckpoint(f.manifest.checkpoint,f.current,f.read),/checkpoint_complete_state_mismatch/);}
});
test('missing historical run identity and table owner fail closed',async()=>{
 const f=fixture(),r=f.pass(rowId),s=f.get(r.run_evidence);delete s.resource_id;r.run_evidence=f.put(s);f.refresh();const p=await planAcceptanceContinuation(f.options());assert.equal(p.carried_pass_count,0);assert.ok(caseRow(p,rowId).blockers.includes('run_identity_required'));const g=fixture();await editedObservation(g,x=>{const o=g.get(x.state.ownership);delete o.tables[0].owner;x.state.ownership=g.put(o);});await assert.rejects(()=>verifyContinuationCheckpoint(g.manifest.checkpoint,g.current,g.read),/complete_ownership_required/);
});
test('object bytes, lengths and full inventory must verify, including raw hashes',async()=>{
 for(const change of [(f,x)=>f.artifacts.set(x.state.objects[0].bytes.ref,Buffer.alloc(x.state.objects[0].bytes.length,88)),(f,x)=>x.state.objects[0].length++,(f,x)=>x.state.object_inventory=f.put({complete:true,items:[]})]){const f=fixture();await editedObservation(f,x=>change(f,x));await assert.rejects(()=>verifyContinuationCheckpoint(f.manifest.checkpoint,f.current,f.read));}
});
test('omitted raw rows and incomplete sequence ownership cannot verify',async()=>{
 for(const change of [(f,x)=>{const db=f.get(x.state.database);db.tables[0].raw=f.put([]);x.state.database=f.put(db);},(f,x)=>{const s=f.get(x.state.sequences);delete s.items[0].default;x.state.sequences=f.put(s);}]){const f=fixture();await editedObservation(f,x=>change(f,x));await assert.rejects(()=>verifyContinuationCheckpoint(f.manifest.checkpoint,f.current,f.read));}
});
test('current deployment, gate, logins, storage and scanner checks cannot be carried',async()=>{
 for(const change of [x=>x.old_cookies_reused=true,x=>x.old_runtime_reused=true,x=>x.checks.pop(),x=>x.deployment_id='old-deployment',x=>x.started_at='2026-10-27T03:59:59Z',x=>x.finished_at='2026-10-27T04:00:30Z']){const f=fixture(),x=f.get(f.manifest.current_checks);change(x);f.manifest.current_checks=f.put(x);const p=await planAcceptanceContinuation(f.options());assert.equal(p.current_checks.verified,false);assert.ok(p.blockers.length>0);assert.equal(p.execution_authority,false);}
 const f=fixture(),p=await planAcceptanceContinuation({...f.options(),now:now+60001});assert.equal(p.current_checks.verified,false);
});
test('manifest booleans never substitute for the provider policy verifier',async()=>{
 const f=fixture();f.manifest.provider_admitted=true;let p=await planAcceptanceContinuation({...f.options(),verifyProviderAdmission:undefined,providerAdmission:true});assert.equal(p.provider_policy_admission_verified,false);assert.ok(p.blockers.includes('provider_policy_admission_unavailable'));
 p=await planAcceptanceContinuation({...f.options(),verifyProviderAdmission:async()=>({allowed:true})});assert.equal(p.provider_policy_admission_verified,false);assert.ok(p.blockers.includes('provider_policy_admission_refused'));
});
test('unknown mutations may only be planned for read-only reconciliation without authority',async()=>{
 const f=fixture(),m=f.manifest.cases.find(r=>r.id===rowId);m.mutation='write';m.mutation_state='unknown';m.pending={strategy:'read_only_reconciliation'};const p=await planAcceptanceContinuation(f.options());assert.equal(caseRow(p,rowId).pending.strategy,'read_only_reconciliation');assert.equal(caseRow(p,rowId).pending.mutation_authorized,false);assert.equal(p.execution_authority,false);
});
test('reviewed continuation binds one reconciled operation and refuses batch replay',async()=>{
 for(const replay of [false,true]){const f=fixture(),m=f.manifest.cases.find(r=>r.id===rowId);m.mutation='write';m.mutation_state='pending';const decision=H('exact-reviewed-decision'),observation=f.put({operation_id:'old-operation',status:'RECONCILED',independent:true,resume_evidence_sha256:decision});m.pending={strategy:'reviewed_resume',evidence:f.put({version:1,kind:'reviewed_exact_operation_resume',case_id:rowId,current_run_id:f.current.run_id,current_lease_id:f.current.lease_id,original_evidence_preserved:true,no_replay:true,prior_operation_id:'old-operation',next_step:'Read the exact completed object and reconcile its ownership',batch_replay:replay,decision_sha256:decision,independent_reconciliation:observation})};const p=await planAcceptanceContinuation(f.options());if(replay)assert.ok(caseRow(p,rowId).blockers.includes('reviewed_exact_resume_required'));else{assert.equal(caseRow(p,rowId).status,'PENDING');assert.equal(caseRow(p,rowId).pending.mutation_authorized,false);}}
});
test('new fixtures require non-overlap and preserve the old uncertain evidence',async()=>{
 for(const overlap of [false,true]){const f=fixture(),m=f.manifest.cases.find(r=>r.id===rowId);m.mutation='write';m.mutation_state='unknown';m.pending={strategy:'isolated_new_fixture',evidence:f.put({version:1,kind:'isolated_new_fixture_plan',case_id:rowId,current_run_id:f.current.run_id,current_lease_id:f.current.lease_id,original_evidence_preserved:true,no_overlap:!overlap,old_fixture_ids_sha256:H('old-fixtures'),new_fixture_ids_sha256:f.current.dependencies.fixture_ids_sha256})};const p=await planAcceptanceContinuation(f.options());if(overlap)assert.ok(caseRow(p,rowId).blockers.includes('isolated_new_fixture_required'));else assert.equal(caseRow(p,rowId).pending.mutation_authorized,false);}
});
test('recovery/fault cases require their own window; missing full restore adapter stays BLOCKED',async()=>{
 const f=fixture();let p=await planAcceptanceContinuation(f.options());assert.ok(caseRow(p,'scanner_eicar_outage_integrity').blockers.includes('separate_recovery_fault_window_required'));f.manifest.window_kind='recovery_fault';p=await planAcceptanceContinuation(f.options());assert.ok(!caseRow(p,'scanner_eicar_outage_integrity').blockers.includes('separate_recovery_fault_window_required'));assert.ok(caseRow(p,'restore_rollback').blockers.includes('full_restore_adapter_unavailable'));assert.equal(p.full_restore_adapter_available,false);assert.equal(p.execution_authority,false);
});
test('untrusted artifact paths and non-byte artifact readers fail closed',async()=>{
 for(const reference of [{ref:'../escape.json',sha256:H('x'),length:1},{ref:'D:/private.json',sha256:H('x'),length:1}]){const f=fixture();f.manifest.checkpoint.seal=reference;const p=await planAcceptanceContinuation(f.options());assert.equal(p.checkpoint.verified,false);assert.ok(p.blockers.includes('invalid_artifact_reference'));}
 const f=fixture(),p=await planAcceptanceContinuation({...f.options(),readArtifact:async()=>({status:'PASS'})});assert.equal(p.checkpoint.verified,false);assert.ok(p.blockers.includes('raw_artifact_bytes_required'));
});
test('CLI default plan is offline, contains every actual pending ID and refuses execution arguments',()=>{
 const file=fileURLToPath(new URL('./acceptance-continuation.mjs',import.meta.url));const r=spawnSync(process.execPath,[file,'--plan'],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(r.status,0,r.stderr);const p=JSON.parse(r.stdout);assert.equal(p.actual_existing_pass_count,0);assert.equal(p.carried_pass_count,0);assert.deepEqual(p.pending_ids,actual.cases.map(r=>r.id));assert.equal(p.execution_authority,false);assert.equal(p.provider_requests,0);assert.equal(p.credentials_read,false);
 const refused=spawnSync(process.execPath,[file,'--execute'],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(refused.status,1);assert.match(refused.stderr,/only_read_only_plan_supported/);
});

test('prior PASS stays pending when any current check or active provider admission fails',async()=>{
 for(const failure of ['fresh_check','provider_refused','provider_missing','checkpoint_missing']){
  const f=fixture();f.pass(rowId);const options=f.options();
  if(failure==='fresh_check'){const x=f.get(f.manifest.current_checks);x.checks.find(c=>c.id==='member_login').status='FAIL';f.manifest.current_checks=f.put(x);}
  if(failure==='provider_refused')options.verifyProviderAdmission=async()=>false;
  if(failure==='provider_missing')options.verifyProviderAdmission=undefined;
  if(failure==='checkpoint_missing')delete f.manifest.checkpoint;
  const p=await planAcceptanceContinuation(options),r=caseRow(p,rowId);
  assert.equal(p.status,'BLOCKED');assert.equal(p.carried_pass_count,0);assert.equal(p.carry_provenance.length,0);assert.ok(p.pending_ids.includes(rowId));assert.equal(r.status,'BLOCKED');assert.equal(r.carry,undefined);assert.equal(r.historical_evidence.newly_executed,false);assert.equal(p.newly_executed_pass_count,0);
  if(failure!=='checkpoint_missing'){assert.equal(r.historical_evidence.verified,true);assert.equal(r.historical_evidence.disposition,'VERIFIED_HISTORICAL_ONLY');assert.ok(r.blockers.includes('current_checks_and_active_provider_admission_required_for_carry'));}
 }
});
test('carry checkpoint must belong to the original run and lease and follow its reconciliation',async()=>{
 for(const patch of [{run_id:'unrelated-run'},{lease_id:'unrelated-lease'},{captured_at:'2026-10-27T02:49:00Z'},{captured_at:'2026-10-27T02:50:30Z'}]){
  const f=fixture();f.pass(rowId);const seal={...f.get(f.manifest.checkpoint.seal),...patch};f.manifest.checkpoint.seal=f.put(seal,'different-seal');const observation=f.get(f.manifest.checkpoint.observation);observation.seal_sha256=f.manifest.checkpoint.seal.sha256;f.manifest.checkpoint.observation=f.put(observation,'bound-observation');
  const p=await planAcceptanceContinuation(f.options());assert.equal(p.checkpoint.verified,true);assert.equal(p.carried_pass_count,0);assert.ok(p.pending_ids.includes(rowId));assert.ok(caseRow(p,rowId).blockers.includes('post_run_checkpoint_source_binding_required'));
 }
 const f=fixture();f.pass(rowId);const p=await planAcceptanceContinuation(f.options()),r=caseRow(p,rowId);assert.equal(r.status,'PASS_CARRIED');assert.equal(r.carry.checkpoint_source_run_id,'original-run');assert.equal(r.carry.checkpoint_source_lease_id,'original-lease');assert.equal(r.carry.checkpoint_captured_at,'2026-10-27T03:00:00Z');
});
test('opaque provider adapter receives active-continuation purpose and exact current proof hashes',async()=>{
 const f=fixture();f.pass(rowId);let seen;const p=await planAcceptanceContinuation({...f.options(),verifyProviderAdmission:async(proof,context)=>{seen=context;return true;}});
 assert.equal(seen.purpose,'active_acceptance_continuation');assert.equal(seen.checkpoint_observation_sha256,f.manifest.checkpoint.observation.sha256);assert.equal(seen.current_checks_sha256,f.manifest.current_checks.sha256);assert.equal(seen.lease_id,f.current.lease_id);assert.equal(seen.resource_id,f.current.resource_id);assert.equal(seen.deployment_id,f.current.deployment_id);assert.equal(seen.now,now);assert.equal(p.carried_pass_count,1);assert.equal(p.execution_authority,false);
});
