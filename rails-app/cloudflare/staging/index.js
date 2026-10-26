import { RailsContainer as BaseRailsContainer, fetchWithTrace } from '../src/index.js';
import {validUuid} from '../src/diagnostics.js';
import {storeTrace,readTrace} from './diagnostics.js';
import { unavailable } from '../src/runtime.js';
import { browserAccessEndpoint, validBrowserCookie, headersWithoutReviewCookie } from './browser-access.js';
const HOST='isp-member-production.meithan-r.workers.dev',KEY_HEADER='x-isp-staging-key';
const DEADLINE_KEY='isp:staging:earliest-deadline',EXPIRED_KEY='isp:staging:expired';
const MAX_WINDOW_MS=55*60*1000;
function utcSeconds(value) {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value))return null;
 const time=Date.parse(value);
 return Number.isFinite(time)&&new Date(time).toISOString().replace('.000Z','Z')===value?time:null;
}
export function stagingWindow(env={}) {
 const start=utcSeconds(env.ISP_STAGING_START_AT),end=utcSeconds(env.ISP_STAGING_EXPIRES_AT);
 return start!==null&&end!==null&&end>start&&end-start<=MAX_WINDOW_MS?{start,end}:null;
}
function matchesKey(supplied,expected) {
 if(typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected)||!/^[a-f0-9]{64}$/.test(supplied))return false;
 let difference=0;for(let i=0;i<64;i++)difference|=expected.charCodeAt(i)^supplied.charCodeAt(i);
 return difference===0;
}
function keyMatches(request,env){return matchesKey(request.headers.get(KEY_HEADER)||'',env.ISP_STAGING_KEY);}
function validContext(env,now=Date.now(),deadline=Infinity) {
 const window=stagingWindow(env);
 return !!window&&env.ISP_CONTAINER_ENABLED==='true'&&env.APP_HOST===HOST&&env.ISP_ACCOUNT_EMAILS_ENABLED==='false'&&env.ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED==='false'&&env.ISP_DEMO_MODE==='false'&&now>=window.start&&now<Math.min(window.end,deadline);
}
export function allowedStagingRequest(request,env,now=Date.now(),deadline=Infinity) {return validContext(env,now,deadline)&&keyMatches(request,env);}
export function deadlineRequest(request,deadline,stripKey=false) {
 const headers=new Headers(request.headers);if(stripKey)headers.delete(KEY_HEADER);
 return new Request(request,{headers,cf:request.cf,signal:AbortSignal.any([request.signal,AbortSignal.timeout(Math.max(1,Math.ceil(deadline-Date.now())))])});
}
const DIAGNOSTIC_PREFIX='/__isp_diagnostics/';
function diagnosticLookupId(request){
 const url=new URL(request.url);
 if(!url.pathname.startsWith('/__isp_diagnostics'))return undefined;
 const id=url.pathname.slice(DIAGNOSTIC_PREFIX.length);
 return request.method==='GET'&&url.pathname.startsWith(DIAGNOSTIC_PREFIX)&&!url.search&&!url.hash&&validUuid(id)?id:null;
}
export class RailsContainer extends BaseRailsContainer {
 async recordDiagnostic(trace,options){return storeTrace(this.ctx.storage,trace,{...options,deadline:this.armedDeadline});}
 isDiagnosticLeaseExpired(){const window=stagingWindow(this.env);return this.expired||!window||Date.now()>=Math.min(window.end,this.armedDeadline??Infinity);}
 async diagnosticResponse(request,id){
  const url=new URL(request.url);
  if(!id||url.hostname!==HOST||url.port||url.username||url.password||request.headers.has('upgrade')||!allowedStagingRequest(request,this.env))return unavailable();
  try{
   const window=stagingWindow(this.env);
   const [stored,expired]=await Promise.all([this.ctx.storage.get(DEADLINE_KEY),this.ctx.storage.get(EXPIRED_KEY)]);
   if(!Number.isSafeInteger(stored)||stored<=0||expired===true||(expired!==undefined&&expired!==false))return unavailable();
   const cutoff=Math.min(window.end,stored,this.armedDeadline??Infinity);
   if(this.expired||!allowedStagingRequest(request,this.env,Date.now(),cutoff))return unavailable();
   const trace=await readTrace(this.ctx.storage,id,stored);
   if(this.expired||!allowedStagingRequest(request,this.env,Date.now(),cutoff))return unavailable();
   return new Response(JSON.stringify(trace?{version:1,trace}:{error:'Diagnostic unavailable'}),{
    status:trace?200:404,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}
   });
  }catch{return unavailable();}
 }
 sleepAfter='60s';
 async armDeadline(proposed) {
  if(this.arming)return this.arming;
  this.arming=(async()=>{
   const stored=await this.ctx.storage.get(DEADLINE_KEY);
   if(stored!==undefined&&(!Number.isSafeInteger(stored)||stored<=0))throw new Error('Invalid staging deadline state.');
   this.expired=await this.ctx.storage.get(EXPIRED_KEY)===true;
   this.armedDeadline=Math.min(proposed,stored??Infinity,this.armedDeadline??Infinity);
   await this.ctx.storage.put(DEADLINE_KEY,this.armedDeadline);
   if(this.expired)return 0;
   const schedules=await this.listSchedules('expireStaging');
   if(!schedules.some(s=>s.time*1000<=this.armedDeadline))await this.schedule(new Date(this.armedDeadline),'expireStaging');
   return this.armedDeadline;
  })();
  try{return await this.arming;}finally{this.arming=undefined;}
 }
 async fetch(request) {
  const lookup=diagnosticLookupId(request);
  if(lookup!==undefined)return this.diagnosticResponse(request,lookup);
  const window=stagingWindow(this.env);
  if(!allowedStagingRequest(request,this.env,Date.now(),this.armedDeadline??Infinity)) {
   if(!window||this.expired||Date.now()>=Math.min(window.end,this.armedDeadline??Infinity))try{await this.expireStaging();}catch{}
   return unavailable();
  }
  try {
   const deadline=await this.armDeadline(window.end);
   if(this.expired||Date.now()>=deadline){await this.expireStaging();return unavailable();}
   return await super.fetch(deadlineRequest(request,deadline,true));
  }catch{return unavailable();}
 }
 async startAndWaitForPorts(options={}) {
  if(this.expired||!this.armedDeadline||Date.now()>=this.armedDeadline)throw new Error('Staging window is closed.');
  // Shared startup is independent of a cancelled caller, but never of the lease.
  const signals=[AbortSignal.timeout(Math.max(1,Math.ceil(this.armedDeadline-Date.now())))];
  if(options.cancellationOptions?.abort)signals.push(options.cancellationOptions.abort);
  await super.startAndWaitForPorts({...options,cancellationOptions:{
   ...options.cancellationOptions,abort:AbortSignal.any(signals)
  }});
  if(this.expired||Date.now()>=this.armedDeadline){await this.expireStaging();throw new Error('Staging window is closed.');}
 }
 async expireStaging() {
  let stored,retry=false;
  try{stored=await this.ctx.storage.get(DEADLINE_KEY);if(stored!==undefined&&(!Number.isSafeInteger(stored)||stored<=0))retry=true;}catch{retry=true;}
  const window=stagingWindow(this.env);
  const deadline=Math.min(Number.isSafeInteger(stored)&&stored>0?stored:Infinity,window?.end??0,this.armedDeadline??Infinity);
  if(!retry&&!this.expired&&Date.now()<deadline){await this.schedule(new Date(deadline),'expireStaging');return;}
  this.expired=true;
  try{await this.ctx.storage.put(EXPIRED_KEY,true);}catch{retry=true;}
  try{if(this.ctx.container.running||this.activeRequests>0)await this.destroy();}catch{retry=true;}
  if(retry)try{await this.schedule(5,'expireStaging');}catch{throw new Error('Staging shutdown retry could not be scheduled.');}
 }
 renewActivityTimeout() {
  const window=stagingWindow(this.env),deadline=Math.min(window?.end??0,this.armedDeadline??Infinity);
  if(!window||this.expired||Date.now()>=deadline)return;
  super.renewActivityTimeout();
  // SDK activity renewal must never move idle shutdown past the fixed cutoff.
  this.sleepAfterMs=Math.min(this.sleepAfterMs??Date.now()+60000,deadline);
 }
 async onActivityExpired() {
  const window=stagingWindow(this.env);let stored;
  try{stored=await this.ctx.storage.get(DEADLINE_KEY);}catch{await this.expireStaging();return;}
  if(!window||this.expired||!Number.isSafeInteger(stored)||Date.now()>=Math.min(window.end,stored)){await this.expireStaging();return;}
  await super.onActivityExpired();
 }
}
export default {async fetch(request,env) {
 if(!validContext(env))return unavailable();
 try {
  const url=new URL(request.url),window=stagingWindow(env);
  if(url.protocol!=='https:'||url.hostname!==HOST||url.port||request.headers.has('upgrade'))return unavailable();
  const lookup=diagnosticLookupId(request);
  if(lookup!==undefined&&(!lookup||!keyMatches(request,env)))return unavailable();
  const access=await browserAccessEndpoint(request,env,window,value=>matchesKey(value,env.ISP_STAGING_KEY));
  if(access)return access;
  if(!keyMatches(request,env)&&!await validBrowserCookie(request,env,window)){
   if(request.method==='GET'&&(request.headers.get('Accept')||'').includes('text/html'))return new Response('',{status:303,headers:{Location:'/__isp_review','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
   return unavailable();
  }
  if(Date.now()>=window.end)return unavailable();
  const headers=headersWithoutReviewCookie(request);headers.set(KEY_HEADER,env.ISP_STAGING_KEY);
  const trustedTrace=keyMatches(request,env)&&validUuid(request.headers.get('x-isp-trace'))?request.headers.get('x-isp-trace'):null;
  return await fetchWithTrace(deadlineRequest(new Request(request,{headers,cf:request.cf}),window.end),env,trustedTrace);
 }catch{return unavailable();}
}};