import {DurableObject} from 'cloudflare:workers';
import {runtimeConfiguration,requestForRails,privateResponse,unavailable,edgeClientIp,EDGE_IP_HEADER} from '../src/runtime.js';
import {validUuid,TRACE_HEADER,className} from '../src/diagnostics.js';
import {browserAccessEndpoint,validBrowserCookie,headersWithoutReviewCookie} from '../staging/browser-access.js';
import {cleanTrace} from '../staging/diagnostics.js';
export {ISPStartup,ISPNeonProof} from '../startup/index.js';
export const HOST='isp-rails-startup.meithan-r.workers.dev';
export const IMAGE='registry.cloudflare.com/a9720867333b64a4f8ee70cdfd673eb9/isp-member-rails@sha256:152480a896060eae82a380dc54f651e199ff1585cd5dd805d0d51b9f3a587d2a';
export const SINGLETON='isp-private-acceptance';
export const LIMITS=Object.freeze({window:3300000,startup:180000,requests:1500,bytes:256*1024*1024,upload:25*1024*1024,concurrent:2});
const NEON='ep-delicate-frost-a1o15wrb.ap-southeast-1.aws.neon.tech';
const STATE='acceptance:v1',TRACES='acceptance:traces:v1',PREFIX='/__isp_acceptance/',DIAGNOSTICS='/__isp_diagnostics/';
const quiet=(status=503)=>new Response('Private acceptance unavailable.',{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function keyMatches(value,env){const key=env.ISP_STAGING_KEY;if(!/^[a-f0-9]{64}$/.test(key||'')||typeof value!=='string'||value.length!==64)return false;let diff=0;for(let i=0;i<64;i++)diff|=value.charCodeAt(i)^key.charCodeAt(i);return diff===0;}
export function acceptanceWindow(env,now=Date.now()){
 const start=Date.parse(env.ISP_STAGING_START_AT),end=Date.parse(env.ISP_STAGING_EXPIRES_AT);
 return env.ISP_ACCEPTANCE_ENABLED==='true'&&env.APP_HOST===HOST&&Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&end>start&&end-start<=LIMITS.window&&now>=start&&now<end?{start,end}:null;
}
export function acceptanceRuntime(env){
 try{const raw=JSON.parse(env.RUNTIME_ENV),db=new URL(raw.DATABASE_URL),ssl=db.searchParams.getAll('sslmode');
 if(raw.APP_HOST!==HOST||raw.RAILS_ENV!=='production'||raw.DB_SSLMODE!=='verify-full'||raw.ISP_DEMO_MODE!=='false'||raw.ISP_ACCOUNT_EMAILS_ENABLED!=='false'||raw.ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED!=='false')return null;
 if(!['postgres:','postgresql:'].includes(db.protocol)||![NEON,NEON.replace('.','-pooler.')].includes(db.hostname)||!db.username||!db.password||db.pathname!=='/neondb'||!['','5432'].includes(db.port)||db.hash||ssl.length!==1||ssl[0]!=='verify-full')return null;
 if([...db.searchParams].some(([k,v])=>k!=='sslmode'&&(k!=='channel_binding'||v!=='require'))||db.searchParams.getAll('channel_binding').length>1)return null;
 if(raw.STORAGE_BUCKET!=='isp-staging-private'||raw.STORAGE_ENDPOINT!=='https://a9720867333b64a4f8ee70cdfd673eb9.r2.cloudflarestorage.com'||raw.AWS_REGION!=='auto'||raw.STORAGE_FORCE_PATH_STYLE!=='true'||Object.keys(raw).some(k=>k.startsWith('SMTP_')&&raw[k]))return null;
 if(raw.AWS_REQUEST_CHECKSUM_CALCULATION!=='when_required')return null;
 const config=runtimeConfiguration({...raw,ISP_CONTAINER_ENABLED:'true'});
 if(config)config.containerEnv.AWS_REQUEST_CHECKSUM_CALCULATION='when_required';
 return config;
 }catch{return null;}
}
function control(request){const u=new URL(request.url);if(u.pathname===PREFIX+'status'&&request.method==='GET'&&!u.search)return 'status';if(u.pathname===PREFIX+'stop'&&request.method==='POST'&&!u.search)return 'stop';return null;}
function traceId(request){const id=request.headers.get(TRACE_HEADER);return validUuid(id)?id:crypto.randomUUID();}
function validTarget(request){const u=new URL(request.url);return u.protocol==='https:'&&u.hostname===HOST&&!u.port&&!u.username&&!u.password&&!u.hash&&!request.headers.has('Upgrade');}
export default {async fetch(request,env){
 const id=traceId(request);try{
 if(!validTarget(request))return unavailable(id);
 const u=new URL(request.url),key=keyMatches(request.headers.get('x-isp-staging-key'),env),ctl=control(request);
 if(ctl){if(!key)return unavailable(id);}else{
  const window=acceptanceWindow(env);if(!window)return unavailable(id);
  const review=await browserAccessEndpoint(request,env,window,value=>keyMatches(value,env));if(review)return privateResponse(review,id);
  if(u.pathname.startsWith('/__isp_acceptance')||u.pathname.startsWith('/__isp_review'))return unavailable(id);
  if(u.pathname.startsWith('/__isp_diagnostics')&&(!key||request.method!=='GET'||u.search||!validUuid(u.pathname.slice(DIAGNOSTICS.length))))return unavailable(id);
  if(!key&&!await validBrowserCookie(request,env,window)){if(request.method==='GET'&&request.headers.get('Accept')?.includes('text/html')&&!u.pathname.startsWith('/__isp_'))return privateResponse(new Response(null,{status:303,headers:{Location:'/__isp_review'}}),id);return unavailable(id);}
 }
 const headers=headersWithoutReviewCookie(request);headers.delete('x-isp-startup-key');headers.delete(EDGE_IP_HEADER);headers.set('x-isp-staging-key',env.ISP_STAGING_KEY);headers.set(TRACE_HEADER,id);
 const ip=edgeClientIp(request);if(ip)headers.set(EDGE_IP_HEADER,ip);
 return privateResponse(await env.ACCEPTANCE.get(env.ACCEPTANCE.idFromName(SINGLETON)).fetch(new Request(request,{headers})),id);
 }catch{return unavailable(id);}
}};
function checkedState(s){return s&&s.v===1&&Number.isSafeInteger(s.start)&&Number.isSafeInteger(s.end)&&s.end>s.start&&s.end-s.start<=LIMITS.window&&typeof s.attempted==='boolean'&&typeof s.stopped==='boolean'&&typeof s.ready==='boolean'&&Number.isSafeInteger(s.requests)&&s.requests>=0&&s.requests<=LIMITS.requests&&Number.isSafeInteger(s.bytes)&&s.bytes>=0&&s.bytes<=LIMITS.bytes&&['idle','startup','ready','stopped'].includes(s.stage);}
function failure(){return Error('Private acceptance unavailable.');}
async function bounded(action,ms){let timer;try{return await Promise.race([Promise.resolve().then(action),new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure()),Math.max(1,ms));})]);}finally{clearTimeout(timer);}}
export class ISPPrivateAcceptance extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.ctx=ctx;this.env=env;this.active=0;this.work=null;this.stopped=false;this.abort=new AbortController();this.stopWork=null;
 this.initialized=ctx.blockConcurrencyWhile(async()=>{const s=await ctx.storage.get(STATE);this.broken=s!==undefined&&!checkedState(s);if(ctx.container.running&&!checkedState(s)){this.broken=true;await this.stop('stop');return;}if(checkedState(s)){this.stopped=s.stopped;if(s.stopped&&ctx.container.running){await this.stop('stop');return;}if(!s.stopped&&ctx.container.running){if(Date.now()>=s.end){await this.stop('deadline');return;}await ctx.storage.setAlarm(s.end);await ctx.container.setInactivityTimeout(Math.max(1,s.end-Date.now()));this.monitor();}}});
 }
 identity(){return /^[a-f0-9]{64}$/.test(this.ctx.id.toString())&&this.ctx.id.toString()===this.env.ACCEPTANCE.idFromName(SINGLETON).toString();}
 monitor(){if(this.monitoring)return;this.monitoring=true;this.ctx.waitUntil(this.ctx.container.monitor().then(()=>this.stop('exit'),()=>this.stop('exit')).catch(()=>{}));}
 async live(){if(this.stopped||this.abort.signal.aborted||this.broken)throw failure();const window=acceptanceWindow(this.env),s=await this.ctx.storage.get(STATE);if(this.stopped||this.abort.signal.aborted||this.broken||!window||!checkedState(s)||s.stopped||s.start!==window.start||s.end!==window.end||Date.now()>=s.end)throw failure();return s;}
 async change(update){return this.ctx.storage.transaction(async txn=>{const s=await txn.get(STATE);if(!checkedState(s))throw failure();const result=update(s);await txn.put(STATE,s);return result;});}
 async stop(reason='stop'){
 this.stopped=true;this.abort.abort();if(this.stopWork)return this.stopWork;
 this.stopWork=(async()=>{const results=await Promise.allSettled([
  bounded(async()=>{await this.ctx.storage.transaction(async txn=>{const s=await txn.get(STATE);if(checkedState(s)){s.stopped=true;s.ready=false;s.stage='stopped';await txn.put(STATE,s);}else await txn.put(STATE,{v:1,stopped:true});});},5000),
  bounded(()=>this.ctx.container.destroy(),5000)
 ]);const stopped=!this.ctx.container.running,recorded=results[0].status==='fulfilled';if(stopped&&recorded)await this.ctx.storage.deleteAlarm().catch(()=>{});return {version:1,stopped,stop_recorded:recorded,status:stopped&&recorded?'PASS':'FAIL',reason:['stop','deadline','exit','startup','limit','transport'].includes(reason)?reason:'stop'};})();
 const result=await this.stopWork;if(result.status!=='PASS')this.stopWork=null;return result;
 }
 async alarm(){if((await this.stop('deadline')).status!=='PASS')throw failure();}
 async status(){const s=await this.ctx.storage.get(STATE);return {version:1,stage:checkedState(s)?s.stage:'unavailable',running:this.ctx.container.running===true,stopped:this.stopped||s?.stopped===true,rails_up:checkedState(s)&&s.ready&&!s.stopped&&Date.now()<s.end,requests:checkedState(s)?s.requests:null,bytes:checkedState(s)?s.bytes:null,active:this.active,expires_at:checkedState(s)?new Date(s.end).toISOString():null};}
 async record(id,fields){const now=Date.now(),s=await this.ctx.storage.get(STATE);if(!checkedState(s))throw failure();return this.ctx.storage.transaction(async txn=>{const rows=await txn.get(TRACES)??[],old=rows.find(t=>t.id===id);const trace=cleanTrace({id,revision:(old?.revision??-1)+1,started_at:old?.started_at??now,updated_at:now,stage:'backend_http',outcome:'pending',dispatched:false,response_received:false,status:null,operation_id:null,exception_class:null,...old,...fields,revision:(old?.revision??-1)+1,updated_at:now},s.end);if(!trace)throw failure();await txn.put(TRACES,[...rows.filter(t=>t.id!==id),trace].slice(-16));});}
 async countBytes(size){if(!Number.isSafeInteger(size)||size<0)throw failure();try{await this.change(s=>{if(s.stopped||Date.now()>=s.end||s.bytes+size>LIMITS.bytes)throw failure();s.bytes+=size;});}catch{await this.stop('limit');throw failure();}}
 async ensureStarted(){
 if(this.work)return this.work;
 this.work=(async()=>{let s=await this.live();const config=acceptanceRuntime(this.env);if(!config||this.ctx.container.images.rails!==IMAGE)throw failure();if(s.ready){if(!this.ctx.container.running)throw failure();return;}if(this.ctx.container.running)throw failure();
 await this.change(s=>{if(s.attempted||s.stopped)throw failure();s.attempted=true;s.stage='startup';});
 await this.ctx.storage.setAlarm(s.end);await this.live();if(this.stopped||this.abort.signal.aborted||Date.now()>=s.end)throw failure();
 this.ctx.container.start({image:this.ctx.container.images.rails,instance:'standard-2',enableInternet:true,env:config.containerEnv});this.monitor();
 const until=Math.min(s.end,Date.now()+LIMITS.startup);let up=false;
 while(Date.now()<until){await this.live();await this.change(s=>{if(s.requests>=LIMITS.requests)throw failure();s.requests++;});
 try{const controller=new AbortController(),signal=AbortSignal.any([this.abort.signal,controller.signal]),probe=requestForRails(new Request('https://'+HOST+'/up',{signal}),HOST,null);let response;try{response=await bounded(()=>this.ctx.container.getTcpPort(3000).fetch(probe),Math.min(3000,until-Date.now()));}finally{controller.abort();}void response.body?.cancel().catch(()=>{});if(response.status===200){up=true;break;}}catch{if(this.stopped)throw failure();}
 if(Date.now()<until)await bounded(()=>new Promise(resolve=>setTimeout(resolve,250)),Math.max(1,until-Date.now()));}
 if(!up)throw failure();await this.live();await this.ctx.container.setInactivityTimeout(Math.max(1,s.end-Date.now()));await this.change(s=>{if(s.stopped||Date.now()>=s.end)throw failure();s.ready=true;s.stage='ready';});
 })().catch(async()=>{await this.stop('startup');throw failure();});return this.work;
 }
 async fetch(request){const id=traceId(request);let release;
 try{if(!validTarget(request)||!keyMatches(request.headers.get('x-isp-staging-key'),this.env)||!this.identity())return unavailable(id);
 const ctl=control(request);if(ctl==='stop')return Response.json(await this.stop(),{headers:{'Cache-Control':'no-store'}});
 await this.initialized;if(ctl==='status')return Response.json(await this.status(),{headers:{'Cache-Control':'no-store'}});
 const u=new URL(request.url);if(u.pathname.startsWith('/__isp_acceptance')||u.pathname.startsWith('/__isp_review'))return unavailable(id);
 if(u.pathname.startsWith('/__isp_diagnostics')){if(request.method!=='GET'||u.search||!u.pathname.startsWith(DIAGNOSTICS)||!validUuid(u.pathname.slice(DIAGNOSTICS.length)))return unavailable(id);const rows=await this.ctx.storage.get(TRACES)??[],trace=rows.find(t=>t.id===u.pathname.slice(DIAGNOSTICS.length));return Response.json({version:1,trace:trace??null},{status:trace?200:404,headers:{'Cache-Control':'no-store'}});}
 const window=acceptanceWindow(this.env);if(!window||this.broken||this.stopped)return unavailable(id);
 if(await this.ctx.storage.get(STATE)===undefined)await this.ctx.storage.transaction(async txn=>{if(await txn.get(STATE)===undefined)await txn.put(STATE,{v:1,...window,attempted:false,stopped:false,ready:false,requests:0,bytes:0,stage:'idle'});});
 await this.live();if(this.active>=LIMITS.concurrent)return quiet(429);this.active++;let released=false,timer;const controller=new AbortController();
 release=()=>{if(released)return;released=true;controller.abort();if(reader)void reader.cancel().catch(()=>{});clearTimeout(timer);request.signal.removeEventListener('abort',cancel);this.abort.signal.removeEventListener('abort',cancel);this.active--;};
 let reader,output,outputController;const writing=!['GET','HEAD','OPTIONS'].includes(request.method);const cancel=()=>{controller.abort();if(reader)void reader.cancel().catch(()=>{});if(output)void output.cancel().catch(()=>{});try{outputController?.error(failure());}catch{}if(writing&&this.work&&!this.stopped)void this.stop('transport');release();};request.signal.addEventListener('abort',cancel,{once:true});this.abort.signal.addEventListener('abort',cancel,{once:true});timer=setTimeout(cancel,Math.max(1,Math.min(600000,window.end-Date.now())));if(request.signal.aborted||this.abort.signal.aborted)cancel();
 const length=request.headers.get('Content-Length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>LIMITS.upload))throw failure();
 await this.change(s=>{if(s.stopped||Date.now()>=s.end||s.requests>=LIMITS.requests)throw failure();s.requests++;});await this.record(id,{stage:'startup'});await this.ensureStarted();await this.live();if(controller.signal.aborted)throw failure();
 let inbound=0;const meterUpload=request.body?new ReadableStream({start(c){reader=request.body.getReader();},pull:async c=>{try{const chunk=await reader.read();if(chunk.done){c.close();return;}inbound+=chunk.value.byteLength;if(inbound>LIMITS.upload)throw failure();await this.countBytes(chunk.value.byteLength);if(controller.signal.aborted)throw failure();c.enqueue(chunk.value);}catch{controller.abort();await this.stop('limit');c.error(failure());}},cancel:async()=>{await reader?.cancel().catch(()=>{});}}):null;
 const headers=headersWithoutReviewCookie(request);headers.delete('x-isp-staging-key');headers.delete('x-isp-startup-key');headers.delete('content-length');const clientIp=headers.get(EDGE_IP_HEADER);
 const clean=new Request(request,{headers,body:meterUpload,signal:controller.signal,duplex:'half'}),backend=requestForRails(clean,HOST,clientIp);backend.headers.set(TRACE_HEADER,id);
 await this.record(id,{stage:u.pathname==='/ready'?'application_readiness':'backend_http',dispatched:true});await this.live();if(controller.signal.aborted)throw failure();
 const response=await bounded(()=>this.ctx.container.getTcpPort(3000).fetch(backend),Math.max(1,Math.min(600000,window.end-Date.now())));const correlated=response.headers.get(TRACE_HEADER)===id;await this.record(id,{outcome:'response',response_received:true,status:response.status,operation_id:correlated&&validUuid(response.headers.get('x-isp-diagnostic-operation'))?response.headers.get('x-isp-diagnostic-operation'):null,exception_class:correlated?className(response.headers.get('x-isp-diagnostic-exception')):null});
 if(response.status>=500&&writing)await this.stop('transport');const safe=privateResponse(response,id);if(!safe.body){release();return safe;}output=safe.body.getReader();let ended=false;
 const body=new ReadableStream({start(c){outputController=c;},pull:async c=>{try{if(controller.signal.aborted)throw failure();const part=await output.read();if(part.done){ended=true;c.close();release();return;}await this.countBytes(part.value.byteLength);if(controller.signal.aborted)throw failure();c.enqueue(part.value);}catch{ended=true;void output.cancel().catch(()=>{});c.error(failure());if(!['GET','HEAD','OPTIONS'].includes(request.method))await this.stop('transport');release();}},cancel:async()=>{if(!ended)await output.cancel().catch(()=>{});if(!['GET','HEAD','OPTIONS'].includes(request.method))await this.stop('transport');release();}});
 return new Response(body,safe);
 }catch{release?.();try{await this.record(id,{stage:'transport',outcome:'failed'});}catch{}if(!['GET','HEAD','OPTIONS'].includes(request.method)&&this.work)await this.stop('transport');return unavailable(id);}
 }
}

// A fresh namespace preserves the previous controller and its permanent stop latch.
export class ISPPrivateAcceptanceContinuation extends ISPPrivateAcceptance {}
