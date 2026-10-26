import {readFileSync,writeFileSync} from 'node:fs';
const account='a9720867333b64a4f8ee70cdfd673eb9',worker='isp-member-production';
const privateRoot='D:/Projects/isp-rails-tools/isp-staging-private';
const token=JSON.parse(readFileSync(`${privateRoot}/deployment-token.json`,'utf8')).CLOUDFLARE_API_TOKEN;
const metadata=JSON.parse(readFileSync(`${privateRoot}/build-configured.json`,'utf8'));
const candidate='c9a5142bd8c949c6415c3639c0113ee015f9a3f4';
const trigger='338f5327-8486-4f8a-aa9a-b0ee4739f427';
if(metadata.worker!==worker||metadata.trigger_uuid!==trigger)throw new Error('ISP build identity mismatch');
async function api(path,method='GET',body) {
 const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(30000)});
 const data=await response.json();
 if(!response.ok||data.success!==true){console.error(JSON.stringify({operation:path,http_status:response.status,error_codes:(data.errors||[]).map(e=>e.code)}));process.exit(1);}
 return data.result;
}
try {
 const previousEnvironment=await api(`/builds/triggers/${trigger}/environment_variables`);
 if(Object.hasOwn(previousEnvironment,'RUBY_VERSION'))await api(`/builds/triggers/${trigger}/environment_variables/RUBY_VERSION`,'DELETE');
 const buildEnvironment={NODE_VERSION:{value:'24.21.0',is_secret:false},SKIP_DEPENDENCY_INSTALL:{value:'true',is_secret:false},WRANGLER_SEND_METRICS:{value:'false',is_secret:false}};
 await api(`/builds/triggers/${trigger}/environment_variables`,'PATCH',buildEnvironment);
 const confirmedEnvironment=await api(`/builds/triggers/${trigger}/environment_variables`);
 for(const [name,entry] of Object.entries(buildEnvironment))if(confirmedEnvironment[name]?.value!==entry.value)throw new Error('Build environment verification failed');
 const deployCommand=`cp rails-app/deployment/cloudflare/Dockerfile.runtime rails-app/Dockerfile && cd rails-app/cloudflare && npx --no-install wrangler containers build .. --tag isp-member-rails:${candidate} --push`;
 const config=await api(`/builds/triggers/${trigger}`,'PATCH',{deploy_command:deployCommand,root_directory:'/',build_command:'npm --prefix rails-app/cloudflare ci --ignore-scripts --fetch-timeout=30000 --fetch-retries=1 && npm --prefix rails-app/cloudflare test && npm --prefix rails-app/cloudflare run check',build_token_uuid:metadata.build_token_uuid});
 if(config.deploy_command!==deployCommand)throw new Error('Image-only build command was not saved');
 const builds=await api(`/builds/workers/${metadata.worker_tag}/builds`);
 if(!Array.isArray(builds))throw new Error('Unexpected build list');
 const pending=builds.filter(b=>b.commit_hash===candidate&&['queued','running','initializing'].includes(b.status));
 if(pending.length)throw new Error('A candidate build is already active');
 const result=await api(`/builds/triggers/${trigger}/builds`,'POST',{branch:'production-readiness',commit_hash:candidate});
 if(!result.build_uuid)throw new Error('Build start not confirmed');
 const evidence={worker,worker_tag:metadata.worker_tag,trigger_uuid:trigger,commit:candidate,build_uuid:result.build_uuid,image_tag:`isp-member-rails:${candidate}`,started_at:new Date().toISOString(),purpose:'Reviewed runtime image build/push only; no Worker/application activation',deploy_command:deployCommand};
 writeFileSync('audit/cloudflare-image-build.json',JSON.stringify(evidence,null,2));
 writeFileSync(`${privateRoot}/image-build.json`,JSON.stringify(evidence,null,2));
 console.log(JSON.stringify(evidence,null,2));
} catch {console.error('Image build did not start or could not be confirmed; no credentials or provider bodies displayed.');process.exitCode=1;}