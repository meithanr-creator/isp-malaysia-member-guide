// Native Durable Object adapter for the fixed lease4 singleton. Old classes are unchanged.
import {DurableObject} from 'cloudflare:workers';
import {TRACE_HEADER, validUuid, className} from '../src/diagnostics.js';
import {beginRequest} from '../src/lifetime.js';
import {INSTANCE_NAME, EDGE_IP_HEADER, runtimeConfiguration, unavailable, validClientIp, requestForRails, privateResponse} from '../src/runtime.js';
import {storeTrace, readTrace} from './diagnostics.js';
export const LEASE4_IMAGE_ALIAS = 'rails';
export const LEASE4_IMAGE_REF = 'registry.cloudflare.com/a9720867333b64a4f8ee70cdfd673eb9/isp-member-rails@sha256:152480a896060eae82a380dc54f651e199ff1585cd5dd805d0d51b9f3a587d2a';
export const LEASE4_LIMITS = Object.freeze({window:55*60000,idle:60000,startup:370000,probe:5000,poll:250,destroy:5000});
const APPLICATION_READINESS_TTL_MS=2000, APPLICATION_READINESS_TIMEOUT_MS=5000;
const HOST='isp-member-production.meithan-r.workers.dev', KEY_HEADER='x-isp-staging-key';
const DEADLINE_KEY='isp:staging:earliest-deadline', EXPIRED_KEY='isp:staging:expired';
const HEALTH_PATHS=new Set(['/up','/app-ready','/ready']);
const need=value=>{if(!value)throw Error('Native staging boundary unavailable');};
function utc(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value))return NaN;const time=Date.parse(value);return Number.isFinite(time)&&new Date(time).toISOString().replace('.000Z','Z')===value?time:NaN;}
export function nativeLease4Settings(env,now=Date.now()){
 const start=utc(env.ISP_STAGING_START_AT),end=utc(env.ISP_STAGING_EXPIRES_AT),settings=runtimeConfiguration(env);
 if(!settings||env.ISP_STAGING_LEASE!=='rails-staging-4'||settings.host!==HOST||env.DB_SSLMODE!=='verify-full'||env.ISP_DEMO_MODE!=='false'||env.ISP_ACCOUNT_EMAILS_ENABLED!=='false'||env.ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED!=='false'||env.ISP_CONTAINER_SCHEDULING_POLICY!=='durable_object'||env.ISP_CONTAINER_IMAGE_NAME!==LEASE4_IMAGE_ALIAS||env.ISP_CONTAINER_INSTANCE_TYPE!=='standard-2'||env.ISP_CONTAINER_SINGLETON_NAME!==INSTANCE_NAME||!/^[a-f0-9]{64}$/.test(env.ISP_STAGING_KEY||'')||!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>LEASE4_LIMITS.window||now<start||now>=end)return null;
 return {...settings,start,end};
}
function matchesKey(actual,expected){if(!/^[a-f0-9]{64}$/.test(actual||'')||!/^[a-f0-9]{64}$/.test(expected||''))return false;let difference=0;for(let i=0;i<64;i++)difference|=actual.charCodeAt(i)^expected.charCodeAt(i);return difference===0;}
function waitForProbe(promise,signal){return bounded(promise,Infinity,signal).catch(()=>false);}
function bounded(promise,ms,signal){
 return new Promise((resolve,reject)=>{let settled=false,timer;const finish=(ok,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);ok?resolve(value):reject(value);};const abort=()=>finish(false,Error('Native staging operation ended'));if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});if(Number.isFinite(ms))timer=setTimeout(abort,Math.max(1,Math.ceil(ms)));Promise.resolve(promise).then(value=>finish(true,value),error=>finish(false,error));});
}
function cancelBody(response){try{void response?.body?.cancel().catch(()=>{});}catch{}}
export class RailsStaging4 extends DurableObject {
 activeRequests=0; lifecycleGeneration=0; portReady=false; startup=null; applicationReadiness=null; applicationReadyUntil=0; applicationReadinessGeneration=0;
 expired=false; fatal=false; armedDeadline=null; lastActivity=Date.now(); leaseRefresh=null; monitorRecord=null; stopping=null; deadlineAbort=new AbortController();
 constructor(ctx,env){super(ctx,env);this.ready=Promise.resolve(ctx.blockConcurrencyWhile(()=>this.initialize())).catch(async()=>{this.fatal=true;try{await this.expire();}catch{}return false;});}
 identityAllowed(){try{return this.env.ISP_CONTAINER_SINGLETON_NAME===INSTANCE_NAME&&/^[a-f0-9]{64}$/.test(this.ctx.id.toString())&&this.ctx.id.toString()===this.env.RAILS_CONTAINER.idFromName(INSTANCE_NAME).toString();}catch{return false;}}
 async initialize(){
  if(!this.identityAllowed()||!nativeLease4Settings(this.env)){if(this.ctx.container?.running)await this.expire();return false;}
  await this.refreshLease();
  if(this.ctx.container.running){this.observeMonitor();await this.armIdle();}
  return true;
 }
 async refreshLease(){
  if(this.leaseRefresh)return this.leaseRefresh;
  this.leaseRefresh=(async()=>{need(this.identityAllowed()&&!this.fatal&&!this.expired);const settings=nativeLease4Settings(this.env);need(settings);
   const [stored,expired]=await Promise.all([this.ctx.storage.get(DEADLINE_KEY),this.ctx.storage.get(EXPIRED_KEY)]);
   need(stored===undefined||(Number.isSafeInteger(stored)&&stored>0));need(expired===undefined||typeof expired==='boolean');
   this.armedDeadline=Math.min(settings.end,stored??Infinity,this.armedDeadline??Infinity);
   if(expired===true||Date.now()>=this.armedDeadline){await this.expire();throw Error('Native staging lease ended');}
   if(stored!==this.armedDeadline)await this.ctx.storage.put(DEADLINE_KEY,this.armedDeadline);
   await this.ctx.storage.setAlarm(this.ctx.container.running?Math.min(this.armedDeadline,this.lastActivity+LEASE4_LIMITS.idle):this.armedDeadline);return settings;
  })();try{return await this.leaseRefresh;}finally{this.leaseRefresh=null;}
 }
 invalidateApplicationReadiness(){this.applicationReadinessGeneration++;this.applicationReadyUntil=0;const old=this.applicationReadiness;this.applicationReadiness=null;old?.controller.abort();}
 invalidateLifecycle(){this.lifecycleGeneration++;this.portReady=false;const old=this.startup;this.startup=null;old?.controller.abort();this.invalidateApplicationReadiness();}
 observeMonitor(){
  if(this.monitorRecord)return;
  const entry={generation:this.lifecycleGeneration,promise:null};this.monitorRecord=entry;
  entry.promise=Promise.resolve().then(()=>this.ctx.container.monitor()).then(()=>this.monitorEnded(entry),()=>this.monitorEnded(entry));
  this.ctx.waitUntil(entry.promise);
 }
 async monitorEnded(entry){if(this.monitorRecord!==entry)return;this.monitorRecord=null;this.invalidateLifecycle();if(this.ctx.container.running)await this.stopCurrent();}
 async stopCurrent(){
  if(this.stopping)return this.stopping;
  this.invalidateLifecycle();this.monitorRecord=null;
  this.stopping=(async()=>{await bounded(this.ctx.container.destroy(),LEASE4_LIMITS.destroy);need(!this.ctx.container.running);})();
  try{await this.stopping;}catch(error){this.fatal=true;throw error;}finally{this.stopping=null;}
 }
 async expire(){
  this.expired=true;this.deadlineAbort.abort();this.invalidateLifecycle();let failed=false;
  const results=await Promise.allSettled([bounded(this.ctx.storage.put(EXPIRED_KEY,true),LEASE4_LIMITS.destroy),this.stopCurrent()]);failed=results.some(result=>result.status==='rejected');
  if(failed){try{await this.ctx.storage.setAlarm(Date.now()+5000);}catch{}throw Error('Native staging shutdown unconfirmed');}
 }
 async armIdle(){need(!this.expired&&!this.fatal&&this.armedDeadline>Date.now());await this.ctx.container.setInactivityTimeout(Math.min(LEASE4_LIMITS.idle,this.armedDeadline-Date.now()));await this.ctx.storage.setAlarm(Math.min(this.armedDeadline,this.lastActivity+LEASE4_LIMITS.idle));}
 renewActivityTimeout(){
  if(this.expired||this.fatal||!this.armedDeadline)return;this.lastActivity=Date.now();
  const work=(Date.now()>=this.armedDeadline?this.expire():(this.ctx.container.running?this.armIdle():this.ctx.storage.setAlarm(this.armedDeadline))).catch(async()=>{this.fatal=true;try{await this.expire();}catch{}});this.ctx.waitUntil(work);
 }
 async alarm(){
  try{if(!this.identityAllowed()){await this.expire();return;}await this.refreshLease();
   if(Date.now()>=this.armedDeadline){await this.expire();return;}
   if(this.activeRequests>0){this.renewActivityTimeout();return;}
   if(Date.now()>=this.lastActivity+LEASE4_LIMITS.idle){if(this.ctx.container.running||this.startup)await this.stopCurrent();else this.invalidateLifecycle();await this.ctx.storage.setAlarm(this.armedDeadline);return;}
   await this.armIdle();
  }catch{try{await this.expire();}catch{throw Error('Native staging shutdown unconfirmed');}}
 }
 async fetchPort(port,request,signal,limit=Infinity){
  need(!signal.aborted&&!this.expired&&!this.fatal&&this.armedDeadline>Date.now());
  const duration=Math.min(limit,this.armedDeadline-Date.now());need(Number.isFinite(duration)&&duration>0);
  const operationSignal=AbortSignal.any([request.signal,signal,this.deadlineAbort.signal,AbortSignal.timeout(Math.max(1,Math.ceil(duration)))]);
  const dispatched=new Request(request,{signal:operationSignal});let response,accepted=false;
  const pending=Promise.resolve().then(()=>{need(!operationSignal.aborted&&!this.expired&&!this.fatal&&this.armedDeadline>Date.now());return port.fetch(dispatched);});
  pending.then(value=>{response=value;if(operationSignal.aborted&&!accepted)cancelBody(value);},()=>{});
  try{const value=await bounded(pending,duration,operationSignal);accepted=true;return value;}catch(error){cancelBody(response);pending.then(cancelBody,()=>{});throw error;}
 }

 async railsPort(requestSignal){
  if(this.portReady&&!this.ctx.container.running)this.invalidateLifecycle();
  if(!this.portReady){if(!this.startup){
   const entry={generation:this.lifecycleGeneration,controller:new AbortController(),promise:null};this.startup=entry;
   entry.promise=(async()=>{try{
    const settings=await this.refreshLease();if(this.stopping)await this.stopping;
    need(this.identityAllowed()&&this.startup===entry&&!entry.controller.signal.aborted&&!this.expired&&!this.fatal&&Date.now()<this.armedDeadline&&nativeLease4Settings(this.env));
    need(this.ctx.container.images?.[LEASE4_IMAGE_ALIAS]===LEASE4_IMAGE_REF);
    if(!this.ctx.container.running){this.monitorRecord=null;this.ctx.container.start({image:this.ctx.container.images[LEASE4_IMAGE_ALIAS],instance:'standard-2',env:settings.containerEnv,enableInternet:true,labels:{lease:'rails-staging-4',actor:this.ctx.id.toString()}});this.observeMonitor();}
    else this.observeMonitor();
    const until=Math.min(Date.now()+LEASE4_LIMITS.startup,this.armedDeadline),signal=AbortSignal.any([entry.controller.signal,this.deadlineAbort.signal,AbortSignal.timeout(Math.max(1,until-Date.now()))]);
    while(Date.now()<until){need(this.startup===entry&&this.lifecycleGeneration===entry.generation&&!signal.aborted&&!this.expired);
     if(this.ctx.container.running){const info=await bounded(this.ctx.container.inspect(),Math.min(LEASE4_LIMITS.probe,until-Date.now()),signal);
      if(info?.image){need(info.image===LEASE4_IMAGE_REF&&info.labels?.lease==='rails-staging-4'&&info.labels?.actor===this.ctx.id.toString());
       const port=this.ctx.container.getTcpPort(3000);try{const response=await this.fetchPort(port,requestForRails(new Request('https://'+HOST+'/up'),HOST,null),signal,LEASE4_LIMITS.probe);const ready=response.status===200;cancelBody(response);if(ready){need(this.startup===entry&&this.lifecycleGeneration===entry.generation&&!signal.aborted);this.portReady=true;await this.armIdle();return true;}}catch(error){if(signal.aborted)throw error;}
      }
     }
     await bounded(new Promise(resolve=>setTimeout(resolve,LEASE4_LIMITS.poll)),until-Date.now(),signal);
    }throw Error('Native startup readiness unavailable');
   }catch{if(this.startup===entry&&this.lifecycleGeneration===entry.generation){this.invalidateLifecycle();try{await this.stopCurrent();}catch{this.fatal=true;}}return false;}finally{if(this.startup===entry)this.startup=null;}})();
  }const pending=this.startup;if(!pending||!await waitForProbe(pending.promise,requestSignal))return null;if(this.lifecycleGeneration!==pending.generation||!this.portReady||!this.ctx.container.running)return null;}
  return this.ctx.container.getTcpPort(3000);
 }
 async applicationReady(port,settings,requestSignal){
  if(requestSignal.aborted)return false;if(this.applicationReadyUntil>Date.now())return true;
  if(!this.applicationReadiness){const generation=this.applicationReadinessGeneration,entry={controller:new AbortController(),promise:null};this.applicationReadiness=entry;
   entry.promise=(async()=>{try{const signal=AbortSignal.any([entry.controller.signal,this.deadlineAbort.signal,AbortSignal.timeout(APPLICATION_READINESS_TIMEOUT_MS)]),response=await this.fetchPort(port,requestForRails(new Request('https://'+settings.host+'/app-ready'),settings.host,null),signal,APPLICATION_READINESS_TIMEOUT_MS);const ready=response.status===200;cancelBody(response);if(generation!==this.applicationReadinessGeneration)return false;if(!ready){this.invalidateApplicationReadiness();return false;}this.applicationReadyUntil=Math.min(Date.now()+APPLICATION_READINESS_TTL_MS,this.armedDeadline);return true;}catch{if(generation===this.applicationReadinessGeneration)this.invalidateApplicationReadiness();return false;}finally{if(this.applicationReadiness===entry)this.applicationReadiness=null;}})();
  }return waitForProbe(this.applicationReadiness.promise,requestSignal);
 }
 async fetch(request){
  try{if(!await this.ready||!this.identityAllowed())return unavailable();const settings=await this.refreshLease(),url=new URL(request.url);
   if(url.protocol!=='https:'||url.hostname!==HOST||url.port||url.username||url.password||request.headers.has('upgrade')||!matchesKey(request.headers.get(KEY_HEADER),this.env.ISP_STAGING_KEY))return unavailable();
   if(url.pathname.startsWith('/__isp_diagnostics')){const prefix='/__isp_diagnostics/',id=url.pathname.slice(prefix.length);if(request.method!=='GET'||!url.pathname.startsWith(prefix)||url.search||url.hash||!validUuid(id))return unavailable();const trace=await readTrace(this.ctx.storage,id,this.armedDeadline);await this.refreshLease();return new Response(JSON.stringify(trace?{version:1,trace}:{error:'Diagnostic unavailable'}),{status:trace?200:404,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});}
   const headers=new Headers(request.headers);headers.delete(KEY_HEADER);const signal=AbortSignal.any([request.signal,this.deadlineAbort.signal,AbortSignal.timeout(Math.max(1,this.armedDeadline-Date.now()))]);return await this.proxyFetch(new Request(request,{headers,signal}));
  }catch{if(this.armedDeadline&&Date.now()>=this.armedDeadline)try{await this.expire();}catch{}return unavailable();}
 }
  async recordDiagnostic(trace, options) { return storeTrace(this.ctx.storage, trace, {...options, deadline: this.armedDeadline}); }
  isDiagnosticLeaseExpired() { return this.expired || !this.armedDeadline || Date.now() >= this.armedDeadline; }
  async diagnosticEvent(trace, changes, {required = false, admit = false} = {}) {
    Object.assign(trace, changes);
    trace.updated_at = Date.now(); trace.revision += 1;
    let recorded = false;
    try { recorded = await this.recordDiagnostic({...trace}, {admit}); } catch {}
    if (required && recorded !== true) throw Error("Diagnostic persistence unavailable");
  }
  async proxyFetch(request) {
    const now = Date.now();
    const trace = {id: validUuid(request.headers.get(TRACE_HEADER)) ? request.headers.get(TRACE_HEADER) : crypto.randomUUID(),
      revision: 0, started_at: now, updated_at: now, stage: "startup", outcome: "pending",
      dispatched: false, response_received: false, status: null, operation_id: null, exception_class: null};
    let admitted = false, backendStarted = false;
    const settings = runtimeConfiguration(this.env);
    const clientIp = request.headers.get(EDGE_IP_HEADER);
    if (!settings || !validClientIp(clientIp)) return unavailable(trace.id);

    const lifetime = beginRequest(this, request.signal);
    let requestGeneration = this.lifecycleGeneration;
    try {
      const url = new URL(request.url);
      if (url.hostname !== settings.host) {
        lifetime.release();
        return unavailable(trace.id);
      }
      await this.diagnosticEvent(trace, {}, {required: true, admit: true});
      admitted = true;
      this.envVars = settings.containerEnv;
      const port = await this.railsPort(lifetime.signal);
      if (!port) {
        await this.diagnosticEvent(trace, {stage: this.isDiagnosticLeaseExpired() ? 'lease' : 'startup', outcome: 'failed'});
        lifetime.release();
        return unavailable(trace.id);
      }
      requestGeneration = this.lifecycleGeneration;
      this.renewActivityTimeout();

      if (!HEALTH_PATHS.has(url.pathname)) await this.diagnosticEvent(trace, {stage: 'application_readiness'});
      if (!HEALTH_PATHS.has(url.pathname) &&
          !await this.applicationReady(port, settings, lifetime.signal)) {
        await this.diagnosticEvent(trace, {stage: this.isDiagnosticLeaseExpired() ? 'lease' : 'application_readiness', outcome: 'failed'});
        lifetime.release();
        return unavailable(trace.id);
      }

      if (requestGeneration !== this.lifecycleGeneration || !this.portReady) {
        lifetime.release();
        return unavailable(trace.id);
      }

      // Forward once. Authorization, upload scans and download checks remain
      // authoritative for every operation and are never cached here.
      const forwarded = new Request(
        requestForRails(request, settings.host, clientIp),
        { signal: lifetime.signal }
      );
      forwarded.headers.set(TRACE_HEADER, trace.id);
      // Durable dispatch intent precedes send; it does not prove Rails received it.
      await this.diagnosticEvent(trace, {stage: "backend_http", outcome: "pending", dispatched: true}, {required: true});
      await this.refreshLease();
      if (lifetime.signal.aborted || requestGeneration !== this.lifecycleGeneration) throw Error('Request lifetime ended');
      backendStarted = true;
      const response = await this.fetchPort(port, forwarded, lifetime.signal);
      const correlated = response.headers.get(TRACE_HEADER) === trace.id;
      await this.diagnosticEvent(trace, {stage: "backend_http", outcome: "response", response_received: true,
        status: response.status,
        operation_id: correlated && validUuid(response.headers.get("x-isp-diagnostic-operation")) ? response.headers.get("x-isp-diagnostic-operation") : null,
        exception_class: correlated ? className(response.headers.get("x-isp-diagnostic-exception")) : null});
      if (response.status >= 500) {
        if (requestGeneration === this.lifecycleGeneration && !lifetime.signal.aborted) this.invalidateApplicationReadiness();
        void response.body?.cancel().catch(() => {});
        lifetime.release();
        return unavailable(trace.id);
      }
      return lifetime.wrap(privateResponse(response, trace.id));
    } catch (error) {
      if (admitted) await this.diagnosticEvent(trace, {stage: this.isDiagnosticLeaseExpired() ? "lease" : (trace.dispatched ? "transport" : trace.stage),
        outcome: "failed", exception_class: className(error?.constructor?.name)});
      if (admitted && (backendStarted || trace.stage === "startup") && requestGeneration === this.lifecycleGeneration && !lifetime.signal.aborted) this.invalidateLifecycle();
      lifetime.release();
      return unavailable(trace.id);
    }
  }

}
