import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const ACCOUNT='a9720867333b64a4f8ee70cdfd673eb9',WORKER='isp-member-production';
const PRIVATE='D:/Projects/isp-rails-tools/isp-staging-private';
export function validatePlan(plan,now=Date.now()) {
 if(plan.account!==ACCOUNT||plan.worker!==WORKER||plan.application_name!==WORKER||!/^[a-f0-9-]{36}$/.test(plan.application_id||''))throw new Error('ISP watchdog identity invalid');
 const start=Date.parse(plan.start_at),end=Date.parse(plan.expires_at);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>55*60000||start>now+60000)throw new Error('ISP watchdog window invalid');
 return {stopAt:end-5*60000,end};
}
export async function stopStaging(plan,api,pause=delay) {
 validatePlan(plan);
 const path=`/containers/applications/${plan.application_id}`;
 const app=await api(path,'GET',undefined,true);
 if(app&&app.name!==WORKER)throw new Error('Refusing to touch another application');
 let ingressClosed=false;
 try {
  await api(`/workers/scripts/${WORKER}/subdomain`,'POST',{enabled:false,previews_enabled:false});
  const state=await api(`/workers/scripts/${WORKER}/subdomain`);
  ingressClosed=state.enabled===false&&state.previews_enabled===false;
 } catch { /* Still stop this verified application's compute if ingress API fails. */ }
 if(app)await api(path,'DELETE');
 let absent=false;
 for(let attempt=0;attempt<18;attempt++) {
  const remaining=await api(path,'GET',undefined,true);
  if(remaining===null){absent=true;break;}
  if(remaining.name!==WORKER)throw new Error('Application identity changed during stop');
  await pause(5000);
 }
 if(!absent)throw new Error('Application deletion not yet confirmed');
 return {container_application_absent:true,ingress_closed:ingressClosed,verified_at:new Date().toISOString()};
}
function makeApi(token) {
 return async(path,method='GET',body,allow404=false)=>{
  if(!/^\/(?:containers\/applications\/[a-f0-9-]{36}|workers\/scripts\/isp-member-production\/subdomain)$/.test(path))throw new Error('Watchdog API path refused');
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(15000)});
  if(allow404&&response.status===404)return null;
  const data=await response.json();
  if(!response.ok||data.success!==true)throw new Error('Watchdog provider request failed');
  return data.result;
 };
}
async function main() {
 const mode=process.argv[2];
 if(!['--arm','--stop-now','--check'].includes(mode))throw new Error('Use --check, --arm or --stop-now');
 const plan=JSON.parse(readFileSync(`${PRIVATE}/watchdog-plan.json`,'utf8'));
 const {stopAt}=validatePlan(plan);
 const token=JSON.parse(readFileSync(`${PRIVATE}/deployment-token.json`,'utf8')).CLOUDFLARE_API_TOKEN;
 const api=makeApi(token);
 const app=await api(`/containers/applications/${plan.application_id}`,'GET',undefined,mode==='--stop-now');
 if(app&&app.name!==WORKER)throw new Error('ISP application verification failed');
 const statePath=`${PRIVATE}/watchdog-state.json`;
 const save=(state)=>writeFileSync(statePath,JSON.stringify({...state,application_id:plan.application_id,stop_at:new Date(stopAt).toISOString(),updated_at:new Date().toISOString()},null,2));
 if(mode==='--check'){console.log(JSON.stringify({identity_verified:true,stop_at:new Date(stopAt).toISOString(),mutations:false}));return;}
 if(mode==='--arm') {
  save({armed:true,pid:process.pid});
  while(Date.now()<stopAt){await delay(Math.min(20000,stopAt-Date.now()));save({armed:true,pid:process.pid});}
 }
 for(let attempt=0;attempt<5;attempt++) {
  try {
   const result=await stopStaging(plan,api);
   save({armed:false,...result});
   writeFileSync('audit/cloudflare-staging-shutdown.json',JSON.stringify(result,null,2));
   console.log(JSON.stringify(result));return;
  } catch {save({armed:true,stop_retry:attempt+1});await delay(5000);}
 }
 throw new Error('Watchdog could not confirm shutdown; immediate operator action required');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('ISP watchdog failed; inspect private state and stop the ISP application immediately. No credentials displayed.');process.exitCode=1;});