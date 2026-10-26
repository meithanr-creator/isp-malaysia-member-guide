import {readFileSync,writeFileSync} from 'node:fs';
const account='a9720867333b64a4f8ee70cdfd673eb9',privateRoot='D:/Projects/isp-rails-tools/isp-staging-private';
const token=JSON.parse(readFileSync(`${privateRoot}/deployment-token.json`,'utf8')).CLOUDFLARE_API_TOKEN;
const state=JSON.parse(readFileSync(`${privateRoot}/image-build.json`,'utf8'));
if(state.worker!=='isp-member-production'||!/^[a-f0-9-]{36}$/.test(state.build_uuid))throw new Error('ISP build identity invalid');
const path=`/builds/builds/${state.build_uuid}`;
const base=`https://api.cloudflare.com/client/v4/accounts/${account}`;
async function api(suffix,method='GET'){
 const response=await fetch(base+suffix,{method,headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
 const envelope=await response.json();
 if(!response.ok||envelope.success!==true)throw new Error(`Build status request failed (HTTP ${response.status})`);
 return envelope.result;
}
try {
 const result=await api(path);
 const summary=Object.fromEntries(Object.entries(result).filter(([key])=>['build_uuid','status','build_outcome','created_on','modified_on','started_on','finished_on','commit_hash','branch','status_reason','build_trigger_metadata'].includes(key)));
 summary.checked_at=new Date().toISOString();
 writeFileSync('audit/cloudflare-image-build-status.json',JSON.stringify(summary,null,2));
 console.log(JSON.stringify(summary,null,2));
 if(process.argv.includes('--logs')) {
   const logs=await api(path+'/logs');
   const text=JSON.stringify(logs,null,2).replaceAll(token,'[REDACTED_DEPLOYMENT_KEY]');
   writeFileSync('audit/cloudflare-image-build-logs.json',text);
   console.log(text.slice(-8000));
 }
} catch {console.error('Could not inspect the ISP build; no private response details displayed.');process.exitCode=1;}