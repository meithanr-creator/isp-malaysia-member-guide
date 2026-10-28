// Fixed-D one-shot inactive provisioning. No activation or hosted application requests.
import fs from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {releaseProtocol,CONTROLLER_CENSUS_SCRIPT} from './lease2-provision-core.mjs';
import {validatePreparedRelease,preparedTuple,leaseContext,selectLease,assertLeaseMutationAllowed,LEGACY_LEASE,LEASE2,LEASE3} from './staging-lease-context.mjs';
import {LEASE3_POLICY,assertLease3Preflight,assertLease3SafetyBoundary,validateLease3AccessGrant} from './lease3-release-policy.mjs';
import {stopStaging} from './cloudflare-staging-watchdog.mjs';
import {readStagingCredential,validateVerifiedApiCredential} from './staging-credential-provider.mjs';
import {performProviderRequest,publicProviderOutcome} from './provider-request-outcome.mjs';
const selected=leaseContext(process.env.ISP_STAGING_LEASE===undefined?LEASE2:selectLease());
const {C,Refused,must,hash,blobHash,canonical,hex,uuid,validateCI,validateConfig,validateBindings,validateGrant,workerMetadata,applicationRequest,verifyWorker,selectOwnedApplication,verifyInactiveApplication,preparedRecord,oneShot,runtimeObjects,bootstrapFence,finishHandoffRecords,completeEnvelope,staleLockRecovery,assertHistoricalControllerState,assertControllerCensus,activationAdmission,assertActiveIngressReadback,activationMetadata,admitProviderRequest,failureShutdown}=releaseProtocol(selected.leaseId);
const ROOT='D:/Projects/isp-member-rails',PRIVATE=selected.privateRoot,CREDENTIALS=selected.credentialRoot;
const OWN=fileURLToPath(new URL('..',import.meta.url)),A='/accounts/'+C.account,W=A+'/workers/scripts/'+C.worker,APP=A+'/containers/applications';
const NOOP='node -e "console.log(\'ISP deployment is disabled; use the reviewed manual release procedure.\')"';
const SCRIPT='2add92d700014660819ef6b5d266f104',TRIGGER='338f5327-8486-4f8a-aa9a-b0ee4739f427';
let phase='arguments',lockNonce,token,tokenInfo,requestCount=0,emergencyRequestCount=0,activationIngressAllowed=false,rollbackVersionAllowed=null;
let providerEvidenceFailed=false,emergencyEvidenceMode=false;
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
function helperHash(root=ROOT){return hash(['script/lease2-provision-core.mjs','script/lease2-provision.mjs','script/staging-lease-context.mjs','script/cloudflare-staging-ops.mjs','script/cloudflare-staging-watchdog.mjs','script/staging-credential-provider.mjs','script/provider-request-outcome.mjs','script/lease3-release-policy.mjs','script/active-staging-admission.mjs','script/immutable-acceptance-evidence.mjs','script/staging-access-observations.mjs','script/staging-postgres-access.rb','script/staging-storage-access.rb'].map(x=>x+':'+hash(bytes(root+'/'+x))).join('\n'));}
async function buildProof(root){
 const require=createRequire(root+'/cloudflare/package.json');must(require('esbuild').version==='0.28.2');must(json(root+'/cloudflare/node_modules/@cloudflare/containers/package.json').version==='0.3.7');
 const b=await require('esbuild').build({absWorkingDir:root+'/cloudflare',entryPoints:['staging/index.js'],bundle:true,write:false,metafile:true,format:'esm',platform:'neutral',target:'es2022',external:['cloudflare:*']});
 must(b.outputFiles.length===1);const code=b.outputFiles[0].contents,files={};
 for(const name of Object.keys(b.metafile.inputs)){const abs=resolve(root+'/cloudflare',name);must(normal(abs).startsWith(normal(root)+'/'));if(!normal(abs).includes('/node_modules/'))files[abs.slice(root.length+1).replaceAll('\\','/')]=blobHash(bytes(abs));}
 for(const name of ['cloudflare/package.json','cloudflare/package-lock.json','script/lease2-provision-core.mjs','script/lease2-provision.mjs','script/staging-lease-context.mjs','script/cloudflare-staging-ops.mjs','script/cloudflare-staging-watchdog.mjs','script/staging-credential-provider.mjs','script/provider-request-outcome.mjs','script/lease3-release-policy.mjs','script/active-staging-admission.mjs','script/immutable-acceptance-evidence.mjs','script/staging-access-observations.mjs','script/staging-postgres-access.rb','script/staging-storage-access.rb'])files[name]=blobHash(bytes(root+'/'+name));
 return {code,proof:{bundle_sha256:hash(code),files,helper_sha256:helperHash(root)}};
}
function loadPackage(){
 const pack=json(p('provision-package.json')),proof=json(p('provision-source-proof.json'));must(pack.version===1&&hex(pack.source,40));validateCI(proof,pack.source);
 must(pack.ci_run_id===proof.run.id&&hash(bytes(p('provision-source-proof.json')))===pack.source_proof_sha256&&hash(bytes(p('worker-bundle.mjs')))===pack.bundle_sha256&&pack.bundle_sha256===proof.bundle_sha256&&helperHash()===pack.helper_sha256);
 const config=validateConfig(json(p(selected.configName)),bytes(p(selected.configName)));
 must(hash(bytes(p('worker-upload-metadata.json')))===pack.metadata_sha256&&hash(bytes(p('runtime-seed.json')))===pack.seed_sha256&&hash(bytes(p('worker-secrets.json')))===pack.secrets_sha256);
 return {pack,config,packageHash:hash(bytes(p('provision-package.json')))};
}
function grantFor(context,purpose='inactive-provision',allowExpired=false){
 const grant=json(p(purpose==='inactive-provision'?'inactive-provision-grant.json':'runtime-window-grant.json'));let grantOptions={};
 if(selected.leaseId===LEASE3){
  const authority=json(p('credential-access-authority.json')),accessGrant=json(p('credential-access-grant.json')),access=validateLease3AccessGrant(accessGrant,{authority});
  must(grant.credential_kind===access.credential_kind&&(grant.credential_kind==='oauth'||grant.token_id===accessGrant.token_id)&&grant.credential_access_sha256===access.access_sha256,'Exact credential-access grant binding required');
  if(purpose==='inactive-provision')must(grant.human_grant_reference===accessGrant.human_grant_reference,'Inactive package needs actual access authority');
  else{
   const ledgerBytes=bytes(p('cumulative-test-budget.json')),ledger=JSON.parse(ledgerBytes.toString('utf8')),runtimeAuthority=json(p('runtime-authority.json'));
   must(ledger.version===1&&ledger.cumulative_test_ceiling_usd===5&&['spent_or_committed_usd','other_reserved_usd','remaining_test_usd'].every(key=>Number.isFinite(ledger[key])&&ledger[key]>=0)&&Math.abs(ledger.spent_or_committed_usd+ledger.other_reserved_usd+ledger.remaining_test_usd-5)<1e-9,'Actual cumulative test budget ledger required');
   const existingRuntime=optional('runtime.json'),frozen=optional('watchdog-handoff-intent.json');
   grantOptions={authority,accessGrant,runtimeAuthority,prepared:context.prepared,remainingTestUsd:ledger.remaining_test_usd,budgetLedgerHash:hash(ledgerBytes),existingRuntime,existingRuntimeGrant:existingRuntime?frozen?.runtime_window_grant??null:null};
  }
  must(Date.parse(grant.runtime_expires_at??grant.expires_at)<=access.end,'Credential access must cover exact operation window');
 }
 const end=validateGrant(grant,{purpose,packageHash:context.packageHash,helperHash:context.pack.helper_sha256,source:context.pack.source,ciRun:context.pack.ci_run_id,preparedHash:context.preparedHash,allowExpired,...grantOptions});
 return {grant,end,grantOptions};
}
async function raw(method,path,body,allow404=false,options={}){
 const emergency=options.emergency===true||emergencyEvidenceMode;
 const admit=()=>{
 const budget=admitProviderRequest({normal:requestCount,emergency:emergencyRequestCount},{emergency});requestCount=budget.normal;emergencyRequestCount=budget.emergency;
 const getPaths=[W+'/deployments',W+'/content/v2',W+'/subdomain',A+'/workers/durable_objects/namespaces?per_page=1000',APP+'?per_page=100',A,A+'/builds/workers/'+SCRIPT+'/triggers','/user/tokens/verify'];
 const appPath=new RegExp('^'+APP+'/[a-f0-9-]{36}(?:/instances-v2\\?per_page=100)?$');
 must((method==='GET'&&(getPaths.includes(path)||appPath.test(path)||new RegExp('^'+W+'/versions/[a-f0-9-]{36}$').test(path)))||(method==='PUT'&&path===W)||(method==='POST'&&path===APP)||(method==='POST'&&path===W+'/subdomain'&&body?.previews_enabled===false&&(body.enabled===false||(activationIngressAllowed&&body.enabled===true)))||(method==='POST'&&path===W+'/deployments'&&rollbackVersionAllowed&&body?.strategy==='percentage'&&body.versions?.length===1&&body.versions[0].version_id===rollbackVersionAllowed&&body.versions[0].percentage===100)||(method==='DELETE'&&appPath.test(path)&&!path.includes('instances-v2')),'Provider path refused');
 };
 const headers={Authorization:'Bearer '+token,Accept:'application/json'};let value=body;
 if(body&&!(body instanceof FormData)){headers['Content-Type']='application/json';value=JSON.stringify(body);}
 try{
  const exchange=await performProviderRequest({method,endpoint:path,body:value,headers,allow404,admit,signal:options.signal,timeoutMs:options.timeoutMs??20000,bestEffortEvidence:emergency,
   persist:(kind,record)=>durable('provider-request-'+record.request_id+'-'+kind+'.json',record),
   parseSuccess:async(data,response,envelope)=>{
    must(!/rel=["']?next/i.test(response.headers.get('link')||''),'Partial provider page header refused');
    if(path===W+'/content/v2'){
     const type=response.headers.get('content-type')||'';must(type.startsWith('multipart/'),'Serving module response must be multipart');
     const form=await new Response(data,{headers:{'content-type':type}}).formData(),modules=[];
     for(const [name,file] of form){must(file instanceof File);modules.push({name,sha256:hash(Buffer.from(await file.arrayBuffer()))});}
     return {entrypoint:response.headers.get('cf-entrypoint'),modules};
    }
    return completeEnvelope(envelope);
   }});
  if(exchange.provider_outcome.evidence_write_failed)providerEvidenceFailed=true;
  return options.captureOutcome?exchange:exchange.value;
 }catch(error){if(publicProviderOutcome(error)?.evidence_write_failed)providerEvidenceFailed=true;throw error;}
}
const get=(path,allow404=false)=>raw('GET',path,undefined,allow404);
async function authenticate(){
 let credential=readStagingCredential({requiredUntil:Date.now(),leaseId:selected.leaseId});token=credential.token;
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
 must(selected.length===1&&selected[0].external_script_id===SCRIPT&&selected[0].build_command===NOOP&&selected[0].deploy_command===NOOP,'Build commands must remain inert');return {ingress,trigger:{script_id:selected[0].external_script_id,trigger_uuid:selected[0].trigger_uuid,build_command:selected[0].build_command,deploy_command:selected[0].deploy_command}};
}
async function deployment(){
 const rows=await get(W+'/deployments'),list=Array.isArray(rows)?rows:rows.deployments;must(Array.isArray(list)&&list.length>0);const d=list[0];must(uuid(d.id)&&d.versions?.length===1&&d.versions[0].percentage===100&&uuid(d.versions[0].version_id));
 return {deployment:d,version:await get(W+'/versions/'+d.versions[0].version_id)};
}
const namespaces=async()=>{const rows=await get(A+'/workers/durable_objects/namespaces?per_page=1000');must(Array.isArray(rows)&&rows.length<1000);return rows;};
const apps=async()=>{const rows=await get(APP+'?per_page=100');must(Array.isArray(rows)&&rows.length<100);return rows;};

function localRecord(file){try{const raw=bytes(file,65536);return {value:JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,'')),sha256:hash(raw)};}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function processState(pid){must(Number.isSafeInteger(pid)&&pid>0,'Controller PID observation required');try{process.kill(pid,0);return 'live';}catch(error){must(error.code==='ESRCH','Controller liveness unknown');return 'absent';}}
function currentControllerCensus(){
 const env={};for(const name of ['SystemRoot','SYSTEMROOT','WINDIR','windir','ComSpec','COMSPEC'])if(process.env[name]!==undefined)env[name]=process.env[name];
 env.TEMP='D:/Projects/isp-rails-tools/tmp';env.TMP=env.TEMP;env.PSModuleAnalysisCachePath=env.TEMP+'/isp-controller-module-analysis-cache';fixed(env.TEMP,true);if(fs.existsSync(env.PSModuleAnalysisCachePath))fixed(env.PSModuleAnalysisCachePath);
 const observed=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',CONTROLLER_CENSUS_SCRIPT],{cwd:ROOT,env,encoding:'utf8',shell:false,windowsHide:true,timeout:8000,maxBuffer:131072});
 must(!observed.error&&observed.status===0&&observed.signal===null&&typeof observed.stdout==='string'&&Buffer.byteLength(observed.stdout)<=131072&&observed.stderr==='','Complete bounded controller census required');
 try{return JSON.parse(observed.stdout.replace(/^\uFEFF/,''));}catch{throw new Refused('Controller census output incomplete');}
}
async function noParallelController(allowedWatchdogPid=null,boundary='preflight'){
 must(selected.leaseId===LEASE3&&['preflight','worker-put','create','seal','activate'].includes(boundary),'Fixed controller boundary required');
 let historical,currentLock,watchdogState=null;
 for(const leaseId of [LEGACY_LEASE,LEASE2,LEASE3]){
  const context=leaseContext(leaseId),lockEntry=localRecord(context.privateRoot+'/provision-operator.lock');
  if(lockEntry){const lock=lockEntry.value;must(lock&&typeof lock==='object'&&!Array.isArray(lock),'Controller lock malformed');const own=leaseId===selected.leaseId&&lock.pid===process.pid&&lock.nonce===lockNonce&&lock.mode===process.argv[2];must(own||processState(lock.pid)==='absent','Parallel provisioning controller refused');if(own)currentLock=lock;}
  const stateEntry=localRecord(context.privateRoot+'/watchdog-state.json');
  if(leaseId===LEGACY_LEASE)must(stateEntry,'Exact historical controller record required');
  if(stateEntry){
   const state=stateEntry.value;must(state&&typeof state==='object'&&!Array.isArray(state),'Controller state malformed');
   if(leaseId===LEGACY_LEASE){historical=stateEntry;if(!Object.hasOwn(state,'pid'))continue;}
   const expected=Number.isSafeInteger(allowedWatchdogPid)&&allowedWatchdogPid>0&&leaseId===selected.leaseId&&state.pid===allowedWatchdogPid;
   must(expected||processState(state.pid)==='absent','Parallel watchdog controller refused');if(expected){must(processState(state.pid)==='live','Selected watchdog is not live');watchdogState=state;}
  }
 }
 must(currentLock,'Exact current operator lock required');
 const observedAt=new Date().toISOString(),census=currentControllerCensus();
 const [retired,ingress]=await Promise.all([raw('GET',APP+'/'+C.oldApp,undefined,true,{captureOutcome:true}),get(W+'/subdomain')]);
 const retiredApplication={application_id:C.oldApp,http_status:retired.provider_outcome.http_status,ok:retired.provider_outcome.ok===true,absent:retired.value===null};
 must(historical,'Exact historical controller record required');
 assertHistoricalControllerState(historical.value,historical.sha256,{retiredApplication,ingress,observedAt});
 let prepared=null,preparedHash=null;
 if(allowedWatchdogPid!==null){const source=bytes(p('prepared-release.json'));prepared=validatePreparedRelease(JSON.parse(source.toString('utf8')),selected.leaseId);preparedHash=hash(source);}
 assertControllerCensus(census,{currentPid:process.pid,currentLock,currentNonce:lockNonce,mode:process.argv[2],allowedWatchdogPid,watchdogState,prepared,preparedHash});
 durable('controller-boundary-observation-'+randomUUID()+'.json',{version:1,boundary,observed_at:observedAt,historical_state_sha256:historical?.sha256??null,census,retired_application:retiredApplication,retired_request_id:retired.provider_outcome.request_id,ingress});
 return {state:'absent',observed_at:new Date().toISOString()};
}

function dependencyAccess(){
 // Receipts must come from actual read-only probes; this operator never invents PASS.
 const dbBytes=bytes(p('database-access-observation.json'),65536),r2Bytes=bytes(p('storage-access-observation.json'),65536),db=JSON.parse(dbBytes.toString('utf8')),r2=JSON.parse(r2Bytes.toString('utf8'));
 must(db.version===1&&db.kind==='postgresql-readonly-access'&&db.lease_id===LEASE3&&db.status==='PASS'&&db.read_only===true&&db.transaction_read_only==='on'&&db.ssl_verified===true&&/^TLSv1\.[23]$/.test(db.tls_protocol)&&typeof db.tls_cipher==='string'&&db.tls_cipher.length>0,'Fresh actual read-only database proof required');
 must(r2.version===1&&r2.kind==='r2-readonly-access'&&r2.lease_id===LEASE3&&r2.status==='PASS'&&r2.read_only===true&&r2.tls_verified===true&&r2.authenticated_head_status===200&&r2.authenticated_list_status===200&&r2.anonymous_denied===true&&([401,403].includes(r2.anonymous_status)||(r2.anonymous_status===400&&['InvalidArgument','InvalidRequest','AuthorizationHeaderMalformed','SignatureDoesNotMatch'].includes(r2.authentication_error_code)))&&r2.truncated===false&&r2.public_access_verified===true&&r2.private===true&&r2.access_verified===true,'Fresh actual private-storage access proof required');
 return {database:{...db,evidence_sha256:hash(dbBytes)},storage:{...r2,evidence_sha256:hash(r2Bytes)}};
}
async function freshPreflight(){
 must(selected.leaseId===LEASE3,'Only the fresh fixed lease may bootstrap');const dependencies=dependencyAccess(),started=Date.now(),first=await deployment();
 const [account,control,ns,applications,content]=await Promise.all([get(A),controls(),namespaces(),apps(),get(W+'/content/v2')]);const last=await deployment();
 const observation={observed_at:new Date(started).toISOString(),account,completeness:{applications:true,namespaces:true},first,last,content,migration_tag:first.version.resources?.script_runtime?.migration_tag,ingress:control.ingress,trigger:control.trigger,controller:await noParallelController(null,'preflight'),namespaces:ns,applications,dependencies};
 durable('preflight-observation-'+randomUUID()+'.json',observation);const proof=assertLease3Preflight(observation);return {baseline:first,ns,applications,proof};
}
async function liveSafety(phase,worker,applicationId,{watchdogPid=null}={}){
 if(selected.leaseId!==LEASE3)return;const intent=json(p('worker-put-intent.json')),dependencies=dependencyAccess(),started=Date.now();
 const [account,control,ns,applications]=await Promise.all([get(A),controls(),namespaces(),apps()]);let application,instances;
 if(phase!=='create'){[application,instances]=await Promise.all([get(APP+'/'+applicationId),get(APP+'/'+applicationId+'/instances-v2?per_page=100')]);}
 const observation={observed_at:new Date(started).toISOString(),account,completeness:{applications:true,namespaces:true,instances:phase!=='create'},ingress:control.ingress,trigger:control.trigger,controller:await noParallelController(watchdogPid,phase),namespaces:ns,applications,application,instances,dependencies};
 durable('safety-'+phase+'-'+randomUUID()+'.json',{observation});return assertLease3SafetyBoundary(observation,{phase,namespaceId:worker.namespace_id,applicationId,baselineNamespaceIds:intent.baseline.namespace_ids,baselineApplicationIds:intent.baseline.application_ids});
}

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
 await liveSafety('create',worker);const body=applicationRequest(worker.namespace_id);
 return oneShot({kind:'app-post',intent:{namespace_id:worker.namespace_id,request_sha256:hash(canonical(body)),created_at:new Date().toISOString()},writeIntent:(k,v)=>durable(k+'-intent.json',v),writeOutcome:(k,v)=>durable(k+'-outcome.json',v),mutate:async()=>{await mutationGuard(context);await liveSafety('create',worker);return await raw('POST',APP,body,false,{captureOutcome:true});},reconcile:()=>observeApp(intent,worker)});
}
async function provision(context){
 await mutationGuard(context);must(!has('worker-put-intent.json')&&!has('app-post-intent.json'),'Worker PUT cannot be replayed');
 const {baseline,ns,applications,proof}=await freshPreflight();
 const vars=Object.fromEntries((baseline.version.resources?.bindings||[]).filter(x=>x.type==='plain_text').map(x=>[x.name,x.text]));must(vars.ISP_CONTAINER_ENABLED==='false'&&vars.ISP_STAGING_START_AT===''&&vars.ISP_STAGING_EXPIRES_AT==='');
 const intent={version:1,lease_id:selected.leaseId,preflight:proof,container_name:json(p('worker-upload-metadata.json')).containers?.[0]?.name,nonce:context.pack.nonce,source:context.pack.source,bundle_sha256:context.pack.bundle_sha256,metadata_sha256:context.pack.metadata_sha256,package_sha256:context.packageHash,config:context.config,created_at:new Date().toISOString(),baseline:{...baseline,namespace_ids:ns.map(x=>x.id),application_ids:applications.map(x=>x.id)}};
 const metadata=json(p('worker-upload-metadata.json')),code=bytes(p('worker-bundle.mjs')),body=new FormData();body.set('metadata',new Blob([canonical(metadata)],{type:'application/json'}));body.set('index.mjs',new File([code],'index.mjs',{type:'application/javascript+module'}));
 await oneShot({kind:'worker-put',intent,writeIntent:(k,v)=>durable(k+'-intent.json',v),writeOutcome:(k,v)=>durable(k+'-outcome.json',v),mutate:async()=>{await mutationGuard(context);await noParallelController(null,'worker-put');return await raw('PUT',W,body,false,{captureOutcome:true});},reconcile:()=>observeWorker(intent)});
 await createApp(context);
}
async function seal(){
 noAbort();noHandoff();must(!has('runtime.json')&&has('app-post-intent.json'),'Owned application intent required and runtime must be absent');const {intent,worker,app}=await reconcile();must(app,'Application creation not confirmed');
 await liveSafety('seal',worker,app.id);const prepared=preparedRecord({source:intent.source,worker,app}),text=canonical(prepared),receipt={version:1,prepared_release_sha256:hash(text),namespace_id:worker.namespace_id,application_id:app.id,activation:false};
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
  if(known){must(known.namespace_id===worker.namespace_id&&known.account===C.account&&known.name===C.worker&&uuid(known.id));const row=await call('GET',APP+'/'+known.id,undefined,true);app=row?selectOwnedApplication([row],worker.namespace_id,intent.baseline.application_ids,{cleanup:true}):null;creationConfirmed=true;}
  else{const rows=await call('GET',APP+'?per_page=100');must(Array.isArray(rows)&&rows.length<100);app=selectOwnedApplication(rows,worker.namespace_id,intent.baseline.application_ids,{cleanup:true});creationConfirmed=!!app||!has('app-post-intent.json');}
  if(app){
   if(!has('app-delete-intent.json'))try{durable('app-delete-intent.json',{application_id:app.id,namespace_id:worker.namespace_id,at:new Date().toISOString()});}catch{}
   try{await call('DELETE',APP+'/'+app.id);}catch{}
  }
  for(let n=0;n<12&&Date.now()<until;n++){
   if(known||app){const row=await call('GET',APP+'/'+(known?.id||app.id),undefined,true);if(row)selectOwnedApplication([row],worker.namespace_id,intent.baseline.application_ids,{cleanup:true});else{absent=true;break;}}
   else{const rows=await call('GET',APP+'?per_page=100');must(Array.isArray(rows)&&rows.length<100);if(!selectOwnedApplication(rows,worker.namespace_id,intent.baseline.application_ids,{cleanup:true})){absent=true;break;}}
   await new Promise(r=>setTimeout(r,Math.min(2000,Math.max(1,until-Date.now()))));
  }
 }catch{}
 try{const ingress=await call('GET',W+'/subdomain');ingressClosed=ingress.enabled===false&&ingress.previews_enabled===false;}catch{}
 const partial={version:1,application_absent:absent,ingress_closed:ingressClosed,abort_persisted:abortPersisted,creation_outcome_confirmed:creationConfirmed,provider_evidence_complete:!providerEvidenceFailed,namespace_preserved:true,at:new Date().toISOString()};
 try{durable('bootstrap-cleanup-observation-'+randomUUID()+'.json',partial);}catch{}
 must(abortPersisted&&absent&&ingressClosed&&creationConfirmed&&!providerEvidenceFailed,'Bootstrap shutdown or uncertain creation outcome remains unconfirmed');
 const existing=optional('provision-cleaned.json');if(existing)return existing;durable('provision-cleaned.json',partial);return partial;
}

function preparedContext(){
 const context=loadPackage(),prepared=validatePreparedRelease(json(p('prepared-release.json')),selected.leaseId),preparedHash=hash(bytes(p('prepared-release.json'))),sealed=json(p('sealed-idle.json'));
 must(sealed.prepared_release_sha256===preparedHash&&prepared.worker_source===context.pack.source);return {...context,prepared,preparedHash};
}
function finishHandoff(){
 noAbort();const context=preparedContext(),intent=json(p('watchdog-handoff-intent.json'));must(intent.prepared_release_sha256===context.preparedHash);
 finishHandoffRecords(intent,{writeOrVerify:identicalOrWrite});return {prepared:true,activation:false,handoff:true};
}
function prepareRuntime(){
 noAbort();noHandoff();const context=preparedContext();must(!has('runtime.json')&&!has('watchdog-plan.json')&&!has('watchdog-handoff-intent.json'),'Runtime preparation is exclusive');
 const {grant,grantOptions}=grantFor(context,'runtime-window'),objects=runtimeObjects({prepared:context.prepared,preparedHash:context.preparedHash,seed:json(p('runtime-seed.json')),secrets:json(p('worker-secrets.json')),grant,packageHash:context.packageHash,helperHash:context.pack.helper_sha256,ciRun:context.pack.ci_run_id,grantOptions});
 durable('watchdog-handoff-intent.json',{version:1,prepared_release_sha256:context.preparedHash,...objects,...(selected.leaseId===LEASE3?{runtime_window_grant:grant}:{})});return finishHandoff();
}
async function packageRelease(){
 noAbort();must(!has('provision-package.json')&&!has('worker-put-intent.json')&&!has('runtime.json')&&!has('prepared-release.json'),'Package outputs are exclusive');
 const proof=json(p('provision-source-proof.json')),source=proof.run?.head_sha,ciRun=validateCI(proof,source),built=await buildProof(ROOT);
 must(built.proof.bundle_sha256===proof.bundle_sha256,'Local bundle differs from successful CI bundle');
 for(const [name,digest] of Object.entries(built.proof.files))must(proof.files[name]===digest,'Local source differs from immutable CI source');
 const config=validateConfig(json(p(selected.configName)),bytes(p(selected.configName))),seed=json(p('runtime-seed.json')),secrets=validateBindings(json(p('worker-secrets.json')),seed),nonce=randomUUID(),metadata=workerMetadata(config,secrets,{source,nonce,bundleHash:built.proof.bundle_sha256});
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
async function observeActiveWorker(context,enabled){
 const intent=json(p('active-worker-put-intent.json')),first=await deployment(),ns=await namespaces(),content=await get(W+'/content/v2'),ingress=await get(W+'/subdomain'),last=await deployment();
 durable('active-worker-observation-'+randomUUID()+'.json',{first,last,namespaces:ns,content,ingress});
 must(first.deployment.id===last.deployment.id&&first.version.id===last.version.id,'Serving deployment changed during active observation');
 const config={...context.config,vars:Object.fromEntries(Object.keys(context.config.vars).map(name=>[name,context.runtime[name]]))};
 const observed={...first,namespaces:ns,content,ingress},verified=verifyWorker(observed,intent,config,enabled);must(verified.namespace_id===context.prepared.namespace_id);
 return {observed,worker:{...verified,module_sha256:content.modules[0].sha256}};
}
async function observeActive(context,enabled){
 const {observed,worker}=await observeActiveWorker(context,enabled);
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
 const prepared=validatePreparedRelease(json(p('prepared-release.json')),selected.leaseId),preparedHash=hash(bytes(p('prepared-release.json'))),plan=json(p('watchdog-plan.json'));
 const result=await stopStaging(plan,(path,method='GET',body,allow404=false,options={})=>raw(method,A+path,body,allow404,{...options,emergency:true}),(ms,{signal}={})=>new Promise((resolve,reject)=>{let timer;const aborted=()=>{clearTimeout(timer);reject(Error('Cleanup pause aborted'));};if(signal?.aborted)return aborted();timer=setTimeout(()=>{signal?.removeEventListener('abort',aborted);resolve();},ms);signal?.addEventListener('abort',aborted,{once:true});}),{context:selected,prepared:{...prepared,prepared_release_sha256:preparedHash}});
 must(result.container_application_absent===true&&result.ingress_closed===true,'Sealed emergency shutdown unconfirmed');return {...result,provider_evidence_complete:!providerEvidenceFailed,...(providerEvidenceFailed?{status:'FAIL',shutdown_confirmed:false}: {})};
}
async function activate(){
 const context=await activationGuard();must(!has('active-worker-put-intent.json')&&!has('active-ingress-post-intent.json')&&!has('acceptance-release.json'),'Active mutations cannot be replayed');
 await controls();const inactive=await reconcile();must(inactive.app?.id===context.prepared.application_id&&inactive.worker.worker_version===context.prepared.rollback_worker_version&&inactive.worker.deployment_id===context.prepared.rollback_deployment_id,'Exact sealed inactive rollback required');
 await liveSafety('activate',inactive.worker,context.prepared.application_id,{watchdogPid:context.state.pid});
 const nonce=randomUUID(),metadata=activationMetadata(json(p('worker-upload-metadata.json')),context.prepared,context.runtime,nonce),body=new FormData();
 body.set('metadata',new Blob([canonical(metadata)],{type:'application/json'}));body.set('index.mjs',new File([bytes(p('worker-bundle.mjs'))],'index.mjs',{type:'application/javascript+module'}));
 const intent={version:1,container_name:metadata.containers?.[0]?.name,nonce,source:context.pack.source,bundle_sha256:context.pack.bundle_sha256,metadata_sha256:hash(canonical(metadata)),prepared_release_sha256:context.preparedHash,baseline:{deployment:{id:context.prepared.rollback_deployment_id},version:{id:context.prepared.rollback_worker_version},namespace_ids:[]}};
 try{
  const activeWorker=await oneShot({kind:'active-worker-put',intent,writeIntent:(k,v)=>durable(k+'-intent.json',v),writeOutcome:(k,v)=>durable(k+'-outcome.json',v),mutate:async()=>{const current=await activationGuard();await liveSafety('activate',inactive.worker,current.prepared.application_id,{watchdogPid:current.state.pid});return await raw('PUT',W,body,false,{captureOutcome:true});},reconcile:()=>observeActive(context,false)});
  await activationGuard();await controls();
  const worker=await oneShot({kind:'active-ingress-post',intent:{version:1,prepared_release_sha256:context.preparedHash,enabled:true,previews_enabled:false,at:new Date().toISOString()},writeIntent:(k,v)=>durable(k+'-intent.json',v),writeOutcome:(k,v)=>durable(k+'-outcome.json',v),mutate:async()=>{const current=await activationGuard();await liveSafety('activate',{namespace_id:current.prepared.namespace_id},current.prepared.application_id,{watchdogPid:current.state.pid});const fresh=await observeActiveWorker(current,false);assertActiveIngressReadback(activeWorker,fresh.worker);await activationGuard();activationIngressAllowed=true;try{return await raw('POST',W+'/subdomain',{enabled:true,previews_enabled:false},false,{captureOutcome:true});}finally{activationIngressAllowed=false;}},reconcile:()=>observeActive(context,true)});
  assertActiveIngressReadback(activeWorker,worker);return captureActive(context,worker);
 }catch{
  const stopped=await failureShutdown({persistAbort:()=>{if(!has('sealed-activation-aborted.json'))durable('sealed-activation-aborted.json',{version:1,prepared_release_sha256:context.preparedHash,at:new Date().toISOString()});},stop:emergencyStop,persistResult:result=>durable('activation-emergency-stop.json',result)});
  throw new Refused(stopped.shutdown_confirmed?'Activation failed; sealed shutdown verified; no mutation replay':'Activation failed; immediate sealed watchdog/operator shutdown required');
 }
}
async function reconcileActive(){
 if(has('sealed-activation-aborted.json')){
  const prepared=validatePreparedRelease(json(p('prepared-release.json')),selected.leaseId),ingress=await get(W+'/subdomain'),app=await get(APP+'/'+prepared.application_id,true);
  return {aborted:true,activation_ready:false,application_present:app!==null,ingress_closed:ingress.enabled===false&&ingress.previews_enabled===false,mutations:false};
 }
 must(has('active-worker-put-intent.json')&&has('active-ingress-post-intent.json'),'Both actual activation intents are required');
 const context=await activationGuard({early:false,repair:true}),worker=await observeActive(context,true),put=json(p('active-worker-put-outcome.json'));must(put.request_returned_success===true&&put.uncertain===false,'Confirmed original active PUT outcome required');assertActiveIngressReadback(put.observed,worker);return captureActive(context,worker);
}
async function reconcileRollback(){
 const prepared=validatePreparedRelease(json(p('prepared-release.json')),selected.leaseId),intent=json(p('worker-put-intent.json')),worker=await observeWorker(intent,{persistIdentity:false}),ingress=await get(W+'/subdomain'),app=await get(APP+'/'+prepared.application_id,true);
 must(worker.worker_version===prepared.rollback_worker_version&&worker.namespace_id===prepared.namespace_id&&ingress.enabled===false&&ingress.previews_enabled===false&&app===null,'Compatible inactive rollback and compute absence not confirmed');
 const result={version:1,inactive_rollback_verified:true,worker_version:worker.worker_version,deployment_id:worker.deployment_id,namespace_id:worker.namespace_id,application_absent:true,ingress_closed:true};
 identicalOrWrite('inactive-rollback-receipt.json',result);return result;
}
async function rollback(){
 const prepared=validatePreparedRelease(json(p('prepared-release.json')),selected.leaseId);must(has('watchdog-handoff.json')&&!has('rollback-deployment-post-intent.json'),'Rollback POST cannot be replayed');
 if(!has('sealed-activation-aborted.json'))durable('sealed-activation-aborted.json',{version:1,prepared_release_sha256:hash(bytes(p('prepared-release.json'))),at:new Date().toISOString()});
 await emergencyStop();await controls();
 const version=await get(W+'/versions/'+prepared.rollback_worker_version),binding=version.resources?.bindings?.find(x=>x.name==='RAILS_CONTAINER');
 must(version.id===prepared.rollback_worker_version&&binding?.class_name===C.className&&binding.namespace_id===prepared.namespace_id,'Compatible sealed rollback namespace required');
 const body={strategy:'percentage',versions:[{version_id:prepared.rollback_worker_version,percentage:100}],annotations:{'workers/message':'ISP sealed inactive rollback'}};
 return oneShot({kind:'rollback-deployment-post',intent:{version:1,prepared_release_sha256:hash(bytes(p('prepared-release.json'))),rollback_worker_version:prepared.rollback_worker_version,request_sha256:hash(canonical(body))},writeIntent:(k,v)=>durable(k+'-intent.json',v),writeOutcome:(k,v)=>durable(k+'-outcome.json',v),mutate:async()=>{rollbackVersionAllowed=prepared.rollback_worker_version;try{return await raw('POST',W+'/deployments',body,false,{captureOutcome:true});}finally{rollbackVersionAllowed=null;}},reconcile:reconcileRollback});
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
 if(['--package','--provision','--create-application','--seal','--prepare-runtime','--finish-handoff','--activate','--rollback'].includes(mode))assertLeaseMutationAllowed(selected);
 if(mode==='--cleanup')assertLeaseMutationAllowed(selected,{cleanup:true});
 if(mode==='--bundle-proof'){const built=await buildProof(OWN.replaceAll('\\','/').replace(/\/$/,''));console.log(JSON.stringify(built.proof));return;}
 must(process.platform==='win32'&&normal(OWN)===normal(ROOT)&&process.versions.node==='24.21.0','Fixed Windows/D controller required');fixed(ROOT,true);fixed(PRIVATE,true);fixed(CREDENTIALS,true);
 lockNonce=randomUUID();durable('provision-operator.lock',{pid:process.pid,nonce:lockNonce,mode,at:new Date().toISOString()});let result;
 try{
  phase=mode;emergencyEvidenceMode=mode==='--cleanup';
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
   else{const context=loadPackage();await mutationGuard(context);if(mode==='--preflight'){const observed=await freshPreflight();result={preflight:true,source:context.pack.source,predecessor:observed.proof.predecessor,zero_isp_applications:true,mutations:false};}else{if(mode==='--provision')await provision(context);else await createApp(context);result=await seal();}}
  }
  console.log(JSON.stringify({ok:true,operation:mode,...result,provider_requests:requestCount+emergencyRequestCount,emergency_provider_requests:emergencyRequestCount,production_approved:false}));
 }finally{const lock=optional('provision-operator.lock');if(lock?.nonce===lockNonce)fs.unlinkSync(p('provision-operator.lock'));}
}
main().catch(error=>{console.error(JSON.stringify({error:error instanceof Refused?error.message:'Lease2 operation failed; private state preserved',phase,automatic_retries:0,...(publicProviderOutcome(error)?{provider_outcome:publicProviderOutcome(error)}:{})}));process.exitCode=1;});
