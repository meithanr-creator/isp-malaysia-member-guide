import {readFileSync,writeFileSync} from 'node:fs';
const account='a9720867333b64a4f8ee70cdfd673eb9',worker='isp-member-production';
const privateRoot='D:/Projects/isp-rails-tools/isp-staging-private';
const token=JSON.parse(readFileSync(`${privateRoot}/deployment-token.json`,'utf8')).CLOUDFLARE_API_TOKEN;
const metadata=JSON.parse(readFileSync(`${privateRoot}/build-metadata.json`,'utf8'));
if(metadata.worker!==worker||metadata.worker_tag!=='2add92d700014660819ef6b5d266f104')throw new Error('ISP Worker identity mismatch');
async function api(path,method='GET',body) {
 const res=await fetch(`https://api.cloudflare.com/client/v4${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(30000)});
 const data=await res.json();
 if(!res.ok||data.success!==true){console.error(JSON.stringify({operation:path,http_status:res.status,error_codes:(data.errors||[]).map(e=>e.code)}));process.exit(1);}
 return data.result;
}
try {
 const verified=await api('/user/tokens/verify');
 if(verified.status!=='active'||verified.id!==metadata.token_id)throw new Error('Deployment key verification mismatch');
 const triggers=await api(`/accounts/${account}/builds/workers/${metadata.worker_tag}/triggers`);
 const trigger=triggers.find(t=>t.trigger_uuid==='338f5327-8486-4f8a-aa9a-b0ee4739f427');
 if(trigger?.repo_connection?.repo_name!=='isp-malaysia-member-guide'||trigger.repo_connection.provider_account_name!=='meithanr-creator')throw new Error('ISP repository mismatch');
 const tokens=await api(`/accounts/${account}/builds/tokens`);
 if(!Array.isArray(tokens))throw new Error('Unexpected build token list');
 const matches=tokens.filter(t=>t.cloudflare_token_id===verified.id);
 if(matches.length>1)throw new Error('Ambiguous deployment registration');
 const registered=matches[0]||await api(`/accounts/${account}/builds/tokens`,'POST',{build_token_name:'ISP production-readiness deployment 2026-10-26',build_token_secret:token,cloudflare_token_id:verified.id});
 if(!registered.build_token_uuid)throw new Error('Build token registration not confirmed');
 const configuration={root_directory:'/',build_command:'npm --prefix rails-app/cloudflare ci --ignore-scripts --fetch-timeout=30000 --fetch-retries=1 && npm --prefix rails-app/cloudflare test && npm --prefix rails-app/cloudflare run check',deploy_command:'cd rails-app/cloudflare && npx --no-install wrangler deploy --config staging/wrangler.jsonc',build_token_uuid:registered.build_token_uuid,build_caching_enabled:false};
 const saved=await api(`/accounts/${account}/builds/triggers/${trigger.trigger_uuid}`,'PATCH',configuration);
 if(saved.root_directory!==configuration.root_directory||saved.build_token_uuid!==registered.build_token_uuid||saved.deploy_command!==configuration.deploy_command)throw new Error('Build settings verification failed');
 const evidence={worker,worker_tag:metadata.worker_tag,trigger_uuid:trigger.trigger_uuid,build_token_uuid:registered.build_token_uuid,...configuration,configured_at:new Date().toISOString(),build_started:false,runtime_started:false};
 writeFileSync('audit/cloudflare-build-configuration.json',JSON.stringify(evidence,null,2));
 writeFileSync(`${privateRoot}/build-configured.json`,JSON.stringify(evidence,null,2));
 console.log(JSON.stringify(evidence,null,2));
} catch {console.error('Build preparation failed; credentials and provider response bodies were not displayed.');process.exitCode=1;}