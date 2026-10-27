import test from 'node:test';
import assert from 'node:assert/strict';
import {PROJECT,PARENT,PARENT_HOST,BUCKET,LEASE,prepareRecovery,sha256,digest,createJournal,appendJournal,validateCreatedTarget,validateTargetConnection,validateObjectManifest,verifyObjectObservation,sequenceWriteEvidence,cleanupReconciliation,validateDeadlines} from './recovery-preflight.mjs';
const start=Date.parse('2026-10-27T01:00:00Z'), now=start+60000;
const operation='12345678-1234-4123-8123-123456789abc';
const evidence={ref:'synthetic/evidence.json',sha256:'c'.repeat(64)};
const window={starts_at:new Date(start).toISOString(),action_deadline:new Date(start+45*60000).toISOString(),cleanup_deadline:new Date(start+54*60000).toISOString(),hard_deadline:new Date(start+55*60000).toISOString(),known_spend_usd:0.25,reserved_usd:0.25,ceiling_usd:5};
const metadata={content_type:'application/pdf',cache_control:'private',content_disposition:null,content_encoding:null,content_language:null,user_metadata:{synthetic:'true'}};
function fixture(){
 const manifestBytes=JSON.stringify({version:1,phase:'active',run_marker:'qa-20261027-abcdefabcdef',target:{project:PROJECT,host:PARENT_HOST,database:'neondb'},actors:{member:{id:17},admin:{id:31}},records:{events:[{id:8}],registry:[{id:12},{id:13},{id:14}],blobs:[{id:4}]}});
 const preparedBytes=JSON.stringify({lease_id:LEASE,activation:false,rails_source:'a'.repeat(40),worker_source:'b'.repeat(40),image_digest:'sha256:'+'d'.repeat(64)});
 const request={version:1,operation_id:operation,lease_id:LEASE,manifest_sha256:sha256(manifestBytes),prepared_release_sha256:sha256(preparedBytes),tooling_source:'e'.repeat(40),configuration_sha256:'f'.repeat(64),window:structuredClone(window),checkpoint:{lsn:'0/1234',captured_at:new Date(now-1000).toISOString(),mutations_paused:true,population:['event_upload','publication_upload','discover_upload','interest','consultation'],reconciliation:evidence,inventory:evidence},object_manifest:null};
 request.object_manifest={version:1,operation_id:operation,lease_id:LEASE,manifest_sha256:request.manifest_sha256,checkpoint_lsn:'0/1234',bucket:BUCKET,objects:[{key:'a'.repeat(28),state:'present',roles:['draft','preview','published','durable_ledger'],ledger_state:'committed',length:4,sha256:sha256('data'),metadata,backup_relative_path:'objects/'+sha256('data')+'.bin',observation:evidence},{key:'b'.repeat(28),state:'absent',roles:['tombstone','durable_ledger'],ledger_state:'tombstone',length:null,sha256:null,metadata:null,backup_relative_path:null,observation:evidence}],historical_key_references:['SECRET_KEY_BASE','ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY','ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY','ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT'].map(purpose=>({purpose,secret_store_ref:'recovery-keyset:synthetic/keyset#'+purpose,sealed_archive:evidence}))};
 const checkpointInventoryBytes=JSON.stringify({version:1,operation_id:operation,lease_id:LEASE,manifest_sha256:request.manifest_sha256,checkpoint_lsn:'0/1234',keys:request.object_manifest.objects.map(o=>({key:o.key,state:o.state,roles:o.roles,ledger_state:o.ledger_state,length:o.length,source_refs:[{kind:'managed_upload',id:'synthetic-ledger',slot:'durable_ledger'}]}))});
 request.checkpoint.inventory={ref:'checkpoint-inventory.json',sha256:sha256(checkpointInventoryBytes)};
 return {request,manifestBytes,preparedBytes,checkpointInventoryBytes,now};
}
function plan(){return prepareRecovery(fixture());}
function created(p){
 let journal=createJournal(p);
 const s={id:'snapshot-synthetic',name:p.resource_name,source_branch_id:PARENT,lsn:p.checkpoint.lsn,created_at:new Date(now).toISOString()};
 // Contract-shaped selected fields from @neon/sdk 7.5.0; synthetic, never live evidence.
 // Snapshot branch has no parent_id, parent_lsn or snapshot_id. primary is optional.
 const b={id:'br-synthetic-restore',project_id:PROJECT,name:p.resource_name,creation_source:'snapshot',default:false,protected:false,current_state:'ready'};
 const e={id:'ep-synthetic-restore',project_id:PROJECT,region_id:'aws-ap-southeast-1',branch_id:b.id,type:'read_write',host:'ep-synthetic-restore.ap-southeast-1.aws.neon.tech',autoscaling_limit_min_cu:0.25,autoscaling_limit_max_cu:0.25,suspend_timeout_seconds:300};
 const request={method:'POST',path:'/projects/'+PROJECT+'/snapshots/'+s.id+'/restore',body:{name:p.resource_name,finalize_restore:false}};
 const op={id:'operation-synthetic',project_id:PROJECT,branch_id:b.id,status:'finished'};
 const response={branch:structuredClone(b),operations:[op]};
 for(const[action,type,value,source_id,host]of [['snapshot-create','snapshot',s,PARENT,null],['branch-restore','branch',b,s.id,null],['endpoint-create','endpoint',e,b.id,e.host]]){
  journal=appendJournal(journal,p,{action,status:'started',resource:null,evidence:action==='branch-restore'?{ref:'synthetic/request.json',sha256:digest(request)}:null},now);
  journal=appendJournal(journal,p,{action,status:'resource-recorded',resource:{type,id:value.id,name:p.resource_name,source_id,host},evidence:action==='branch-restore'?{ref:'synthetic/response.json',sha256:digest(response)}:evidence},now);
 }
 return {journal,receipt:{operation_id:operation,plan_sha256:p.plan_sha256,project:{id:PROJECT,region_id:'aws-ap-southeast-1',pg_version:18},snapshot:s,restore_request:request,restore_response:response,completed_operations:[op],branch:b,endpoint:e,before:{branches:[{id:PARENT,default:true}],endpoints:[{id:'ep-parent',host:PARENT_HOST,branch_id:PARENT}],snapshots:[]},independent_observation:evidence}};
}
test('preparation derives current actor/registry IDs and leaves every observed journey NOT RUN',()=>{
 const p=plan();assert.equal(p.fixture_ids.actors.length,2);assert.equal(p.fixture_ids.records.registry.length,3);
 assert.equal(p.execution_enabled,false);assert.equal(p.status,'NOT RUN');assert(p.steps.every(s=>s.status==='NOT RUN'));
 assert(p.blocking_dependencies.includes('restored_application_member_admin_files_writes_restart_rollback'));
});
test('wrong parent, stale bytes, missing population, old lease, expired/budget extension fail closed',()=>{
 for(const change of [
  f=>{const m=JSON.parse(f.manifestBytes);m.target.host='ep-arbitrary.ap-southeast-1.aws.neon.tech';f.manifestBytes=JSON.stringify(m);f.request.manifest_sha256=sha256(f.manifestBytes);},
  f=>{f.manifestBytes+=' ';},
  f=>{f.preparedBytes+=' ';},
  f=>{f.checkpointInventoryBytes+=' ';},
  f=>{f.request.object_manifest.objects.pop();},
  f=>{f.request.lease_id='legacy-1';},
  f=>{f.request.checkpoint.population.pop();},
  f=>{f.now=start+55*60000;},
  f=>{f.request.window.reserved_usd=5;},
  f=>{f.request.window.hard_deadline=new Date(start+56*60000).toISOString();}
 ]){const f=fixture();change(f);assert.throws(()=>prepareRecovery(f));}
});
test('no populated checkpoint can be prepared candidly but never executed',()=>{
 const f=fixture();f.request.checkpoint=null;f.request.object_manifest=null;
 const p=prepareRecovery(f);assert.equal(p.status,'NOT RUN');assert(p.blocking_dependencies.includes('hosted_populated_paused_consistent_checkpoint'));
});
test('exact object bytes and metadata, absence and keyset references reject mismatches',()=>{
 const p=plan(), item=p.object_manifest.objects[0];
 assert.equal(verifyObjectObservation(item,{...item},{backup:true}).verified,true);
 for(const actual of [{...item,sha256:'0'.repeat(64)},{...item,length:5},{...item,metadata:{...metadata,content_type:'text/plain'}},{...item,state:'absent'},{...item,key:'c'.repeat(28)}])assert.throws(()=>verifyObjectObservation(item,actual));
 for(const change of [
  v=>v.objects.push(structuredClone(v.objects[0])),
  v=>v.objects[0].backup_relative_path='../outside',
  v=>v.objects[1].sha256='c'.repeat(64),
  v=>v.historical_key_references[0].secret_store_ref='plaintext-secret',
  v=>v.historical_key_references[0].secret_value='forbidden',
  v=>v.manifest_sha256='d'.repeat(64)
 ]){const v=structuredClone(p.object_manifest);change(v);assert.throws(()=>validateObjectManifest(v,{...p.binding,checkpoint_lsn:p.checkpoint.lsn}));}
 assert.equal(verifyObjectObservation(p.object_manifest.objects[1],p.object_manifest.objects[1]).absence_is_terminal_proof,false);
});
test('created target requires exact operation lineage, endpoint, journal and original inventory',()=>{
 const p=plan(),{journal,receipt}=created(p),target=validateCreatedTarget(p,receipt,journal);
 assert.equal(target.write_authorized,false);
 assert(validateTargetConnection(target,'postgresql://synthetic:synthetic@'+target.host+'/neondb?sslmode=verify-full'));
 for(const mutate of [
  r=>r.branch.id=PARENT,r=>r.branch.parent_id='br-wrong-parent',r=>r.restore_request.path='/wrong-snapshot',r=>r.restore_request.body.finalize_restore=true,r=>r.branch.default=true,r=>r.endpoint.branch_id=PARENT,r=>r.endpoint.host=PARENT_HOST,r=>r.operation_id='22345678-1234-4123-8123-123456789abc',r=>r.before.endpoints.push({id:r.endpoint.id,host:r.endpoint.host}),r=>r.endpoint.autoscaling_limit_max_cu=1
 ]){const r=structuredClone(receipt);mutate(r);assert.throws(()=>validateCreatedTarget(p,r,journal));}
 assert.throws(()=>validateCreatedTarget(p,receipt,createJournal(p)));
 for(const u of ['postgresql://u:p@'+PARENT_HOST+'/neondb?sslmode=verify-full','postgresql://u:p@ep-arbitrary.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full','postgresql://u:p@'+target.host+'/neondb?sslmode=verify-full&options=x'])assert.throws(()=>validateTargetConnection(target,u));
});
test('journal refuses replay and tampering; resources remain recorded after error and deadline',()=>{
 const p=plan();let j=createJournal(p);
 j=appendJournal(j,p,{action:'snapshot-create',status:'started',resource:null,evidence:null},now);
 assert.throws(()=>appendJournal(j,p,{action:'snapshot-create',status:'started',resource:null,evidence:null},now));
 j=appendJournal(j,p,{action:'snapshot-create',status:'ambiguous',resource:null,evidence},start+56*60000);
 j=appendJournal(j,p,{action:'snapshot-create',status:'resource-recorded',resource:{type:'snapshot',id:'snapshot-synthetic',name:p.resource_name,source_id:PARENT,host:null},evidence},start+56*60000);
 assert.equal(j.events[2].resource.id,'snapshot-synthetic');
 assert.throws(()=>appendJournal(j,p,{action:'cleanup',status:'started',resource:null,evidence:null},start+56*60000));
 const bad=structuredClone(j);bad.events[0].at='changed';
 assert.throws(()=>appendJournal(bad,p,{action:'snapshot-create',status:'failed',resource:null,evidence},now));
 assert.doesNotThrow(()=>validateDeadlines(window,start+46*60000,{cleanup:true}));
 assert.throws(()=>validateDeadlines(window,start+46*60000,{action:true}));
});
test('all sequence coverage and independently persisted generated IDs beyond highwater are required',()=>{
 const p=plan(),{journal,receipt}=created(p),target=validateCreatedTarget(p,receipt,journal);
 const seq=[{sequence:'public.users_id_seq',increment:'1',high_water:'31',options_sha256:'a'.repeat(64)},{sequence:'public.widgets_id_seq',increment:'-1',high_water:'-3',options_sha256:'b'.repeat(64)}];
 const rows=seq.map((s,i)=>({sequence:s.sequence,operation_id:operation,endpoint_id:target.endpoint_id,branch_id:target.branch_id,application_write:true,fresh_connection_read:true,collision:false,options_sha256:s.options_sha256,generated_ids:[i?'-4':'32'],observation:evidence}));
 assert.equal(sequenceWriteEvidence(p,target,seq,rows).status,'NOT RUN');
 for(const change of [r=>r.pop(),r=>r[0].generated_ids=['31'],r=>r[1].generated_ids=['-2'],r=>r[0].fresh_connection_read=false,r=>r[0].branch_id=PARENT,r=>r[0].options_sha256='c'.repeat(64),r=>r[0].generated_ids=['32','32']]){
  const r=structuredClone(rows);change(r);assert.throws(()=>sequenceWriteEvidence(p,target,seq,r));
 }
});
test('partial cleanup retains exact resource IDs and never treats absence as executed proof',()=>{
 const p=plan(),{journal,receipt}=created(p);
 const state=cleanupReconciliation(p,journal,{absent:[{type:'endpoint',id:receipt.endpoint.id}],preserved:[],before_endpoints:receipt.before.endpoints});
 assert.equal(state.status,'BLOCKED');assert.equal(state.unresolved_resources.length,2);assert.equal(state.created_resource_ids_retained.length,3);assert.equal(state.original_endpoints_not_confirmed.length,1);
 const complete=cleanupReconciliation(p,journal,{absent:state.created_resource_ids_retained,preserved:receipt.before.endpoints,before_endpoints:receipt.before.endpoints});
 assert.equal(complete.status,'NOT RUN');assert.equal(complete.provider_absence_executed,false);
});



