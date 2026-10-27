// Fixed-provider request evidence. No credential loading, filesystem access, retries or replay.
import {createHash,randomUUID} from 'node:crypto';
const A='/accounts/a9720867333b64a4f8ee70cdfd673eb9',W=A+'/workers/scripts/isp-member-production',APP=A+'/containers/applications';
export const MAX_ERROR_BODY_BYTES=65536,MAX_RESPONSE_BYTES=4*1024*1024;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const stages=new Set(['admission_error','intent_write_error','transport_error','body_read_error','body_limit_error','parse_error','provider_error','validation_error','http_error','complete']);
const fail=()=>{throw Error('Fixed provider request boundary refused');};
export function validateProviderTarget(method,endpoint){
 const app=new RegExp('^'+APP+'/[a-f0-9-]{36}(?:/instances-v2\\?per_page=100)?$');
 const gets=[A,W+'/deployments',W+'/content/v2',W+'/subdomain',A+'/workers/durable_objects/namespaces?per_page=1000',APP+'?per_page=100',A+'/builds/workers/2add92d700014660819ef6b5d266f104/triggers','/user/tokens/verify'];
 if(!((method==='GET'&&(gets.includes(endpoint)||app.test(endpoint)||new RegExp('^'+W+'/versions/[a-f0-9-]{36}$').test(endpoint)))||
  (method==='PUT'&&endpoint===W)||(method==='POST'&&[APP,W+'/subdomain',W+'/deployments'].includes(endpoint))||
  (method==='DELETE'&&app.test(endpoint)&&!endpoint.includes('instances-v2'))))return fail();
 return endpoint;
}
export async function requestPayloadFingerprint(body){
 if(body===undefined||body===null)return {request_sha256:sha(Buffer.alloc(0)),request_hash_scope:'empty'};
 if(typeof body==='string'||Buffer.isBuffer(body)||body instanceof Uint8Array){
  if(Buffer.byteLength(body)>8*1024*1024)return fail();
  return {request_sha256:sha(body),request_hash_scope:'wire-body'};
 }
 if(!(body instanceof FormData))return fail();
 let total=0;const parts=[];
 for(const [name,value] of body){
  const size=typeof value==='string'?Buffer.byteLength(value):value.size;
  if(parts.length>=32||!Number.isSafeInteger(size)||size<0||size>8*1024*1024-total)return fail();
  const bytes=typeof value==='string'?Buffer.from(value):Buffer.from(await value.arrayBuffer());
  if(bytes.length!==size)return fail();total+=bytes.length;
  parts.push({name,size:bytes.length,sha256:sha(bytes),...(typeof value==='string'?{kind:'text'}:{kind:'file',filename:value.name,type:value.type})});
 }
 // Fetch chooses the MIME boundary; this explicitly hashes components, not wire framing.
 return {request_sha256:sha(JSON.stringify(parts)),request_hash_scope:'multipart-components'};
}
function safeHeader(headers,name){const value=headers?.get(name);return typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value)?value:null;}
function codes(envelope){return [...new Set((Array.isArray(envelope?.errors)?envelope.errors:[]).slice(0,32).map(x=>x?.code).filter(x=>Number.isSafeInteger(x)&&x>=0&&x<=2147483647))];}
export function publicProviderOutcome(source){
 const v=source?.provider_outcome??source;
 try{
  if(!v||!uuid(v.request_id)||!hex(v.request_sha256)||!['empty','wire-body','multipart-components'].includes(v.request_hash_scope))return null;
  validateProviderTarget(v.method,v.endpoint);
  if(!stages.has(v.stage)||!['not_read','complete','truncated','read_error'].includes(v.body_state)||!['not_attempted','json','non_json','multipart','error'].includes(v.parse_state)||
   ![null,true,false].includes(v.provider_success)||!(v.http_status===null||(Number.isInteger(v.http_status)&&v.http_status>=100&&v.http_status<=599)))return null;
  const out={version:1,request_id:v.request_id,method:v.method,endpoint:v.endpoint,request_sha256:v.request_sha256,request_hash_scope:v.request_hash_scope,
   fetch_invoked:v.fetch_invoked===true,headers_received:v.headers_received===true,http_status:v.http_status,
   stage:v.stage,body_state:v.body_state,parse_state:v.parse_state,provider_success:v.provider_success,
   ok:v.ok===true,evidence_write_failed:v.evidence_write_failed===true,error_body_saved:v.error_body_saved===true,
   error_codes:codes({errors:(Array.isArray(v.error_codes)?v.error_codes:[]).map(code=>({code}))})};
  for(const key of ['started_at','finished_at'])if(typeof v[key]==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v[key])&&Number.isFinite(Date.parse(v[key])))out[key]=v[key];
  for(const key of ['elapsed_ms','body_bytes'])if(Number.isSafeInteger(v[key])&&v[key]>=0)out[key]=v[key];
  for(const key of ['body_sha256','body_prefix_sha256'])if(hex(v[key]))out[key]=v[key];
  for(const key of ['provider_ray','provider_request_id'])if(typeof v[key]==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v[key]))out[key]=v[key];
  if(['error','timeout','aborted'].includes(v.failure_kind))out.failure_kind=v.failure_kind;
  return Object.freeze(out);
 }catch{return null;}
}
export class ProviderRequestError extends Error{
 constructor(outcome){super('Provider request did not complete safely; inspect restricted request evidence.');this.provider_outcome=publicProviderOutcome(outcome);}
}
export async function performProviderRequest({method,endpoint,body,headers,allow404=false,signal,timeoutMs=20000,
 fetchImpl=fetch,persist=()=>{},admit=()=>{},parseSuccess=(_bytes,_response,envelope)=>envelope.result,
 requestId=randomUUID(),now=Date.now,bestEffortEvidence=false}={}){
 validateProviderTarget(method,endpoint);if(!uuid(requestId)||!Number.isFinite(timeoutMs)||timeoutMs<=0)return fail();
 const fingerprint=await requestPayloadFingerprint(body),start=now();
 const outcome={version:1,request_id:requestId,method,endpoint,...fingerprint,started_at:new Date(start).toISOString(),
  fetch_invoked:false,headers_received:false,http_status:null,stage:'transport_error',body_state:'not_read',parse_state:'not_attempted',
  provider_success:null,error_codes:[],ok:false,evidence_write_failed:false,error_body_saved:false,body_bytes:0};
 try{await persist('intent',{version:1,request_id:requestId,method,endpoint,...fingerprint,started_at:outcome.started_at,dispatch_intent:true});}
 catch{outcome.evidence_write_failed=true;if(!bestEffortEvidence){outcome.stage='intent_write_error';throw new ProviderRequestError(outcome);}}
 const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
 let timer,timedOut=false,aborted,phase='admission',response,prefix=[],captured=0,rawAllowed=true,result,raceSucceeded=false;
 const deadline=new Promise((_,reject)=>{aborted=()=>reject(Error('Bounded provider operation aborted'));combined.addEventListener('abort',aborted,{once:true});timer=setTimeout(()=>{timedOut=true;controller.abort();},Math.max(1,Math.ceil(Math.min(20000,timeoutMs))));});
 try{
  const operation=async()=>{
   if(combined.aborted)throw Error('Provider request aborted before dispatch');
   await admit();if(combined.aborted)throw Error('Provider request aborted before dispatch');
   phase='transport';outcome.fetch_invoked=true;
   response=await fetchImpl('https://api.cloudflare.com/client/v4'+endpoint,{method,headers,body,redirect:'error',signal:combined});
   outcome.headers_received=true;outcome.http_status=response.status;
   outcome.provider_ray=safeHeader(response.headers,'cf-ray');
   outcome.provider_request_id=safeHeader(response.headers,'x-request-id')??safeHeader(response.headers,'cf-request-id');
   if(allow404&&response.status===404){phase='body';await response.body?.cancel();outcome.ok=true;outcome.stage='complete';return null;}
   phase='body';const success=response.ok===true,limit=success?MAX_RESPONSE_BYTES:MAX_ERROR_BODY_BYTES;
   rawAllowed=!(endpoint===W+'/content/v2'&&success);
   if(response.body)for await(const part of response.body){
    const chunk=Buffer.from(part),room=Math.max(0,limit-captured),take=chunk.subarray(0,room);
    outcome.body_bytes+=chunk.length;if(take.length){prefix.push(take);captured+=take.length;}
    if(chunk.length>room){outcome.body_state='truncated';if(success){outcome.stage='body_limit_error';throw Error('Provider response limit');}break;}
   }
   const buffer=Buffer.concat(prefix);outcome.body_state=outcome.body_state==='truncated'?'truncated':'complete';
   if(outcome.body_state==='complete')outcome.body_sha256=sha(buffer);
   if(!success){
    outcome.stage='http_error';if(outcome.body_state==='complete')try{const json=JSON.parse(buffer.toString('utf8'));outcome.parse_state='json';outcome.provider_success=typeof json?.success==='boolean'?json.success:null;outcome.error_codes=codes(json);}catch{outcome.parse_state='non_json';}
    throw new ProviderRequestError(outcome);
   }
   phase='parse';let envelope=null;
   if(endpoint===W+'/content/v2'&&(response.headers.get('content-type')??'').startsWith('multipart/'))outcome.parse_state='multipart';
   else{
    envelope=JSON.parse(buffer.toString('utf8'));outcome.parse_state='json';outcome.provider_success=typeof envelope?.success==='boolean'?envelope.success:null;outcome.error_codes=codes(envelope);
    if(envelope?.success!==true){outcome.stage='provider_error';throw new ProviderRequestError(outcome);}
   }
   phase='validation';const value=await parseSuccess(buffer,response,envelope);
   outcome.stage='complete';outcome.ok=true;return value;
  };
  result=await Promise.race([operation(),deadline]);raceSucceeded=true;
 }catch{
  outcome.ok=false;
  if(!['http_error','provider_error','body_limit_error'].includes(outcome.stage))outcome.stage=phase==='admission'?'admission_error':phase==='transport'?'transport_error':phase==='body'?'body_read_error':phase==='parse'?'parse_error':'validation_error';
  if(outcome.stage==='body_read_error')outcome.body_state='read_error';
  if(phase==='parse'&&outcome.parse_state==='not_attempted')outcome.parse_state='error';
  outcome.failure_kind=timedOut?'timeout':signal?.aborted?'aborted':'error';
 }finally{clearTimeout(timer);combined.removeEventListener('abort',aborted);controller.abort();}
 // Snapshot after the race: an uncooperative late fetch/parser cannot change final disposition.
 const final={...outcome,error_codes:[...outcome.error_codes],ok:raceSucceeded&&outcome.ok};
 const buffer=Buffer.concat(prefix);if(buffer.length)final.body_prefix_sha256=sha(buffer);
 if(!final.ok&&final.headers_received&&rawAllowed){
  const errorPrefix=buffer.subarray(0,MAX_ERROR_BODY_BYTES);
  const truncated=final.body_state!=='complete'||buffer.length>MAX_ERROR_BODY_BYTES||final.body_bytes>MAX_ERROR_BODY_BYTES;
  try{await persist('error-body',{version:1,request_id:requestId,private_only:true,body_prefix_base64:errorPrefix.toString('base64'),body_prefix_sha256:sha(errorPrefix),body_prefix_bytes:errorPrefix.length,body_bytes_observed:final.body_bytes,truncated});final.error_body_saved=true;}catch{final.evidence_write_failed=true;}
 }
 final.finished_at=new Date(now()).toISOString();final.elapsed_ms=Math.max(0,Math.ceil(now()-start));
 let safe=publicProviderOutcome(final);
 try{await persist('outcome',safe);}catch{final.evidence_write_failed=true;safe=publicProviderOutcome(final);}
 if(!final.ok||(!bestEffortEvidence&&final.evidence_write_failed))throw new ProviderRequestError(safe);
 return {value:result,provider_outcome:safe};
}
