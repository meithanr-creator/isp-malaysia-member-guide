import {readFileSync,writeFileSync} from 'node:fs';
const account='a9720867333b64a4f8ee70cdfd673eb9',worker='isp-member-production';
const privateRoot='D:/Projects/isp-rails-tools/isp-staging-private';
const token=JSON.parse(readFileSync(`${privateRoot}/deployment-token.json`,'utf8')).CLOUDFLARE_API_TOKEN;
if(typeof token!=='string'||token.length<32||/\s/.test(token)) throw new Error('Private deployment credential is invalid');
async function api(path,options={}) {
 const res=await fetch(`https://api.cloudflare.com/client/v4${path}`,{...options,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(30000)});
 const data=await res.json();
 if(!res.ok||data.success!==true) { console.error(JSON.stringify({operation:path.replace(/\?.*/,''),http_status:res.status,error_codes:(data.errors||[]).map(e=>e.code)}));process.exit(1); }
 return data.result;
}
try {
 const verified=await api('/user/tokens/verify');
 const scripts=await api(`/accounts/${account}/workers/scripts`);
 const script=scripts.find(s=>s.id===worker);
 if(!script?.tag)throw new Error('ISP Worker metadata unavailable');
 const triggers=await api(`/accounts/${account}/builds/workers/${script.tag}/triggers`);
 const summary={token_status:verified.status,token_id:verified.id,worker:script.id,worker_tag:script.tag,triggers};
 writeFileSync(`${privateRoot}/build-metadata.json`,JSON.stringify(summary,null,2));
 console.log(JSON.stringify({token_status:verified.status,worker:script.id,worker_tag:script.tag,trigger_response_type:Array.isArray(triggers)?'array':typeof triggers,triggers},null,2));
} catch { console.error('Deployment inspection failed; no credentials or response bodies displayed.');process.exitCode=1; }