// Offline preparation only: no provider API, runtime window, data import or activation.
import fs from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {LEASE2,LEASE3,leaseContext,selectLease,buildLease2Seed,assertLeaseMutationAllowed} from './staging-lease-context.mjs';
import {LEASE3_POLICY,buildLease3InactiveConfig} from './lease3-release-policy.mjs';

const ROOT='D:/Projects/isp-member-rails',ACCOUNT='a9720867333b64a4f8ee70cdfd673eb9',WORKER='isp-member-production',CANDIDATE='80d32fddf88251a6608ba047a577ce16efe8c834';
const context=leaseContext(selectLease()),SEED=context.privateRoot+'/runtime-seed.json',CONFIG=context.privateRoot+'/'+context.configName;
let stage='plan';
function guard(value){if(!value)throw Error('Unarmed preparation refused');}
const normalized=path=>resolve(path).replaceAll('\\','/').toLowerCase();
function fixed(path,directory=false){const stat=fs.lstatSync(path);guard(!stat.isSymbolicLink()&&normalized(fs.realpathSync(path))===normalized(path));guard(directory?stat.isDirectory():stat.isFile()&&stat.size<=65536);return path;}
function absent(path){try{fs.lstatSync(path);}catch(error){if(error.code==='ENOENT')return;throw error;}throw Error('Unarmed output already exists');}
const json=path=>JSON.parse(fs.readFileSync(fixed(path),'utf8').replace(/^\uFEFF/,''));
function exclusive(path,text){const fd=fs.openSync(path,'wx',0o600);try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
export function buildInactiveConfig(v1,image){
 guard(image?.account===ACCOUNT&&image.worker===WORKER&&image.candidate===CANDIDATE&&image.status==='success'&&image.runtime_started===false&&image.commands_inert===true&&image.applications===0&&image.ingress_closed===true&&image.phase==='confirmed'&&image.auth_cleanup_pending===false&&typeof image.image_digest==='string'&&image.image_digest.length===71&&/^sha256:[a-f0-9]{64}$/.test(image.image_digest));
 guard(!Object.hasOwn(image,'build_uuid')&&!Object.hasOwn(image,'trigger_restored'));
 guard(image.provider==='github-actions+crane'&&image.workflow_source==='73add85e87235caccb8661208b8fe28a5cdd0a2c'&&image.github_run_id===40351242941&&image.github_job_id===121671738041&&image.artifact_id===12664935022&&image.artifact_sha256==='a9fa0c7dbfe3c340e361809fbb23e7e77e9b01f2a1495be69f79d44679251a1e'&&/^[a-f0-9]{64}$/.test(image.archive_sha256||'')&&/^[a-f0-9]{64}$/.test(image.tar_sha256||'')&&/^sha256:[a-f0-9]{64}$/.test(image.image_id||'')&&image.image_digest===image.expected_digest);
 guard(image.image===`registry.cloudflare.com/${ACCOUNT}/isp-member-rails@${image.image_digest}`);
 guard(v1.name===WORKER&&v1.account_id===ACCOUNT&&v1.workers_dev===false&&v1.preview_urls===false&&Array.isArray(v1.routes)&&v1.routes.length===0&&v1.observability?.enabled===false);
 const vars=v1.vars;const names=['ISP_CONTAINER_ENABLED','APP_HOST','ISP_STAGING_START_AT','ISP_STAGING_EXPIRES_AT','ISP_DEMO_MODE','ISP_ACCOUNT_EMAILS_ENABLED','ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED','DB_SSLMODE'];guard(vars&&Object.keys(vars).length===names.length&&names.every(name=>Object.hasOwn(vars,name)));guard(vars?.ISP_CONTAINER_ENABLED==='false'&&vars.ISP_STAGING_START_AT===''&&vars.ISP_STAGING_EXPIRES_AT===''&&vars.APP_HOST==='isp-member-production.meithan-r.workers.dev'&&vars.DB_SSLMODE==='verify-full'&&['ISP_DEMO_MODE','ISP_ACCOUNT_EMAILS_ENABLED','ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED'].every(key=>vars[key]==='false'));
 guard(Array.isArray(v1.containers)&&v1.containers.length===1&&Array.isArray(v1.durable_objects?.bindings)&&v1.durable_objects.bindings.length===1);
 const container=v1.containers[0],binding=v1.durable_objects.bindings[0];
 guard(container.name===WORKER&&container.class_name==='RailsContainer'&&container.scheduling_policy==='default'&&container.instance_type==='standard-2'&&container.max_instances===1&&container.observability?.enabled===false&&container.image!==image.image);
 guard(Object.keys(binding).length===2&&binding.name==='RAILS_CONTAINER'&&binding.class_name==='RailsContainer'&&JSON.stringify(v1.migrations)===JSON.stringify([{tag:'rails-container-v1',new_sqlite_classes:['RailsContainer']}]));
 const config=structuredClone(v1);config.$schema=ROOT+'/cloudflare/node_modules/wrangler/config-schema.json';config.main=ROOT+'/cloudflare/staging/index.js';
 config.containers[0].class_name='RailsStaging2';config.containers[0].image=image.image;config.durable_objects.bindings[0].class_name='RailsStaging2';config.migrations.push({tag:'rails-staging-v2',new_sqlite_classes:['RailsStaging2']});return config;
}
export function buildLease3Preparation(v1,image,v2Text,previous,random){
 guard(typeof v2Text==='string'&&createHash('sha256').update(v2Text).digest('hex')==='a18c41e5f95949823ddab603215f6f681547409c453f24cef827df97a8229232');
 const rebuiltV2=buildInactiveConfig(v1,image);guard(JSON.stringify(rebuiltV2,null,2)+'\n'===v2Text&&image.image_digest===LEASE3_POLICY.image_digest);
 const config=buildLease3InactiveConfig(JSON.parse(v2Text)),text=JSON.stringify(config,null,2)+'\n',configHash=createHash('sha256').update(text).digest('hex');guard(configHash==='dc4a3ff927acbf677a6cba86f77155396ccef02b9d36e8f2d8d79b303d901783');
 return {config,text,configHash,seed:buildLease2Seed(previous,random)};
}
export function prepare(){
 assertLeaseMutationAllowed(context);guard(selectLease()===LEASE3);stage='paths';
 for(const path of [context.credentialRoot,context.credentialRoot+'/leases',context.privateRoot,context.auditRoot])fixed(path,true);
 for(const path of [SEED,CONFIG,context.privateRoot+'/runtime.json'])absent(path);
 stage='image_and_config';const previous=leaseContext(LEASE2),image=json(previous.auditRoot+'/image-build.json'),v2Path=previous.privateRoot+'/wrangler-v2.jsonc';
 const v2Text=fs.readFileSync(fixed(v2Path),'utf8'),prepared=buildLease3Preparation(json(ROOT+'/cloudflare/staging/wrangler.jsonc'),image,v2Text,json(previous.privateRoot+'/runtime-seed.json'),randomBytes),{text,seed}=prepared;
 stage='exclusive_outputs';exclusive(SEED,JSON.stringify(seed,null,2)+'\n');exclusive(CONFIG,text);
 return {prepared:true,lease_id:LEASE3,seed_key_count:5,candidate:CANDIDATE,image_digest:image.image_digest,config_sha256:createHash('sha256').update(text).digest('hex'),runtime_created:false,timestamps_armed:false,activation:false,network_requests:0};
}
function main(){const mode=process.argv[2]||'--plan';if(mode==='--plan')return console.log(JSON.stringify({lease_id:context.leaseId,outputs:['runtime-seed.json',context.configName],runtime_created:false,activation:false,network_requests:0}));guard(mode==='--prepare'&&process.argv.length===3);console.log(JSON.stringify(prepare()));}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))try{main();}catch{console.error(JSON.stringify({error:'Unarmed lease2 preparation refused; inspect fixed private files.',stage}));process.exitCode=1;}