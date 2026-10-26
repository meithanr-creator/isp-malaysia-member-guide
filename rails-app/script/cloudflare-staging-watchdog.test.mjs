import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePlan,stopStaging} from './cloudflare-staging-watchdog.mjs';
const plan=()=>{const now=Date.now();return {account:'a9720867333b64a4f8ee70cdfd673eb9',worker:'isp-member-production',application_name:'isp-member-production',application_id:'11111111-2222-3333-4444-555555555555',start_at:new Date(now-60000).toISOString(),expires_at:new Date(now+54*60000).toISOString()};};
test('identity and duration refuse unrelated resources and excess time',()=>{
 const p=plan();assert.equal(validatePlan(p).stopAt,Date.parse(p.expires_at)-300000);
 assert.throws(()=>validatePlan({...p,worker:'other'}));
 assert.throws(()=>validatePlan({...p,application_id:'../../other'}));
 assert.throws(()=>validatePlan({...p,expires_at:new Date(Date.now()+60*60000).toISOString()}));
});
test('no mutations occur for a mismatched application',async()=>{
 const calls=[];await assert.rejects(stopStaging(plan(),async(path,method)=>{calls.push(method);return {name:'another-project'};}));
 assert.deepEqual(calls,['GET']);
});
test('closes ingress, removes only the named application and verifies absence',async()=>{
 const calls=[];let deleted=false;
 const result=await stopStaging(plan(),async(path,method='GET')=>{
  calls.push([path,method]);
  if(path.endsWith('/subdomain'))return {enabled:false,previews_enabled:false};
  if(method==='DELETE'){deleted=true;return {message:'Deleting'};}
  return deleted?null:{name:'isp-member-production'};
 },async()=>{});
 assert.equal(result.container_application_absent,true);assert.equal(result.ingress_closed,true);
 assert.deepEqual(calls.map(c=>c[1]),['GET','POST','GET','DELETE','GET']);
});
test('ingress API failure still stops verified ISP compute and reports the incomplete control',async()=>{
 let deleted=false;
 const result=await stopStaging(plan(),async(path,method='GET')=>{
  if(path.endsWith('/subdomain'))throw new Error('Provider unavailable');
  if(method==='DELETE'){deleted=true;return {};}
  return deleted?null:{name:'isp-member-production'};
 },async()=>{});
 assert.equal(result.container_application_absent,true);assert.equal(result.ingress_closed,false);
});
test('does not report successful shutdown while deletion remains pending',async()=>{
 let polls=0;
 await assert.rejects(stopStaging(plan(),async(path,method='GET')=>{
  if(path.endsWith('/subdomain'))return {enabled:false,previews_enabled:false};
  if(method==='DELETE')return {};
  polls++;return {name:'isp-member-production'};
 },async()=>{}),/not yet confirmed/);
 assert.equal(polls,19);
});
test('already absent ISP compute still has its public ingress disabled',async()=>{
 const methods=[];
 const result=await stopStaging(plan(),async(path,method='GET')=>{methods.push(method);return path.endsWith('/subdomain')?{enabled:false,previews_enabled:false}:null;},async()=>{});
 assert.equal(result.container_application_absent,true);assert.equal(methods.includes('DELETE'),false);
 assert.equal(methods.includes('POST'),true);
});
import {LEASE2,leaseContext,validatePreparedRelease,preparedTuple} from './staging-lease-context.mjs';
function freshFixture(){
 const prepared={...validatePreparedRelease({version:1,lease_id:LEASE2,account:'a9720867333b64a4f8ee70cdfd673eb9',worker:'isp-member-production',application_name:'isp-member-production',application_id:'11111111-2222-4333-8444-555555555555',namespace_id:'1'.repeat(32),class_name:'RailsStaging2',worker_source:'2'.repeat(40),rails_source:'3'.repeat(40),image_digest:'sha256:'+'4'.repeat(64),rollback_worker_version:'22222222-3333-4444-8555-666666666666',rollback_deployment_id:'33333333-4444-4555-8666-777777777777',activation:false}),prepared_release_sha256:'5'.repeat(64)};
 return {prepared,context:leaseContext(LEASE2),freshPlan:{...plan(),...preparedTuple(prepared)},app:{id:prepared.application_id,name:prepared.application_name,account_id:prepared.account,durable_objects:{namespace_id:prepared.namespace_id}}};
}
test('fresh watchdog cannot fall through legacy or proceed without sealed identity',async()=>{const f=freshFixture(),calls=[],api=async(...args)=>{calls.push(args);return f.app;};await assert.rejects(stopStaging(f.freshPlan,api,async()=>{}));await assert.rejects(stopStaging(f.freshPlan,api,async()=>{},{context:leaseContext(),prepared:f.prepared}));await assert.rejects(stopStaging({...f.freshPlan,prepared_release_sha256:'6'.repeat(64)},api,async()=>{},{context:f.context,prepared:f.prepared}));assert.deepEqual(calls,[]);});
test('fresh watchdog rejects wrong account, app or namespace before any mutation',async()=>{const f=freshFixture();for(const app of [{...f.app,account_id:'other'},{...f.app,id:f.prepared.rollback_worker_version},{...f.app,durable_objects:{namespace_id:'a0e936fb9d634f59b1caaa1896b07a1f'}}]){const calls=[];await assert.rejects(stopStaging(f.freshPlan,async(path,method='GET')=>{calls.push([path,method]);return app;},async()=>{},{context:f.context,prepared:f.prepared}));assert.deepEqual(calls,[[`/containers/applications/${f.prepared.application_id}`,'GET']]);}});
test('fresh emergency stop needs sealed identity but no runtime file',async()=>{const f=freshFixture(),calls=[];let deleted=false;const result=await stopStaging(f.freshPlan,async(path,method='GET')=>{calls.push([path,method]);if(path.endsWith('/subdomain'))return {enabled:false,previews_enabled:false};assert.equal(path,`/containers/applications/${f.prepared.application_id}`);if(method==='DELETE'){deleted=true;return {};}return deleted?null:f.app;},async()=>{},{context:f.context,prepared:f.prepared});assert.equal(result.container_application_absent,true);assert.equal(result.ingress_closed,true);assert.deepEqual(calls.map(([,m])=>m),['GET','POST','GET','DELETE','GET']);});