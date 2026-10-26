import coreWorker, { RailsContainer as BaseRailsContainer } from '../src/index.js';
import { unavailable } from '../src/runtime.js';
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
function keyMatches(request,env) {
 const expected=env.ISP_STAGING_KEY,supplied=request.headers.get(KEY_HEADER)||'';
 if(typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected)||!/^[a-f0-9]{64}$/.test(supplied))return false;
 let difference=0;for(let i=0;i<64;i++)difference|=expected.charCodeAt(i)^supplied.charCodeAt(i);
 return difference===0;
}
export function allowedStagingRequest(request,env,now=Date.now(),deadline=Infinity) {
 const window=stagingWindow(env);
 return !!window&&env.ISP_CONTAINER_ENABLED==='true'&&env.APP_HOST===HOST&&env.ISP_ACCOUNT_EMAILS_ENABLED==='false'&&env.ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED==='false'&&env.ISP_DEMO_MODE==='false'&&now>=window.start&&now<Math.min(window.end,deadline)&&keyMatches(request,env);
}
export function deadlineRequest(request,deadline,stripKey=false) {
 const headers=new Headers(request.headers);if(stripKey)headers.delete(KEY_HEADER);
 return new Request(request,{headers,cf:request.cf,signal:AbortSignal.any([request.signal,AbortSignal.timeout(Math.max(1,Math.ceil(deadline-Date.now())))])});
}
export class RailsContainer extends BaseRailsContainer {
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
 async startAndWaitForPorts(...args) {
  if(this.expired||!this.armedDeadline||Date.now()>=this.armedDeadline)throw new Error('Staging window is closed.');
  await super.startAndWaitForPorts(...args);
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
 if(!allowedStagingRequest(request,env))return unavailable();
 try{return await coreWorker.fetch(deadlineRequest(request,stagingWindow(env).end),env);}catch{return unavailable();}
}};