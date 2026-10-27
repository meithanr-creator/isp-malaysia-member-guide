// Fixed-D one-shot inactive provisioning. No activation or hosted application requests.
import fs from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {C,Refused,must,hash,blobHash,canonical,hex,uuid,validateCI,validateConfig,validateBindings,validateGrant,workerMetadata,applicationRequest,verifyWorker,selectOwnedApplication,verifyInactiveApplication,preparedRecord,oneShot,runtimeObjects,bootstrapFence,finishHandoffRecords,completeEnvelope,staleLockRecovery,activationAdmission,activationMetadata,admitProviderRequest,failureShutdown} from './lease2-provision-core.mjs';
import {validatePreparedRelease,preparedTuple,leaseContext,LEASE2} from './staging-lease-context.mjs';
import {stopStaging} from './cloudflare-staging-watchdog.mjs';
import {readStagingCredential,validateVerifiedApiCredential} from './staging-credential-provider.mjs';
const ROOT='D:/Projects/isp-member-rails',PRIVATE='D:/Projects/isp-rails-tools/isp-staging-private/leases/rails-staging-2',CREDENTIALS='D:/Projects/isp-rails-tools/isp-staging-private';
const OWN=fileURLToPath(new URL('..',import.meta.url)),A='/accounts/'+C.account,W=A+'/workers/scripts/'+C.worker,APP=A+'/containers/applications';
const NOOP='node -e "console.log(\'ISP deployment is disabled; use the reviewed manual release procedure.\')"';
const SCRIPT='2add92d700014660819ef6b5d266f104',TRIGGER='338f5327-8486-4f8a-aa9a-b0ee4739f427';
let phase='arguments',lockNonce,token,tokenInfo,requestCount=0,emergencyRequestCount=0,activationIngressAllowed=false,rollbackVersionAllowed=null;
const normal=p=>resolve(p).replaceAll('\\','/').toLowerCase();
function fixed(p,directory=false){const s=fs.lstatSync(p);must(!s.isSymbolicLink()&&normal(fs.realpathSync(p))===normal(p)&&(directory?s.isDirectory():s.isFile()),'Fixed D path required');return s;}
function bytes(p,max=2*1024*1024){must(fixed(p).size<=max,'Private file too large');return fs.readFileSync(p);}
const json=p=>JSON.parse(bytes(p).toString('utf8').replace(/^\uFEFF/,''));
const p=name=>PRIVATE+'/'+name;
function optional(name){try{return json(p(name));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function durable(name,value){const file=p(name),fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,canonical(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function textDurable(name,text){const fd=fs.openSync(p(name),'wx',0o600);try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function identicalOrWrite(name,value){const existing=optional(name);if(existing)must(canonical(existing)===canonical(value),'Partial output differs; inspect it');else durable(name,value);}
function has(name){try{fixed(p(name));return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function noAbort(){bootstrapFence({aborted:has('provision-abort.json'),cleaned:has('provision-cleaned.json'),handedOff:has('watchdog-handoff.json')});}
function noHandoff(){bootstrapFence({handedOff:has('watchdog-handoff.json')},{cleanup:true});}
function helperHash(root=ROOT){return hash(['script/lease2-provision-core.mjs','script/lease2-provision.mjs','script/staging-lease-context.mjs','script/cloudflare-staging-ops.mjs','script/cloudflare-staging-watchdog.mjs','script/staging-credential-provider.mjs'].map(x=>x+':'+hash(bytes(root+'/'+x))).join('\n'));}
async function buildProof(root){
 const require=createRequire(root+'/cloudflare/package.json');must(require('esbuild').version==='0.28.2');must(json(root+'/cloudflare/node_modules/@cloudflare/containers/package.json').version==='0.3.7');
 const b=await require('esbuild').build({absWorkingDir:root+'/cloudflare',entryPoints:['staging/index.js'],bundle:true,write:false,metafile:true,format:'esm',platform:'neutral',target:'es2022',external:['cloudflare:*']});
 must(b.outputFiles.length===1);const code=b.outputFiles[0].contents,files={};
 for(const name of Object.keys(b.metafile.inputs)){const abs=resolve(root+'/cloudflare',name);must(normal(abs).startsWith(normal(root)+'/'));if(!normal(abs).includes('/node_modules/'))files[abs.slice(root.length+1).replaceAll('\\','/')]=blobHash(bytes(abs));}
 for(const name of ['cloudflare/package.json','cloudflare/package-lock.json','script/lease2-provision-core.mjs','script/lease2-provision.mjs','script/staging-lease-context.mjs','script/cloudflare-staging-ops.mjs','script/cloudflare-staging-watchdog.mjs','script/staging-credential-provider.mjs'])files[name]=blobHash(bytes(root+'/'+name));
 return {code,proof:{bundle_sha256:hash(code),files,helper_sha256:helperHash(root)}};
}
function loadPackage(){
 const pack=json(p('provision-package.json')),proof=json(p('provision-source-proof.json'));must(pack.version===1&&hex(pack.source,40));validateCI(proof,pack.source);
 must(pack.ci_run_id===proof.run.id&&hash(bytes(p('provision-source-proof.json')))===pack.source_proof_sha256&&hash(bytes(p('worker-bundle.mjs')))===pack.bundle_sha256&&pack.bundle_sha256===proof.bundle_sha256&&helperHash()===pack.helper_sha256);
 const config=validateConfig(json(p('wrangler-v2.jsonc')),bytes(p('wrangler-v2.jsonc')));
 must(hash(bytes(p('worker-upload-metadata.json')))===pack.metadata_sha256&&hash(bytes(p('runtime-seed.json')))===pack.seed_sha256&&hash(bytes(p('worker-secrets.json')))===pack.secrets_sha256);
 return {pack,config,packageHash:hash(bytes(p('provision-package.json')))};
}
function grantFor(context,purpose='inactive-provision',allowExpired=false){
 const grant=json(p(purpose==='inactive-provision'?'inactive-provision-grant.json':'runtime-window-grant.json'));
 const end=validateGrant(grant,{purpose,packageHash:context.packageHash,helperHash:context.pack.helper_sha256,source:context.pack.source,ciRun:context.pack.ci_run_id,preparedHash:context.preparedHash,allowExpired});
 return {grant,end};
}
async function raw(method,path,body,allow404=false,options={}){
 const budget=admitProviderRequest({normal:requestCount,emergency:emergencyRequestCount},{emergency:options.emergency===true});requestCount=budget.normal;emergencyRequestCount=budget.emergency;
 const getPaths=[W+'/deployments',W+'/content/v2',W+'/subdomain',A+'/workers/durable_objects/namespaces?per_page=1000',APP+'?per_page=100',A,A+'/builds/workers/'+SCRIPT+'/triggers','/user/tokens/verify'];
 const appPath=new RegExp('^'+APP+'/[a-f0-9-]{36}(?:/instances-v2\\?per_page=100)?$');
 must((method==='GET'&&(getPaths.includes(path)||appPath.test(path)||new RegExp('^'+W+'/versions/[a-f0-9-]{36}$').test(path)))||(method==='PUT'&&path===W)||(method==='POST'&&path===APP)||(method==='POST'&&path===W+'/subdomain'&&body?.previews_enabled===false&&(body.enabled===false||(activationIngressAllowed&&body.enabled===true)))||(method==='POST'&&path===W+'/deployments'&&rollbackVersionAllowed&&body?.strategy==='percentage'&&body.versions?.length===1&&body.versions[0].version_id===rollbackVersionAllowed&&body.versions[0].percentage===100)||(method==='DELETE'&&appPath.test(path)&&!path.includes('instances-v2')),'Provider path refused');
 const headers={Authorization:'Bearer '+token,Accept:'application/json'};let value=body;
 if(body&&!(body instanceof FormData)){headers['Content-Type']='application/json';value=JSON.stringify(body);}
 const response=await fetch('https://api.cloudflare.com/client/v4'+path,{method,headers,body:value,redirect:'error',signal:AbortSignal.any([...(options.signal?[options.signal]:[]),AbortSignal.timeout(Math.max(1,Math.ceil(Math.min(20000,options.timeoutMs??20000))))])});
 if(allow404&&response.status===404){await response.body?.cancel();return null;}must(response.ok,'Provider request failed');must(!/rel=["']?next/i.test(response.headers.get('link')||''),'Partial provider page header refused');
 const limit=4*1024*1024,chunks=[];let count=0;for await(const chunk of response.body){count+=chunk.length;must(count<=limit,'Provider response exceeded bound');chunks.push(chunk);}const data=Buffer.concat(chunks);
 if(path===W+'/content/v2'){
  const type=response.headers.get('content-type')||'';must(type.startsWith('multipart/'),'Serving module response must be multipart');
  const form=await new Response(data,{headers:{'content-type':type}}).formData(),modules=[];
  for(const [name,file] of form){must(file instanceof File);modules.push({name,sha256:hash(Buffer.from(await file.arrayBuffer()))});}
  return {entrypoint:response.headers.get('cf-entrypoint'),modules};
 }
 const envelope=JSON.parse(data.toString('utf8'));return completeEnvelope(envelope);
}
const get=(path,allow404=false)=>raw('GET',path,undefined,allow404);
async function authenticate(){
 let credential=readStagingCredential({requiredUntil:Date.now()});token=credential.token;
 if(credential.kind==='api-token')credential=validateVerifiedApiCredential(credential,await get('/user/tokens/verify'),{requiredUntil:Date.now()});
 tokenInfo={kind:credential.kind,status:'active',expires_on:credential.expires_at,id:credential.token_id};
 const account=await get(A);must(account?.id===C.account,'Actual Cloudflare account identity mismatch');
}
async function mutationGuard(context){
 noAbort();noHandoff();must(!has('prepared-release.json'),'Release already sealed');
 const {grant,end}=grantFor(context);must(tokenInfo.kind===grant.credential_kind&&(tokenInfo.kind==='oauth'||tokenInfo.id===grant.token_id)&&Date.parse(tokenInfo.expires_on)>=end&&Date.now()+30000<Math.min(end,Date.parse(tokenInfo.expires_on)),'Matching inactive credential window required');
 await controls();return grant;
}
async function controls(){
 const ingress=await get(W+'/subdomain');must(ingress.enabled===false&&ingress.previews_enabled===false,'Ingress must remain closed');
 const rows=await get(A+'/builds/workers/'+SCRIPT+'/triggers');must(Array.isArray(rows));const selected=rows.filter(x=>x.trigger_uuid===TRIGGER);
 must(selected.length===1&&selected[0].external_script_id===SCRIPT&&selected[0].build_command===NOOP&&selected[0].deploy_command===NOOP,'Build commands must remain inert');return ingress;
}
async function deployment(){
 const rows=await get(W+'/deployments'),list=Array.isArray(rows)?rows:rows.deployments;must(Array.isArray(list)&&list.length>0);const d=list[0];must(uuid(d.id)&&d.versions?.length===1&&d.versions[0].percentage===100&&uuid(d.versions[0].version_id));
 return {deployment:d,version:await get(W+'/versions/'+d.versions[0].version_id)};
}
const namespaces=async()=>{const rows=await get(A+'/workers/durable_objects/namespaces?per_page=1000');must(Array.isArray(rows)&&rows.length<1000);return rows;};
const apps=async()=>{const rows=await get(APP+'?per_page=100');must(Array.isArray(rows)&&rows.length<100);return rows;};
async function observeWorker(intent,{persistIdentity=true}={}){
 const first=await deployment(),ns=await namespaces(),content=await get(W+'/content/v2'),ingress=await get(W+'/subdomain'),last=await deployment();must(first.deployment.id===last.deployment.id&&first.version.id===last.version.id,'Serving deployment changed during observation');
 const observation={...first,namespaces:ns,content,ingress},worker=verifyWorker(observation,intent,intent.config);
 durable('worker-observation-'+randomUUID()+'.json',observation);
 if(persistIdentity)identicalOrWrite('provision-worker.json',worker);return worker;
}
async function observeApp(intent,worker,{requireInactive=true}={}){
 const app=selectOwnedApplication(await apps(),worker.namespace_id,intent.baseline.application_ids);if(!app)return null;
 identicalOrWrite('provision-app-identity.json',{id:app.id,namespace_id:worker.namespace_id,account:C.account,name:C.worker});
 const detail=await get(APP+'/'+app.id);must(detail?.id===app.id);selectOwnedApplication([detail],worker.namespace_id,intent.baseline.application_ids);
 const instances=await get(APP+'/'+app.id+'/instances-v2?per_page=100');
 if(requireInactive)verifyInactiveApplication(detail,instances);
 durable('application-observation-'+randomUUID()+'.json',{app:detail,instances,observed_at:new Date().toISOString()});return detail;
}
async function reconcile(){
 const intent=json(p('worker-put-intent.json')),worker=await observeWorker(intent),app=await observeApp(intent,worker);return {intent,worker,app};
}
async function createApp(context){
 await mutationGuard(context);must(has('worker-put-intent.json')&&!has('app-post-intent.json'),'Application POST cannot be replayed');
 const intent=json(p('worker-put-intent.json')),worker=await observeWorker(intent);must((await apps()).filter(x=>x.name===C.worker||x.durable_objects?.namespace_id===worker.namespace_id).length===0,'Application already exists; reconcile instead');
 const body=applicationRequest(worker.namespace_id);
 return oneShot({kind:'app-post',intent:{namespace_id:worker.namespace_id,request_sha256:hash(canonical(body)),created_at:new Date().toISOString()},writeIntent:(k,v)=>durable(k+'-intent.json',v),writeOutcome:(k,v)=>durable(k+'-outcome.json',v),mutate:async()=>{await mutationGuard(context);await raw('POST',APP,body);},reconcile:()=>observeApp(intent,worker)});
}
async function provision(context){
 await mutationGuard(context);must(!has('worker-put-intent.json')&&!has('app-post-intent.json'),'Worker PUT cannot be replayed');
 const baseline=await deployment(),ns=await namespaces(),applications=await apps();
 must(baseline.deployment.id===C.oldDeployment&&baseline.version.id===C.oldVersion&&applications.filter(x=>x.name===C.worker).length===0&&!ns.some(x=>x.script===C.worker&&x.class===C.className),'Baseline differs; inspect before proceeding');
 const vars=Object.fromEntries((baseline.version.resources?.bindings||[]).filter(x=>x.type==='plain_text').map(x=>[x.name,x.text]));must(vars.ISP_CONTAINER_ENABLED==='false'&&vars.ISP_STAGING_START_AT===''&&vars.ISP_STAGING_EXPIRES_AT==='');
 const intent={version:1,nonce:context.pack.nonce,source:context.pack.source,bundle_sha256:context.pack.bundle_sha256,metadata_sha256:context.pack.metadata_sha256,package_sha256:context.packageHash,config:context.config,created_at:new Date().toISOString(),baseline:{...baseline,namespace_ids:ns.map(x=>x.id),application_ids:applications.map(x=>x.id)}};
 const metadata=json(p('worker-upload-metadata.json')),code=bytes(p('worker-bundle.mjs')),body=new FormData();body.set('metadata',new Blob([canonical(metadata)],{type:'application/json'}));body.set('index.mjs',new File([code],'index.mjs',{type:'application/javascript+module'}));
 await oneShot({kind:'worker-put',intent,writeIntent:(k,v)=>durable(k+'-intent.json',v),writeOutcome:(k,v)=>durable(k+'-outcome.json',v),mutate:async()=>{await mutationGuard(context);await raw('PUT',W,body);},reconcile:()=>observeWorker(intent)});
 await createApp(context);
}
async function seal(){
 noAbort();noHandoff();must(!has('runtime.json')&&has('app-post-intent.json'),'Owned application intent required and runtime must be absent');const {intent,worker,app}=await reconcile();must(app,'Application creation not confirmed');
 const prepared=preparedRecord({source:intent.source,worker,app}),text=canonical(prepared),receipt={version:1,prepared_release_sha256:hash(text),namespace_id:worker.namespace_id,application_id:app.id,activation:false};
 identicalOrWrite('seal-intent.json',receipt);identicalOrWrite('prepared-release.json',prepared);must(hash(bytes(p('prepared-release.json')))===receipt.prepared_release_sha256);identicalOrWrite('sealed-idle.json',receipt);return receipt;
}
async function cleanup(){
 noHandoff();const intent=json(p('worker-put-intent.json'));let abortPersisted=false;
 try{if(!has('provision-abort.json'))durable('provision-abort.json',{version:1,nonce:intent.nonce,at:new Date().toISOString(),terminal:true});abortPersisted=true;}catch{}
 const until=Date.now()+300000,signal=AbortSignal.timeout(300000);
 const call=(method,path,body,allow404=false)=>{must(Date.now()<until,'Bootstrap cleanup budget exhausted');return raw(method,path,body,allow404,{signal,timeoutMs:Math.min(15000,until-Date.now()),emergency:true});};
 let ingressClosed=false,absent=false,creationConfirmed=false;
 // Ingress failure must never prevent deletion of verified owned compute.
 try{await call('POST',W+'/subdomain',{enabled:false,previews_enabled:false});}catch{}
 try{
  let worker=optional('provision-worker.json');if(!worker)worker=await observeWorker(intent);
  let app,known=optional('provision-app-identity.json');
  if(known){must(known.namespace_id===worker.namespace_id&&known.account===C.account&&known.name===C.worker&&uuid(known.id));const row=await call('GET',APP+'/'+known.id,undefined,true);app=row?selectOwnedApplication([row],worker.namespace_id,intent.baseline.application_ids):null;creationConfirmed=true;}
  else{const rows=await call('GET',APP+'?per_page=100');must(Array.isArray(rows)&&rows.length<100);app=selectOwnedApplication(rows,worker.namespace_id,intent.baseline.application_ids);creationConfirmed=!!app||!has('app-post-intent.json');}
  if(app){
   if(!has('app-delete-intent.json'))try{durable('app-delete-intent.json',{application_id:app.id,namespace_id:worker.namespace_id,at:new Date().toISOString()});}catch{}
   try{await call('DELETE',APP+'/'+app.id);}catch{}
  }
  for(let n=0;n<12&&Date.now()<until;n++){
   if(known||app){const row=await call('GET',APP+'/'+(known?.id||app.id),undefined,true);if(row)selectOwnedApplication([row],worker.namespace_id,intent.baseline.application_ids);else{absent=true;break;}}
   else{const rows=await call('GET',APP+'?per_page=100');must(Array.isArray(rows)&&rows.length<100);if(!selectOwnedApplication(rows,worker.namespace_id,intent.baseline.application_ids)){absent=true;break;}}
   await new Promise(r=>setTimeout(r,Math.min(2000,Math.max(1,until-Date.now()))));
  }
 }catch{}
 try{const ingress=await call('GET',W+'/subdomain');ingressClosed=ingress.enabled===false&&ingress.previews_enabled===false;}catch{}
 const partial={version:1,application_absent:absent,ingress_closed:ingressClosed,abort_persisted:abortPersisted,creation_outcome_confirmed:creationConfirmed,namespace_preserved:true,at:new Date().toISOString()};
 try{durable('bootstrap-cleanup-observation-'+randomUUID()+'.json',partial);}catch{}
 must(abortPersisted&&absent&&ingressClosed&&creationConfirmed,'Bootstrap shutdown or uncertain creation outcome remains unconfirmed');
 const existing=optional('provision-cleaned.json');if(existing)return existing;durable('provision-cleaned.json',partial);return partial;
}

function preparedContext(){
 const context=loadPackage(),prepared=validatePreparedRelease(json(p('prepared-release.json'))),preparedHash=hash(bytes(p('prepared-release.json'))),sealed=json(p('sealed-idle.json'));
 must(sealed.prepared_release_sha256===preparedHash&&prepared.worker_source===context.pack.source);return {...context,prepared,preparedHash};
}
function finishHandoff(){
 noAbort();const context=preparedContext(),intent=json(p('watchdog-handoff-intent.json'));must(intent.prepared_release_sha256===context.preparedHash);
 finishHandoffRecords(intent,{writeOrVerify:identicalOrWrite});return {prepared:true,activation:false,handoff:true};
}
function prepareRuntime(){
 noAbort();noHandoff();const context=preparedContext();must(!has('runtime.json')&&!has('watchdog-plan.json')&&!has('watchdog-handoff-intent.json'),'Runtime preparation is exclusive');
 const {grant}=grantFor(context,'runtime-window'),objects=runtimeObjects({prepared:context.prepared,preparedHash:context.preparedHash,seed:json(p('runtime-seed.json')),secrets:json(p('worker-secrets.json')),grant,packageHash:context.packageHash,helperHash:context.pack.helper_sha256,ciRun:context.pack.ci_run_id});
 durable('watchdog-handoff-intent.json',{version:1,prepared_release_sha256:context.preparedHash,...objects});return finishHandoff();
}
async function packageRelease(){
 noAbort();must(!has('provision-package.json')&&!has('worker-put-intent.json')&&!has('runtime.json')&&!has('prepared-release.json'),'Package outputs are exclusive');
 const proof=json(p('provision-source-proof.json')),source=proof.run?.head_sha,ciRun=validateCI(proof,source),built=await buildProof(ROOT);
 must(built.proof.bundle_sha256===proof.bundle_sha256,'Local bundle differs from successful CI bundle');
 for(const [name,digest] of Object.entries(built.proof.files))must(proof.files[name]===digest,'Local source differs from immutable CI source');
 const config=validateConfig(json(p('wrangler-v2.jsonc')),bytes(p('wrangler-v2.jsonc'))),seed=json(p('runtime-seed.json')),secrets=validateBindings(json(p('worker-secrets.json')),seed),nonce=randomUUID(),metadata=workerMetadata(config,secrets,{source,nonce,bundleHash:built.proof.bundle_sha256});
 textDurable('worker-bundle.mjs',built.code);durable('worker-upload-metadata.json',metadata);
 const pack={version:1,source,ci_run_id:ciRun,nonce,bundle_sha256:built.proof.bundle_sha256,metadata_sha256:hash(bytes(p('worker-upload-metadata.json'))),helper_sha256:built.proof.helper_sha256,source_proof_sha256:hash(bytes(p('provision-source-proof.json'))),config_sha256:C.configHash,seed_sha256:hash(bytes(p('runtime-seed.json'))),secrets_sha256:hash(bytes(p('worker-secrets.json')))};
 durable('provision-package.json',pack);return {prepared:true,source,ci_run_id:ciRun,package_sha256:hash(bytes(p('provision-package.json'))),helper_sha256:pack.helper_sha256,metadata_sha256:pack.metadata_sha256,runtime_created:false,network_requests:0};
}


function replaceBound(name,value,allowedHashes){
 const destination=p(name),current=hash(bytes(destination));must(allowedHashes.includes(current),'Local activation output changed unexpectedly');
 const temporary=name+'.'+randomUUID()+'.tmp';durable(temporary,value);fs.renameSync(p(temporary),destination);
}
function handoffForActivation(context,{early=true,repair=false}={}){
 const frozen=repair&&optional('active-capture-intent.json'),runtime=frozen?json(p('watchdog-handoff-intent.json')).runtime:json(p('runtime.json'));
 const handoff=frozen?frozen.previous_handoff:json(p('watchdog-handoff.json')),plan=json(p('watchdog-plan.json')),state=json(p('watchdog-state.json'));
 let alive=false;try{process.kill(state.pid,0);alive=true;}catch{}
 activationAdmission({prepared:context.prepared,preparedHash:context.preparedHash,runtime,plan,state,handoff,runtimeHash:hash(canonical(runtime)),planHash:hash(bytes(p('watchdog-plan.json'))),pidAlive:alive,early});
 return {runtime,plan,state,handoff,prepared:context.prepared};
}
async function activationGuard({early=true,repair=false}={}){
 must(!has('provision-abort.json')&&!has('sealed-activation-aborted.json'),'This release is aborted');
 const context=preparedContext(),authority=grantFor(context,'runtime-window');
 must(tokenInfo.kind===authority.grant.credential_kind&&(tokenInfo.kind==='oauth'||tokenInfo.id===authority.grant.token_id)&&Date.parse(tokenInfo.expires_on)>=Date.parse(authority.grant.runtime_expires_at),'Runtime credential does not cover exact window');
 const state=handoffForActivation(context,{early,repair});return {...context,...state,grant:authority.grant};
}
async function observeActive(context,enabled){
 const intent=json(p('active-worker-put-intent.json')),first=await deployment(),ns=await namespaces(),content=await get(W+'/content/v2'),ingress=await get(W+'/subdomain'),last=await deployment();
 must(first.deployment.id===last.deployment.id&&first.version.id===last.version.id,'Serving deployment changed during active observation');
 const config={...context.config,vars:Object.fromEntries(Object.keys(context.config.vars).map(name=>[name,context.runtime[name]]))};
 const observed={...first,namespaces:ns,content,ingress},worker=verifyWorker(observed,intent,config,enabled);must(worker.namespace_id===context.prepared.namespace_id);
 const app=selectOwnedApplication(await apps(),worker.namespace_id);must(app?.id===context.prepared.application_id,'Sealed application mismatch');
 const detail=await get(APP+'/'+app.id),instances=await get(APP+'/'+app.id+'/instances-v2?per_page=100');
 must(detail.id===app.id&&detail.configuration?.image===imageRefLocal()&&detail.configuration.instance_type==='standard-2'&&detail.max_instances===1&&detail.scheduling_policy==='default'&&detail.instances===0&&Array.isArray(instances)&&instances.length<=1&&instances.every(x=>x.application_id===app.id));
 if(!enabled)verifyInactiveApplication(detail,instances);
 durable('active-observation-'+randomUUID()+'.json',{...observed,app:detail,instances});return worker;
}
function imageRefLocal(){return 'registry.cloudflare.com/'+C.account+'/isp-member-rails@'+C.digest;}
function captureActive(context,worker){
 let capture=optional('active-capture-intent.json');
 if(!capture){
  const nextRuntime={...context.runtime,CLOUDFLARE_WORKER_VERSION:worker.worker_version,CLOUDFLARE_DEPLOYMENT_ID:worker.deployment_id};
  const receipt={...preparedTuple({...context.prepared,prepared_release_sha256:context.preparedHash}),activation:true,worker_version:worker.worker_version,deployment_id:worker.deployment_id,ingress_enabled:true,observed_at:new Date().toISOString()};
  const nextHandoff={...context.handoff,runtime_sha256:hash(canonical(nextRuntime))};
  capture={version:1,prepared_release_sha256:context.preparedHash,previous_runtime_sha256:hash(canonical(context.runtime)),previous_handoff:context.handoff,next_runtime:nextRuntime,next_handoff:nextHandoff,receipt};
  durable('active-capture-intent.json',capture);
 }
 must(capture.prepared_release_sha256===context.preparedHash&&capture.receipt.worker_version===worker.worker_version&&capture.receipt.deployment_id===worker.deployment_id,'Frozen activation receipt differs');
 replaceBound('runtime.json',capture.next_runtime,[capture.previous_runtime_sha256,hash(canonical(capture.next_runtime))]);
 replaceBound('watchdog-handoff.json',capture.next_handoff,[hash(canonical(capture.previous_handoff)),hash(canonical(capture.next_handoff))]);
 identicalOrWrite('acceptance-release.json',capture.receipt);return {activation_ready:true,worker_version:worker.worker_version,deployment_id:worker.deployment_id};
}
async function emergencyStop(){
 const prepared=validatePreparedRelease(json(p('prepared-release.json'))),preparedHash=hash(bytes(p('prepared-release.json'))),plan=json(p('watchdog-plan.json'));
 const result=await stopStaging(plan,(path,method='GET',body,allow404=false,options={})=>raw(method,A+path,body,allow404,{...options,emergency:true}),(ms,{signal}={})=>new Promise((resolve,reject)=>{let timer;const aborted=()=>{clearTimeout(timer);reject(Error('Cleanup pause aborted'));};if(signal?.aborted)return aborted();timer=setTimeout(()=>{signal?.removeEventListener('abort',aborted);resolve();},ms);signal?.addEventListener('abort',aborted,{once:true});}),{context:leaseContext(LEASE2),prepared:{...prepared,prepared_release_sha256:preparedHash}});
 must(result.container_application_absent===true&&result.ingress_closed===true,'Sealed emergency shutdown unconfirmed');return result;
}
async function activate(){
 const context=await activationGuard();must(!has('active-worker-put-intent.json')&&!has('active-ingress-post-intent.json')&&!has('acceptance-release.json'),'Active mutations cannot be replayed');
 await controls();const inactive=await reconcile();must(inactive.app?.id===context.prepared.application_id&&inactive.worker.worker_version===context.prepared.rollback_worker_version&&inactive.worker.deployment_id===context.prepared.rollback_deployment_id,'Exact sealed inactive rollback required');
 const nonce=randomUUID(),metadata=activationMetadata(json(p('worker-upload-metadata.json')),context.prepared,context.runtime,nonce),body=new FormData();
 body.set('metadata',new Blob([canonical(metadata)],{type:'application/json'}));body.set('index.mjs',new File([bytes(p('worker-bundle.mjs'))],'index.mjs',{type:'application/javascript+module'}));
 const intent={version:1,nonce,source:context.pack.source,bundle_sha256:context.pack.bundle_sha256,metadata_sha256:hash(canonical(metadata)),prepared_release_sha256:context.preparedHash,baseline:{deployment:{id:context.prepared.rollback_deployment_id},version:{id:context.prepared.rollback_worker_version},namespace_ids:[]}};
 try{
  await oneShot({kind:'active-worker-put',intent,writeIntent:(k,v)=>durable(k+'-intent.json',v),writeOutcome:(k,v)=>durable(k+'-outcome.json',v),mutate:async()=>{await activationGuard();await raw('PUT',W,body);},reconcile:()=>observeActive(context,false)});
  await activationGuard();await controls();
  const worker=await oneShot({kind:'active-ingress-post',intent:{version:1,prepared_release_sha256:context.preparedHash,enabled:true,previews_enabled:false,at:new Date().toISOString()},writeIntent:(k,v)=>durable(k+'-intent.json',v),writeOutcome:(k,v)=>durable(k+'-outcome.json',v),mutate:async()=>{await activationGuard();activationIngressAllowed=true;try{await raw('POST',W+'/subdomain',{enabled:true,previews_enabled:false});}finally{activationIngressAllowed=false;}},reconcile:()=>observeActive(context,true)});
  return captureActive(context,worker);
 }catch{
  const stopped=await failureShutdown({persistAbort:()=>{if(!has('sealed-activation-aborted.json'))durable('sealed-activation-aborted.json',{version:1,prepared_release_sha256:context.preparedHash,at:new Date().toISOString()});},stop:emergencyStop,persistResult:result=>durable('activation-emergency-stop.json',result)});
  throw new Refused(stopped.shutdown_confirmed?'Activation failed; sealed shutdown verified; no mutation replay':'Activation failed; immediate sealed watchdog/operator shutdown required');
 }
}
async function reconcileActive(){
 if(has('sealed-activation-aborted.json')){
  const prepared=validatePreparedRelease(json(p('prepared-release.json'))),ingress=await get(W+'/subdomain'),app=await get(APP+'/'+prepared.application_id,true);
  return {aborted:true,activation_ready:false,application_present:app!==null,ingress_closed:ingress.enabled===false&&ingress.previews_enabled===false,mutations:false};
 }
 must(has('active-worker-put-intent.json')&&has('active-ingress-post-intent.json'),'Both actual activation intents are required');
 const context=await activationGuard({early:false,repair:true}),worker=await observeActive(context,true);return captureActive(context,worker);
}
async function reconcileRollback(){
 const prepared=validatePreparedRelease(json(p('prepared-release.json'))),intent=json(p('worker-put-intent.json')),worker=await observeWorker(intent,{persistIdentity:false}),ingress=await get(W+'/subdomain'),app=await get(APP+'/'+prepared.application_id,true);
 must(worker.worker_version===prepared.rollback_worker_version&&worker.namespace_id===prepared.namespace_id&&ingress.enabled===false&&ingress.previews_enabled===false&&app===null,'Compatible inactive rollback and compute absence not confirmed');
 const result={version:1,inactive_rollback_verified:true,worker_version:worker.worker_version,deployment_id:worker.deployment_id,namespace_id:worker.namespace_id,application_absent:true,ingress_closed:true};
 identicalOrWrite('inactive-rollback-receipt.json',result);return result;
}
async function rollback(){
 const prepared=validatePreparedRelease(json(p('prepared-release.json')));must(has('watchdog-handoff.json')&&!has('rollback-deployment-post-intent.json'),'Rollback POST cannot be replayed');
 if(!has('sealed-activation-aborted.json'))durable('sealed-activation-aborted.json',{version:1,prepared_release_sha256:hash(bytes(p('prepared-release.json'))),at:new Date().toISOString()});
 await emergencyStop();await controls();
 const version=await get(W+'/versions/'+prepared.rollback_worker_version),binding=version.resources?.bindings?.find(x=>x.name==='RAILS_CONTAINER');
 must(version.id===prepared.rollback_worker_version&&binding?.class_name===C.className&&binding.namespace_id===prepared.namespace_id,'Compatible sealed rollback namespace required');
 const body={strategy:'percentage',versions:[{version_id:prepared.rollback_worker_version,percentage:100}],annotations:{'workers/message':'ISP sealed inactive rollback'}};
 return oneShot({kind:'rollback-deployment-post',intent:{version:1,prepared_release_sha256:hash(bytes(p('prepared-release.json'))),rollback_worker_version:prepared.rollback_worker_version,request_sha256:hash(canonical(body))},writeIntent:(k,v)=>durable(k+'-intent.json',v),writeOutcome:(k,v)=>durable(k+'-outcome.json',v),mutate:async()=>{rollbackVersionAllowed=prepared.rollback_worker_version;try{await raw('POST',W+'/deployments',body);}finally{rollbackVersionAllowed=null;}},reconcile:reconcileRollback});
}

function inspectLock(){
 const source=bytes(p('provision-operator.lock'),8192),lock=JSON.parse(source.toString('utf8'));return {...lock,sha256:hash(source)};
}
function recoverLock(nonce,digest){
 const source=bytes(p('provision-operator.lock'),8192),lock=JSON.parse(source.toString('utf8'));let state='unknown';
 try{process.kill(lock.pid,0);state='live';}catch(error){if(error.code==='ESRCH')state='absent';}
 const destination=staleLockRecovery({lock,currentHash:hash(source),expectedNonce:nonce,expectedHash:digest,pidState:state});
 if(has(destination))must(hash(bytes(p(destination)))===hash(source),'Historical lock differs');else{const fd=fs.openSync(p(destination),'wx',0o600);try{fs.writeFileSync(fd,source);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
 must(hash(bytes(p('provision-operator.lock')))==digest,'Lock changed during recovery');fs.unlinkSync(p('provision-operator.lock'));return {recovered:true,history:destination,provider_requests:0};
}

async function main(){
 const mode=process.argv[2];if(['--inspect-lock','--recover-lock'].includes(mode)){must(process.platform==='win32'&&normal(OWN)===normal(ROOT));fixed(PRIVATE,true);must((mode==='--inspect-lock'&&process.argv.length===3)||(mode==='--recover-lock'&&process.argv.length===7&&process.argv[3]==='--nonce'&&process.argv[5]==='--sha256'));console.log(JSON.stringify(mode==='--inspect-lock'?inspectLock():recoverLock(process.argv[4],process.argv[6])));return;}must(process.argv.length===3&&['--bundle-proof','--package','--preflight','--provision','--create-application','--reconcile','--seal','--cleanup','--prepare-runtime','--finish-handoff','--activate','--reconcile-active','--rollback','--reconcile-rollback'].includes(mode),'Explicit single release operation required');
 if(mode==='--bundle-proof'){const built=await buildProof(OWN.replaceAll('\\','/').replace(/\/$/,''));console.log(JSON.stringify(built.proof));return;}
 must(process.platform==='win32'&&normal(OWN)===normal(ROOT)&&process.versions.node==='24.21.0','Fixed Windows/D controller required');fixed(ROOT,true);fixed(PRIVATE,true);fixed(CREDENTIALS,true);
 lockNonce=randomUUID();durable('provision-operator.lock',{pid:process.pid,nonce:lockNonce,mode,at:new Date().toISOString()});let result;
 try{
  phase=mode;
  if(mode==='--package')result=await packageRelease();
  else if(mode==='--prepare-runtime')result=prepareRuntime();
  else if(mode==='--finish-handoff')result=finishHandoff();
  else{
   await authenticate();
   if(mode==='--activate')result=await activate();
   else if(mode==='--reconcile-active')result=await reconcileActive();
   else if(mode==='--rollback')result=await rollback();
   else if(mode==='--reconcile-rollback')result=await reconcileRollback();
   else if(mode==='--cleanup')result=await cleanup();
   else if(mode==='--reconcile'){const observed=await reconcile();result={reconciled:true,application_present:!!observed.app,namespace_id:observed.worker.namespace_id,mutations:false};}
   else if(mode==='--seal')result=await seal();
   else{const context=loadPackage();await mutationGuard(context);if(mode==='--preflight'){const before=await deployment(),ns=await namespaces(),applications=await apps();must(before.deployment.id===C.oldDeployment&&before.version.id===C.oldVersion&&!applications.some(x=>x.name===C.worker)&&!ns.some(x=>x.script===C.worker&&x.class===C.className),'Inactive baseline differs');result={preflight:true,source:context.pack.source,zero_isp_applications:true,mutations:false};}else{if(mode==='--provision')await provision(context);else await createApp(context);result=await seal();}}
  }
  console.log(JSON.stringify({ok:true,operation:mode,...result,provider_requests:requestCount+emergencyRequestCount,emergency_provider_requests:emergencyRequestCount,production_approved:false}));
 }finally{const lock=optional('provision-operator.lock');if(lock?.nonce===lockNonce)fs.unlinkSync(p('provision-operator.lock'));}
}
main().catch(error=>{console.error(JSON.stringify({error:error instanceof Refused?error.message:'Lease2 operation failed; private state preserved',phase,automatic_retries:0}));process.exitCode=1;});
