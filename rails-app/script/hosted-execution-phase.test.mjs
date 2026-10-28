import test from 'node:test';import assert from 'node:assert/strict';
import {functionalExecutionPlan,functionalExecutionWindow,admitFunctionalBatch,FUNCTIONAL_STAGE_LIMITS,mobileDependenciesReady} from './hosted-execution-phase.mjs';
const batches=['identity','event-draft','event-publish','publication-draft','publication-publish','discover','engagement','event-republish','snapshot-withdraw','imports','critical-guards','critical-replace','logout','throttle','aged-stepup'];
const inventory=Object.fromEntries(Array.from({length:42},(_,i)=>['case_'+i,[batches[i%14],'area']]));inventory.mfa_aged_stepup_revocation=['aged-stepup','identity'];for(let i=0;i<20;i++)inventory['external_'+i]=['operator','area'];
const source=()=>({origin:'https://isp-member-production.meithan-r.workers.dev',batches:[...batches],inventory:structuredClone(inventory),limits:{requests:350,concurrency:2,cleanup_reserve_minutes:10}});
test('functional phase selects exactly42 HTTP cases without claiming aging or20 external cases',()=>{const p=functionalExecutionPlan(['--execute','--phase','functional'],source());assert.equal(p.executes,true);assert.equal(p.batches.length,14);assert.equal(p.case_ids.length,42);assert.deepEqual(p.deferred_batches,['aged-stepup']);assert.equal(p.non_http_case_count,20);assert.equal(p.all_http_batches_completed,false);assert.equal(p.production_release_approved,false);assert.ok(Object.isFrozen(p.batches));});
test('mutation needs an explicit reviewed phase; planning never executes',()=>{for(const args of [[],['--plan'],['--plan','--phase','functional']])assert.equal(functionalExecutionPlan(args,source()).executes,false);for(const args of [['--execute'],['--execute','--phase','all'],['--execute','--phase','aged-stepup'],['--execute','--phase','functional','--retry'],['--unknown'],null])assert.throws(()=>functionalExecutionPlan(args,source()));});
test('changed origin, ordered batches, inventory or safety limits require review',()=>{for(const mutate of [s=>s.origin='http://localhost',s=>s.batches.reverse(),s=>s.batches.push('extra'),s=>delete s.inventory.case_1,s=>s.inventory.case_1=['aged-stepup','area'],s=>s.limits.requests=351,s=>s.limits.concurrency=3,s=>s.limits.cleanup_reserve_minutes=9]){const s=source();mutate(s);assert.throws(()=>functionalExecutionPlan([],s));}});
const start=Date.parse('2026-10-27T00:00:00Z');const runtime={ISP_STAGING_START_AT:'2026-10-27T00:00:00Z',ISP_STAGING_EXPIRES_AT:'2026-10-27T00:55:00Z'};
test('HTTP cutoff reserves browser time and ten-minute cleanup; no late batch admission',()=>{const w=functionalExecutionWindow(runtime,start);assert.equal(w.completeBy,start+25*60000);assert.equal(w.admitUntil,start+20*60000);assert.equal(w.testCutoff,start+45*60000);assert.equal(admitFunctionalBatch(w,w.admitUntil-1),true);assert.equal(admitFunctionalBatch(w,w.admitUntil),false);assert.throws(()=>admitFunctionalBatch(w,start-1));});
test('invalid, future, expired or overlong windows fail rather than extend',()=>{for(const now of [start-1,start+55*60000,NaN])assert.throws(()=>functionalExecutionWindow(runtime,now));for(const changes of [{ISP_STAGING_EXPIRES_AT:'2026-10-27T00:56:00Z'},{ISP_STAGING_EXPIRES_AT:'2026-10-27T00:20:00Z'},{ISP_STAGING_START_AT:'2026-10-27T00:00:00.000Z'}])assert.throws(()=>functionalExecutionWindow({...runtime,...changes},start));});

test('four command caps plus overhead fit the entire five-minute batch reserve',()=>{assert.equal(FUNCTIONAL_STAGE_LIMITS.http,180000);assert.equal(Object.values(FUNCTIONAL_STAGE_LIMITS).reduce((a,b)=>a+b,0),5*60000);});
test('mobile is gated by complete reconciled phase, required content and the current fixture/release',()=>{
 const phase=functionalExecutionPlan([],source()),fixtures={lease_id:'rails-staging-2',phase:'active',run_marker:'controlled',actors:{member_b:{id:2}}},preparedHash='a'.repeat(64);
 const state={lease_id:'rails-staging-2',prepared_release_sha256:preparedHash,run_marker:fixtures.run_marker,cases:Object.fromEntries(phase.case_ids.map(id=>[id,{status:'PASS',http:'PASS'}])),event:{slug:'event'},publication:{slug:'publication'},discover:{slot:1}};
 const args={phase,completed:[...phase.batches],state,fixtures,preparedHash,leaseId:'rails-staging-2'};assert.equal(mobileDependenciesReady(args),true);
 assert.equal(mobileDependenciesReady({...args,completed:phase.batches.slice(0,6)}),false);
 for(const mutate of [s=>s.halted=true,s=>s.running_batch='throttle',s=>s.prepared_release_sha256='b'.repeat(64),s=>s.run_marker='other',s=>delete s.event,s=>delete s.publication,s=>delete s.discover,s=>s.cases.case_0.status='BLOCKED']){const copy=structuredClone(state);mutate(copy);assert.equal(mobileDependenciesReady({...args,state:copy}),false);}
 assert.equal(mobileDependenciesReady({...args,fixtures:{...fixtures,phase:'cleaned'}}),false);
});

test('mobile handoff admits only an explicitly matching fixed lease and never cross-binds fixtures',()=>{
 const phase=functionalExecutionPlan([],source()),preparedHash='a'.repeat(64);
 for(const leaseId of ['rails-staging-2','rails-staging-3']){
  const fixtures={lease_id:leaseId,phase:'active',run_marker:'controlled',actors:{member_b:{id:2}}};
  const state={lease_id:leaseId,prepared_release_sha256:preparedHash,run_marker:fixtures.run_marker,cases:Object.fromEntries(phase.case_ids.map(id=>[id,{status:'PASS',http:'PASS'}])),event:{slug:'e'},publication:{slug:'p'},discover:{id:1}};
  const args={phase,completed:[...phase.batches],state,fixtures,preparedHash,leaseId};assert.equal(mobileDependenciesReady(args),true);
  for(const other of [undefined,'legacy-1','rails-staging-4',leaseId==='rails-staging-2'?'rails-staging-3':'rails-staging-2'])assert.equal(mobileDependenciesReady({...args,leaseId:other}),false);
  assert.equal(mobileDependenciesReady({...args,fixtures:{...fixtures,lease_id:undefined}}),false);
 }
});
