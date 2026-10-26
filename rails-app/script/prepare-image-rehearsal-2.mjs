// Exact-source IMAGE ONLY preparation. This helper has no Worker deploy/start API.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createReadonlyClient,inspectApplications,readDeploymentToken} from './cloudflare-staging-ops.mjs';
const ACCOUNT='a9720867333b64a4f8ee70cdfd673eb9',WORKER='isp-member-production';
const CANDIDATE='98d271dd2e105a263a214f238795b7331f7c001f',TRIGGER='338f5327-8486-4f8a-aa9a-b0ee4739f427';
const LEGACY='D:/Projects/isp-rails-tools/isp-staging-private';
const PRIVATE=LEGACY+'/leases/rails-staging-2',AUDIT='D:/Projects/isp-member-rails/audit/staging-2';
const NOOP=`node -e "console.log('ISP deployment is disabled; use the reviewed manual release procedure.')"`;
const BUILD='npm --prefix rails-app/cloudflare ci --ignore-scripts --fetch-timeout=30000 --fetch-retries=1 && npm --prefix rails-app/cloudflare test && npm --prefix rails-app/cloudflare run check';
const PUSH=`test "$(git rev-parse HEAD)" = "${CANDIDATE}" && cp rails-app/deployment/cloudflare/Dockerfile.runtime rails-app/Dockerfile && cd rails-app/cloudflare && npx --no-install wrangler containers build .. --tag isp-member-rails:${CANDIDATE} --push`;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
let lastStage='plan',lastHttp=null;
const save=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{mode:0o600});
const assert=condition=>{if(!condition)throw Error('Image preparation guard refused');};
function directories(){
 for(const dir of [LEGACY,LEGACY+'/leases',PRIVATE,AUDIT]){
  if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const stat=fs.lstatSync(dir);assert(stat.isDirectory()&&!stat.isSymbolicLink());
  assert(fs.realpathSync(dir).replaceAll('\\','/').toLowerCase()===dir.toLowerCase());
 }
}
function client(token){return async(path,method='GET',body,optional=false)=>{
 const response=await fetch('https://api.cloudflare.com/client/v4'+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(25000)});
 lastHttp=response.status;const data=await response.json();if(!response.ok||data.success!==true){if(optional)return null;save(PRIVATE+'/image-api-error.json',{stage:lastStage,path,method,http_status:response.status,errors:data.errors});throw Error('Image provider operation failed');}return data.result;
};}
async function getTrigger(api,prefix){
 const rows=await api(`${prefix}/builds/workers/2add92d700014660819ef6b5d266f104/triggers`);
 assert(Array.isArray(rows));const selected=rows.filter(row=>row.trigger_uuid===TRIGGER);
 assert(selected.length===1);return selected[0];
}
async function preflight({recovery=false}={}){
 directories();const token=readDeploymentToken(),api=client(token),prefix=`/accounts/${ACCOUNT}`;
 lastStage='token'; const verified=await api('/user/tokens/verify');assert(verified.status==='active');
 if(verified.expires_on)assert(Date.parse(verified.expires_on)>Date.now()+10*60000);
 lastStage='applications'; const apps=await inspectApplications(createReadonlyClient({token}));assert(apps.applications.length===0);
 lastStage='ingress'; const ingress=await api(`${prefix}/workers/scripts/${WORKER}/subdomain`);assert(ingress.enabled===false&&ingress.previews_enabled===false);
 lastStage='serving_deployment'; const deployments=await api(`${prefix}/workers/scripts/${WORKER}/deployments`);
 const active=(Array.isArray(deployments)?deployments:deployments.deployments)?.[0];
 assert(active?.id==='1847c5bc-7b6e-4c0a-9eee-657f7c3476f1'&&active.versions?.length===1);
 assert(active.versions[0].version_id==='d6978392-76ac-4208-aaf9-e907be1939c0'&&active.versions[0].percentage===100);
 lastStage='serving_version'; const version=await api(`${prefix}/workers/scripts/${WORKER}/versions/${active.versions[0].version_id}`);
 const bindings=version.resources?.bindings;assert(Array.isArray(bindings));
 const vars=Object.fromEntries(bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]));
 assert(vars.ISP_CONTAINER_ENABLED==='false'&&vars.ISP_STAGING_START_AT===''&&vars.ISP_STAGING_EXPIRES_AT==='');
 lastStage='automatic_build_guard';
 const observed=JSON.parse(fs.readFileSync(PRIVATE+'/automatic-builds-ui-observation.json','utf8').replace(/^\uFEFF/,''));
 assert(observed.account===ACCOUNT&&observed.worker===WORKER&&observed.disabled===true&&observed.manual_builds_allowed===true&&Date.now()-Date.parse(observed.observed_at)>=0&&Date.now()-Date.parse(observed.observed_at)<30*60000);
 lastStage='trigger'; const trigger=await getTrigger(api,prefix);
 assert(trigger.external_script_id==='2add92d700014660819ef6b5d266f104');
 assert(trigger.repo_connection?.repo_name==='isp-malaysia-member-guide'&&trigger.repo_connection?.provider_account_name==='meithanr-creator');
 assert((trigger.deploy_command===NOOP&&trigger.build_command===NOOP)||(recovery&&trigger.deploy_command===PUSH&&trigger.build_command===BUILD));
 lastStage='build_environment'; const env=await api(`${prefix}/builds/triggers/${TRIGGER}/environment_variables`);
 const expected={NODE_VERSION:'24.21.0',SKIP_DEPENDENCY_INSTALL:'true',WRANGLER_SEND_METRICS:'false'};
 assert(Object.keys(env).length===3&&Object.entries(expected).every(([name,value])=>env[name]?.value===value&&env[name]?.is_secret===false));
 lastStage='build_limits'; const builds=await api(`${prefix}/builds/workers/2add92d700014660819ef6b5d266f104/builds?per_page=100`);
 assert(Array.isArray(builds)&&builds.length<100&&builds.every(build=>build.status==='stopped'));
 const limits=await api(`${prefix}/builds/account/limits`,'GET',undefined,true);
 save(PRIVATE+'/build-limits.json',limits);save(PRIVATE+'/image-trigger-before.json',trigger);
 const receipt={candidate:CANDIDATE,checked_at:new Date().toISOString(),account:ACCOUNT,worker:WORKER,applications:0,ingress:false,active_version:active.versions[0].version_id,active_enabled:false,build_env_public_only:true,other_active_isp_builds:0,candidate_builds:builds.filter(b=>b.build_trigger_metadata?.commit_hash===CANDIDATE).map(b=>({build_uuid:b.build_uuid,status:b.status,build_outcome:b.build_outcome})),automatic_builds_disabled_ui_observed_at:observed.observed_at,limits_available:!!limits&&Object.keys(limits).length>0,runtime_started:false};
 save(AUDIT+'/image-preflight.json',receipt);return{api,prefix,trigger,receipt};
}
async function build(){
 const {api,prefix,trigger,receipt}=await preflight();
 const plan=JSON.parse(fs.readFileSync(PRIVATE+'/image-only-plan.json','utf8').replace(/^\uFEFF/,''));
 assert(plan.helper_sha256===createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'));
 assert(plan.candidate===CANDIDATE&&plan.astra_image_only_go===true&&plan.runtime_authorized===false&&plan.total_test_ceiling_usd===5&&plan.max_build_minutes===10);
 const stateFile=PRIVATE+'/image-build.json';assert(!fs.existsSync(stateFile));
 let buildId=null,changed=false,inert=false,snapshotConfirmed=false;const end=Date.now()+10*60000;
 const evidence={...receipt,purpose:'Exact-source image build/push only',runtime_started:false,max_build_minutes:10,build_uuid:null,trigger_restored:false};
 try{
  changed=true;
  const configured=await api(`${prefix}/builds/triggers/${TRIGGER}`,'PATCH',{root_directory:'/',build_command:BUILD,deploy_command:PUSH,build_token_uuid:trigger.build_token_uuid});
  assert(configured.deploy_command===PUSH&&configured.build_command===BUILD);
  fs.writeFileSync(stateFile,JSON.stringify({...evidence,phase:'build_request_prepared'},null,2)+'\n',{mode:0o600,flag:'wx'});
  const created=await api(`${prefix}/builds/triggers/${TRIGGER}/builds`,'POST',{branch:'production-readiness',commit_hash:CANDIDATE});
  assert(typeof created.build_uuid==='string'&&created.build_uuid.length===36&&UUID.test(created.build_uuid));buildId=created.build_uuid;evidence.build_uuid=buildId;
  save(stateFile,evidence);
  const snapshot=await api(`${prefix}/builds/builds/${buildId}`);
  assert(snapshot.build_trigger_metadata?.commit_hash===CANDIDATE&&snapshot.build_trigger_metadata?.build_command===BUILD&&snapshot.build_trigger_metadata?.deploy_command===PUSH);
  snapshotConfirmed=true;
 }finally{
  if(changed){
   try{
    await api(`${prefix}/builds/triggers/${TRIGGER}`,'PATCH',{build_command:NOOP,deploy_command:NOOP});
    const restored=await getTrigger(api,prefix);
    inert=restored.build_command===NOOP&&restored.deploy_command===NOOP;
   }finally{
    evidence.trigger_restored=inert;
    if(buildId&&(!inert||!snapshotConfirmed))await api(`${prefix}/builds/builds/${buildId}/cancel`,'PUT');
    save(stateFile,evidence);
   }
  }
 }
 assert(buildId&&inert);
 let result;
 try{
  for(;;){
   result=await api(`${prefix}/builds/builds/${buildId}`);
   if(result.status==='stopped')break;
   if(Date.now()+12000>=end){await api(`${prefix}/builds/builds/${buildId}/cancel`,'PUT');throw Error('Image build time limit reached');}
   await delay(10000);
  }
  assert(result.build_outcome==='success'&&result.build_trigger_metadata?.commit_hash===CANDIDATE);
  const logs=await api(`${prefix}/builds/builds/${buildId}/logs`);
  save(PRIVATE+'/image-build-logs.json',logs);
  const text=JSON.stringify(logs),matches=[...text.matchAll(new RegExp(CANDIDATE+': digest: (sha256:[a-f0-9]{64})','g'))];
  assert(matches.length===1);evidence.image_digest=matches[0][1];
  evidence.image=`registry.cloudflare.com/${ACCOUNT}/isp-member-rails@${evidence.image_digest}`;
  evidence.status='success';evidence.finished_at=new Date().toISOString();
  lastStage='applications'; const apps=await inspectApplications(createReadonlyClient({token:readDeploymentToken()}));assert(apps.applications.length===0);
  lastStage='ingress'; const ingress=await api(`${prefix}/workers/scripts/${WORKER}/subdomain`);assert(ingress.enabled===false&&ingress.previews_enabled===false);
  save(stateFile,evidence);save(AUDIT+'/image-build.json',evidence);return evidence;
 }catch(error){
  if(buildId&&result?.status!=='stopped')await api(`${prefix}/builds/builds/${buildId}/cancel`,'PUT').catch(()=>{});
  evidence.status='failed_or_unconfirmed';save(stateFile,evidence);save(AUDIT+'/image-build.json',evidence);throw error;
 }
}
async function main(){
 const mode=process.argv[2]||'--plan';
 if(mode==='--plan')return console.log(JSON.stringify({candidate:CANDIDATE,image_only:true,runtime_authorized:false,max_build_minutes:10,automatic_commands_restored_to_noop:true,total_test_ceiling_usd:5,network_requests:0}));
 if(mode==='--restore-inert'){
  const api=client(readDeploymentToken()),prefix=`/accounts/${ACCOUNT}`;lastStage='restore_inert';
  const verified=await api('/user/tokens/verify');assert(verified.status==='active');
  const trigger=await getTrigger(api,prefix);
  assert(trigger.external_script_id==='2add92d700014660819ef6b5d266f104'&&trigger.repo_connection?.repo_name==='isp-malaysia-member-guide'&&trigger.repo_connection?.provider_account_name==='meithanr-creator');
  assert((trigger.deploy_command===NOOP&&trigger.build_command===NOOP)||(trigger.deploy_command===PUSH&&trigger.build_command===BUILD));
  await api(`${prefix}/builds/triggers/${TRIGGER}`,'PATCH',{root_directory:'/',build_command:NOOP,deploy_command:NOOP,build_token_uuid:trigger.build_token_uuid});
  const checked=await getTrigger(api,prefix);assert(checked.build_command===NOOP&&checked.deploy_command===NOOP);
  console.log(JSON.stringify({commands_inert:true,automatic_branches_excluded:checked.branch_excludes?.includes('*'),runtime_started:false}));return;
 }
 assert(mode==='--preflight'||mode==='--build');
 const value=mode==='--preflight'?(await preflight()).receipt:await build();console.log(JSON.stringify(value));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))main().catch(()=>{console.error(JSON.stringify({error:'Image-only preparation refused or failed; no credentials displayed',stage:lastStage,http_status:lastHttp}));process.exitCode=1;});