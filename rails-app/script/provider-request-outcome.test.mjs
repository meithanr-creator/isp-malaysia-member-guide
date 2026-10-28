import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {performProviderRequest,publicProviderOutcome,requestPayloadFingerprint,MAX_ERROR_BODY_BYTES,MAX_RESPONSE_BYTES,validateProviderTarget} from './provider-request-outcome.mjs';
import {stopStaging} from './cloudflare-staging-watchdog.mjs';
const A='/accounts/a9720867333b64a4f8ee70cdfd673eb9',W=A+'/workers/scripts/isp-member-production',APP=A+'/containers/applications';
const ID='11111111-2222-4333-8444-555555555555',SECRET='synthetic-secret-never-public';
const sha=value=>createHash('sha256').update(value).digest('hex');
const json=(result={},extra={},status=200)=>new Response(JSON.stringify({success:true,result,...extra}),{status,headers:{'content-type':'application/json','cf-ray':'aabbcc-LHR','x-request-id':ID}});
function fixture(overrides={}){
 const records=[],calls=[];
 const options={method:'GET',endpoint:APP+'/'+ID,headers:{Authorization:'Bearer '+SECRET},
  persist:(kind,value)=>records.push({kind,value}),fetchImpl:async(url,init)=>{calls.push({url,init});return json({id:ID});},...overrides};
 return {records,calls,options};
}
async function failure(options){let error;try{await performProviderRequest(options);}catch(value){error=value;}assert.ok(error,'Must fail');assert.ok(error.provider_outcome);return error.provider_outcome;}

test('all requests persist intent before fetch and retain safe outcome hashes and IDs',async()=>{
 const f=fixture();f.options.fetchImpl=async()=>{assert.equal(f.records[0].kind,'intent');return json({id:ID});};
 const result=await performProviderRequest(f.options);
 assert.deepEqual(result.value,{id:ID});assert.equal(result.provider_outcome.http_status,200);
 assert.equal(result.provider_outcome.ok,true);assert.equal(result.provider_outcome.stage,'complete');
 assert.equal(result.provider_outcome.provider_ray,'aabbcc-LHR');assert.equal(result.provider_outcome.provider_request_id,ID);
 assert.equal(f.records.at(-1).kind,'outcome');assert.equal(JSON.stringify(f.records).includes(SECRET),false);
 assert.equal(Object.hasOwn(result.provider_outcome,'headers'),false);
});

test('foreign methods endpoints and credential-shaped queries are refused before intent or fetch',async()=>{
 for(const change of [{method:'PATCH'},{endpoint:'/accounts/foreign/containers/applications'},
  {endpoint:APP+'?token='+SECRET},{endpoint:'https://evil.invalid/'},{endpoint:W+'/../another-worker'}]){
  const f=fixture(change);await assert.rejects(performProviderRequest(f.options));assert.equal(f.calls.length,0);assert.equal(f.records.length,0);
 }
});

test('normal durable-intent failure prevents sending a request',async()=>{
 const f=fixture({persist:()=>{throw Error('disk full '+SECRET);}});
 const result=await failure(f.options);assert.equal(f.calls.length,0);assert.equal(result.fetch_invoked,false);
 assert.equal(result.stage,'intent_write_error');assert.equal(result.evidence_write_failed,true);
 assert.equal(JSON.stringify(result).includes(SECRET),false);
});

test('emergency disk failure cannot suppress verified scoped compute deletion',async()=>{
 let deleted=false,evidenceFailed=false;const calls=[],now=Date.now();
 const plan={account:'a9720867333b64a4f8ee70cdfd673eb9',worker:'isp-member-production',application_name:'isp-member-production',application_id:ID,start_at:new Date(now-60000).toISOString(),expires_at:new Date(now+54*60000).toISOString()};
 const api=async(path,method='GET',body,allow404,options)=>{
  const exchange=await performProviderRequest({method,endpoint:A+path,body:body?JSON.stringify(body):undefined,allow404,signal:options.signal,timeoutMs:options.timeoutMs,bestEffortEvidence:true,
   persist:()=>{throw Error('disk unavailable');},fetchImpl:async(url,init)=>{
    calls.push([url,init.method]);if(url.endsWith('/subdomain'))return json({enabled:false,previews_enabled:false});
    if(init.method==='DELETE'){deleted=true;return json({});}
    return deleted?new Response('',{status:404}):json({name:'isp-member-production'});
   }});
  evidenceFailed ||=exchange.provider_outcome.evidence_write_failed;return exchange.value;
 };
 const result=await stopStaging(plan,api,async()=>{});
 assert.equal(deleted,true);assert.equal(result.container_application_absent,true);assert.equal(result.ingress_closed,true);
 assert.equal(evidenceFailed,true);assert.equal(calls.filter(([,method])=>method==='DELETE').length,1);
});

test('transport error has no invented HTTP response or raw provider body',async()=>{
 const f=fixture({fetchImpl:async()=>{throw Error('transport '+SECRET);}});
 const result=await failure(f.options);assert.equal(result.headers_received,false);assert.equal(result.http_status,null);
 assert.equal(result.stage,'transport_error');assert.equal(f.records.some(r=>r.kind==='error-body'),false);
 assert.equal(JSON.stringify(result).includes(SECRET),false);
});

test('actual HTTP rejection retains codes separately and raw message only in private body evidence',async()=>{
 const f=fixture({fetchImpl:async()=>json(null,{success:false,errors:[{code:10000,message:SECRET},{code:'unsafe-text'},{code:10000}]},403)});
 const result=await failure(f.options);assert.equal(result.http_status,403);assert.equal(result.stage,'http_error');
 assert.equal(result.body_state,'complete');assert.deepEqual(result.error_codes,[10000]);assert.equal(result.provider_success,false);
 const privateBody=f.records.find(r=>r.kind==='error-body').value;
 assert.equal(privateBody.private_only,true);assert.equal(Buffer.from(privateBody.body_prefix_base64,'base64').toString().includes(SECRET),true);
 assert.equal(JSON.stringify(result).includes(SECRET),false);assert.equal(privateBody.truncated,false);
});

test('HTTP headers survive partial body read failure without becoming a transport error',async()=>{
 let reads=0;const body=new ReadableStream({pull(controller){if(reads++===0)controller.enqueue(Buffer.from('{"success":'));else controller.error(Error('read '+SECRET));}});
 const f=fixture({fetchImpl:async()=>new Response(body,{status:200,headers:{'content-type':'application/json'}})});
 const result=await failure(f.options);assert.equal(result.http_status,200);assert.equal(result.headers_received,true);
 assert.equal(result.stage,'body_read_error');assert.equal(result.body_state,'read_error');assert.equal(result.provider_success,null);
 assert.equal(f.records.find(r=>r.kind==='error-body').value.truncated,true);
});

test('JSON parsing provider-envelope and local validation rejection are distinct',async()=>{
 const malformed=fixture({fetchImpl:async()=>new Response('not-json',{status:200})});
 assert.equal((await failure(malformed.options)).stage,'parse_error');
 const envelope=fixture({fetchImpl:async()=>json(null,{success:false,errors:[{code:10021,message:SECRET}]})});
 const rejected=await failure(envelope.options);assert.equal(rejected.stage,'provider_error');assert.equal(rejected.http_status,200);assert.deepEqual(rejected.error_codes,[10021]);
 const validation=fixture({parseSuccess:()=>{throw Error('foreign identity '+SECRET);}});
 const local=await failure(validation.options);assert.equal(local.stage,'validation_error');assert.equal(local.provider_success,true);assert.equal(local.http_status,200);
});

test('bounded private HTTP error prefix is labelled truncated and stream cancelled at cap',async()=>{
 let cancelled=false;const body=new ReadableStream({pull(controller){controller.enqueue(Buffer.alloc(MAX_ERROR_BODY_BYTES+10,65));},cancel(){cancelled=true;}});
 const f=fixture({fetchImpl:async()=>new Response(body,{status:400})});
 const result=await failure(f.options),privateBody=f.records.find(r=>r.kind==='error-body').value;
 assert.equal(result.stage,'http_error');assert.equal(result.body_state,'truncated');assert.equal(cancelled,true);
 assert.equal(privateBody.body_prefix_bytes,MAX_ERROR_BODY_BYTES);assert.equal(privateBody.truncated,true);
 assert.equal(Buffer.from(privateBody.body_prefix_base64,'base64').length,MAX_ERROR_BODY_BYTES);
 assert.equal(result.body_sha256,undefined);
});

test('oversized successful response is rejected before parsing with bounded capture',async()=>{
 const f=fixture({fetchImpl:async()=>new Response(Buffer.alloc(MAX_RESPONSE_BYTES+1,65),{status:200})});
 const result=await failure(f.options);assert.equal(result.stage,'body_limit_error');assert.equal(result.body_state,'truncated');
 assert.equal(f.records.find(r=>r.kind==='error-body').value.body_prefix_bytes,MAX_ERROR_BODY_BYTES);
});

test('multipart fingerprints contain no payload and reject oversized File before arrayBuffer',async()=>{
 const form=new FormData();form.set('metadata',new Blob([SECRET],{type:'application/json'}));form.set('index.mjs',new File(['export default {};'],'index.mjs'));
 const first=await requestPayloadFingerprint(form),second=await requestPayloadFingerprint(form);
 assert.deepEqual(first,second);assert.equal(first.request_hash_scope,'multipart-components');assert.equal(JSON.stringify(first).includes(SECRET),false);
 let read=false;const huge=new File(['tiny'],'index.mjs');Object.defineProperty(huge,'size',{value:9*1024*1024});huge.arrayBuffer=async()=>{read=true;throw Error('Must not allocate');};
 const oversized=new FormData();oversized.set('index.mjs',huge);
 await assert.rejects(requestPayloadFingerprint(oversized));assert.equal(read,false);
});

test('successful Worker multipart files are represented only by response and module hashes',async()=>{
 const form=new FormData();form.set('index.mjs',new File([SECRET],'index.mjs',{type:'application/javascript+module'}));
 const response=new Response(form);response.headers.set('cf-entrypoint','index.mjs');
 const f=fixture({endpoint:W+'/content/v2',fetchImpl:async()=>response,parseSuccess:async(bytes,r)=>{
  const decoded=await new Response(bytes,{headers:{'content-type':r.headers.get('content-type')}}).formData();
  return {entrypoint:r.headers.get('cf-entrypoint'),modules:await Promise.all([...decoded].map(async([name,file])=>({name,sha256:sha(Buffer.from(await file.arrayBuffer()))})))};
 }});
 const result=await performProviderRequest(f.options);assert.equal(result.value.modules[0].sha256,sha(SECRET));
 assert.equal(result.provider_outcome.parse_state,'multipart');assert.equal(f.records.some(r=>r.kind==='error-body'),false);
 assert.equal(JSON.stringify(f.records).includes(SECRET),false);
});

test('404 cancellation rejection cannot become undefined successful absence',async()=>{
 const f=fixture({allow404:true,fetchImpl:async()=>({status:404,ok:false,headers:new Headers(),body:{cancel:async()=>{throw Error('cancel '+SECRET);}}})});
 const result=await failure(f.options);assert.equal(result.ok,false);assert.equal(result.http_status,404);assert.equal(result.stage,'body_read_error');
});

test('deadline failure stays frozen while ignored-abort parser resolves during evidence persistence',async()=>{
 let late=false;
 const f=fixture({timeoutMs:15,parseSuccess:async()=>{await delay(35);late=true;return {unsafe:'late'};}});
 const persist=f.options.persist;f.options.persist=async(kind,value)=>{if(kind==='error-body')await delay(60);persist(kind,value);};
 const result=await failure(f.options);assert.equal(late,true);assert.equal(result.ok,false);assert.equal(result.failure_kind,'timeout');
 assert.equal(result.stage,'validation_error');assert.equal(f.records.at(-1).value.ok,false);
});

test('stalled fetch is aborted inside the same bounded request with no retry',async()=>{
 let calls=0,signal;
 const f=fixture({timeoutMs:15,fetchImpl:async(_url,init)=>{calls++;signal=init.signal;return new Promise(()=>{});}});
 const result=await failure(f.options);assert.equal(result.stage,'transport_error');assert.equal(result.failure_kind,'timeout');
 assert.equal(signal.aborted,true);assert.equal(calls,1);assert.equal(result.http_status,null);
});

test('final evidence-write failure refuses normal success but leaves emergency result observable',async()=>{
 for(const emergency of [false,true]){
  const f=fixture({bestEffortEvidence:emergency,persist:(kind)=>{if(kind==='outcome')throw Error('disk full');}});
  if(emergency){const result=await performProviderRequest(f.options);assert.equal(result.value.id,ID);assert.equal(result.provider_outcome.evidence_write_failed,true);}
  else{const result=await failure(f.options);assert.equal(result.http_status,200);assert.equal(result.evidence_write_failed,true);}
 }
});

test('public outcome strips arbitrary body message and credential headers',async()=>{
 const f=fixture(),result=await performProviderRequest(f.options);
 const safe=publicProviderOutcome({...result.provider_outcome,headers:{Authorization:SECRET},message:SECRET,body_prefix_base64:Buffer.from(SECRET).toString('base64')});
 assert.equal(JSON.stringify(safe).includes(SECRET),false);assert.equal(Object.hasOwn(safe,'body_prefix_base64'),false);
 assert.equal(publicProviderOutcome({...safe,endpoint:'/accounts/foreign/secret'}),null);
});

test('local allowlist or request-budget refusal is distinct from no-header transport failure',async()=>{
 const f=fixture({admit:()=>{throw Error('request budget reached');}});
 const result=await failure(f.options);assert.equal(result.stage,'admission_error');assert.equal(result.fetch_invoked,false);
 assert.equal(result.headers_received,false);assert.equal(result.http_status,null);assert.equal(f.calls.length,0);
 assert.equal(f.records[0].kind,'intent');assert.equal(f.records.at(-1).kind,'outcome');
});

test('successful Worker response with invalid MIME never archives content bytes on local rejection',async()=>{
 const f=fixture({endpoint:W+'/content/v2',fetchImpl:async()=>json({module:SECRET}),parseSuccess:()=>{throw Error('Expected multipart');}});
 const result=await failure(f.options);assert.equal(result.http_status,200);assert.equal(result.stage,'validation_error');
 assert.equal(f.records.some(r=>r.kind==='error-body'),false);assert.equal(JSON.stringify(f.records).includes(SECRET),false);
});

test('native bootstrap permits only fixed namespace32 app and exact image preparation routes',()=>{
 const ns='4'.repeat(32);for(const method of ['GET','DELETE'])assert.equal(validateProviderTarget(method,APP+'/'+ns),APP+'/'+ns);assert.equal(validateProviderTarget('GET',APP+'/'+ns+'/instances-v2?per_page=100'),APP+'/'+ns+'/instances-v2?per_page=100');assert.equal(validateProviderTarget('POST',A+'/containers/image-preparations'),A+'/containers/image-preparations');
 for(const [method,path] of [['POST',APP+'/'+ns],['DELETE',APP+'/'+ns+'/instances-v2?per_page=100'],['GET',APP+'/'+ns+'?token=x'],['POST',A+'/containers/image-preparations?image=x'],['GET',A+'/containers/image-preparations'],['GET',APP+'/'+'a'.repeat(31)],['GET',APP+'/'+'A'.repeat(32)]])assert.throws(()=>validateProviderTarget(method,path));
});
