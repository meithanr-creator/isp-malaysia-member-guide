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