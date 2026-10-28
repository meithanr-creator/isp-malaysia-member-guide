// One private Rails startup proof. No member routes, uploads, migrations or mail.
import { DurableObject } from 'cloudflare:workers';
export const IMAGE='registry.cloudflare.com/a9720867333b64a4f8ee70cdfd673eb9/isp-member-rails@sha256:152480a896060eae82a380dc54f651e199ff1585cd5dd805d0d51b9f3a587d2a';
const SINGLETON='rails-start-once';
export function railsRequest(host,path,signal){return new Request('http://'+host+path,{headers:{Host:host,'X-Forwarded-Host':host,'X-Forwarded-Proto':'https','X-Forwarded-Port':'443'},signal});}

const reply=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
function allowed(request,env){const key=request.headers.get('x-isp-startup-key');if(!/^[a-f0-9]{64}$/.test(key||'')||!/^[a-f0-9]{64}$/.test(env.STARTUP_KEY||''))return false;let difference=0;for(let i=0;i<64;i++)difference|=key.charCodeAt(i)^env.STARTUP_KEY.charCodeAt(i);return difference===0;}
function safeError(e){const code=e?.code??e?.cause?.code;return {error_class:/^[A-Za-z]{1,32}$/.test(e?.name||'')?e.name:'Error',code:['ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET'].includes(code)?code:null};}
function bounded(promise,ms){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Startup operation timeout')),ms);})]).finally(()=>clearTimeout(timer));}
export default {fetch(request,env){const url=new URL(request.url);if(!allowed(request,env)||url.protocol!=='https:'||url.hostname!==env.PROBE_HOST||url.search||url.hash||url.port)return reply({status:'unavailable'},503);if(!((request.method==='GET'&&['/up','/result'].includes(url.pathname))||(request.method==='POST'&&url.pathname==='/stop')))return reply({status:'unavailable'},503);if(url.pathname==='/up'&&(!(Date.now()<Date.parse(env.PROBE_EXPIRES_AT))||env.PROBE_ENABLED!=='true'))return reply({status:'expired'},503);return env.STARTUP.getByName(SINGLETON).fetch(request);}};
export class ISPStartup extends DurableObject {
  work=null; exit=null; stopped=false; stopPromise=null; abort=new AbortController();
  async save(value){await this.ctx.storage.put('result',value);return value;}
  active(end){if(this.stopped||this.abort.signal.aborted||Date.now()>=end)throw Error('Startup stopped or expired');}
  async stop(){this.stopped=true;this.abort.abort();this.stopPromise??=(async()=>{const outcomes=await Promise.allSettled([bounded(this.ctx.storage.put('stopped',true),5000),bounded(this.ctx.container.destroy(),5000)]);return outcomes.every(x=>x.status==='fulfilled')&&!this.ctx.container.running;})();return this.stopPromise;}
  async fetch(request){if(!allowed(request,this.env)||this.ctx.id.toString()!==this.env.STARTUP.idFromName(SINGLETON).toString())return reply({status:'unavailable'},503);const url=new URL(request.url);if(url.pathname==='/result')return reply(await this.ctx.storage.get('result')||{status:'NOT_STARTED'});if(url.pathname==='/stop')return reply({stopped:await this.stop()});this.work??=this.once();return reply(await this.work);}
  async alarm(){await this.stop();}
  async once(){
    let stage='admission',rails=null,neon=null,result,lastProbeError=null;
    const end=Date.parse(this.env.PROBE_EXPIRES_AT),began=Date.now();
    try{
      if(await this.ctx.storage.get('stopped'))this.stopped=true;
      if(this.env.PROBE_ENABLED!=='true'||!Number.isFinite(end)||end<=began||end-began>600000||await this.ctx.storage.get('attempted'))throw Error('Startup admission refused');
      this.active(end);await this.ctx.storage.put('attempted',true);await this.ctx.storage.setAlarm(end);
      const runtime=JSON.parse(this.env.RUNTIME_ENV);
      if(runtime.RAILS_ENV!=='production'||runtime.APP_HOST!==this.env.PROBE_HOST||runtime.DB_SSLMODE!=='verify-full'||runtime.ISP_DEMO_MODE!=='false'||runtime.ISP_ACCOUNT_EMAILS_ENABLED!=='false'||runtime.ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED!=='false'||this.ctx.container.images.rails!==IMAGE)throw Error('Startup configuration refused');
      stage='container_start';await this.save({status:'RUNNING',stage,started_at:new Date(began).toISOString()});
      this.active(end);this.ctx.container.start({image:this.ctx.container.images.rails,instance:'standard-2',enableInternet:true,env:runtime});
      this.ctx.waitUntil(this.ctx.container.monitor().then(()=>{this.exit={success:true};},e=>{this.exit={success:false,exit_code:Number.isInteger(e?.exitCode)?e.exitCode:null};}));
      stage='rails_http';await this.save({status:'RUNNING',stage,started_at:new Date(began).toISOString()});
      const port=this.ctx.container.getTcpPort(3000),until=Math.min(end-30000,began+180000);let lastStatus=null;
      while(Date.now()<until){
        this.active(end);if(this.exit)throw Error('Container exited before Rails response');
        try{this.active(end);const response=await port.fetch(railsRequest(runtime.APP_HOST,'/up',AbortSignal.any([this.abort.signal,AbortSignal.timeout(Math.max(1,Math.min(3000,until-Date.now())))])));lastStatus=response.status;await response.body?.cancel();this.active(end);if(lastStatus===200){rails={status:'PASS',http_status:200,observed_at:new Date().toISOString()};break;}}catch(e){lastProbeError=safeError(e);this.active(end);if(this.exit)throw e;}
        await new Promise(resolve=>setTimeout(resolve,250));
      }
      if(!rails){result={status:'FAIL',stage,last_http_status:lastStatus,last_probe_error:lastProbeError,container_exit:this.exit};return result;}
      await this.ctx.container.setInactivityTimeout(60000);
      stage='neon_http';await this.save({status:'RUNNING',stage,rails});this.active(end);
      try{const response=await port.fetch(railsRequest(runtime.APP_HOST,'/app-ready',AbortSignal.any([this.abort.signal,AbortSignal.timeout(Math.max(1,Math.min(15000,end-Date.now())))])));const body=await response.text();this.active(end);neon={status:response.status===200&&body==='application ready'?'PASS':'FAIL',http_status:response.status};}catch(e){neon={status:'FAIL',...safeError(e)};}
      result={status:'PASS',stage:'complete',rails,neon};return result;
    }catch(e){result={status:'FAIL',stage,rails,neon,last_probe_error:lastProbeError,container_exit:this.exit,...safeError(e)};return result;}
    finally{result??={status:'FAIL',stage};result.container_stopped=await this.stop();if(!result.container_stopped)result.status='FAIL';result.finished_at=new Date().toISOString();await this.save(result);if(result.container_stopped)await this.ctx.storage.deleteAlarm();}
  }
}
// Fresh controller namespace; prior one-shot state stays preserved.
export class ISPNeonProof extends ISPStartup {}
