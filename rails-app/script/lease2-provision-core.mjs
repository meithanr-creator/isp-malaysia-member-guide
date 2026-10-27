// Pure lease-2 release boundaries and one-shot mutation discipline.
import {createHash} from 'node:crypto';
import {publicProviderOutcome} from './provider-request-outcome.mjs';
import {validatePreparedRelease,preparedTuple,assertRuntimeRelease,assertWatchdogTuple,leaseContext,LEASE2,LEASE3} from './staging-lease-context.mjs';
import {LEASE3_POLICY,validateLease3InactiveConfig,lease3Migration,assertLease3Namespace,assertLease3ApplicationRows,validateLease3RuntimeGrant,assertObservedContainer,assertLease3CleanupIdentity} from './lease3-release-policy.mjs';
export const C=Object.freeze({
 account:'a9720867333b64a4f8ee70cdfd673eb9',worker:'isp-member-production',lease:'rails-staging-2',className:'RailsStaging2',
 host:'isp-member-production.meithan-r.workers.dev',rails:'80d32fddf88251a6608ba047a577ce16efe8c834',
 digest:'sha256:152480a896060eae82a380dc54f651e199ff1585cd5dd805d0d51b9f3a587d2a',
 configHash:'a18c41e5f95949823ddab603215f6f681547409c453f24cef827df97a8229232',
 oldApp:'a03ae965-44e9-40b6-9c10-3f8f2c659c34',oldNamespace:'a0e936fb9d634f59b1caaa1896b07a1f',
 oldVersion:'d6978392-76ac-4208-aaf9-e907be1939c0',oldDeployment:'1847c5bc-7b6e-4c0a-9eee-657f7c3476f1',
 repository:'meithanr-creator/isp-malaysia-member-guide',migration:'rails-staging-v2',
 checks:['rails_checks (sqlite)','rails_checks (postgresql)','container_build','cloudflare_adapter','cloudflare_scanner_runtime','neon_build_tools','virtual_browser_gate']
});
const C3=Object.freeze({...C,lease:LEASE3,className:LEASE3_POLICY.class_name,configHash:'dc4a3ff927acbf677a6cba86f77155396ccef02b9d36e8f2d8d79b303d901783',oldNamespace:LEASE3_POLICY.predecessor.namespace_id,oldVersion:LEASE3_POLICY.predecessor.worker_version,oldDeployment:LEASE3_POLICY.predecessor.deployment_id,migration:LEASE3_POLICY.migration_tag,metadataTag:'isp-v3-',retiredNamespaces:Object.freeze(LEASE3_POLICY.retired.map(row=>row.namespace_id))});
export const CONTROLLER_CENSUS_SCRIPT="$ErrorActionPreference='Stop'\n$ProgressPreference='SilentlyContinue'\nfunction Read-ISPControllerRows($rows) {\n  if($rows.Count -lt 1 -or $rows.Count -gt 8192){throw 'Incomplete process census'}\n  $result=@()\n  $seen=@{}\n  foreach($row in $rows){\n    if($null -eq $row -or $null -eq $row.ProcessId -or -not $row.Name -or [long]$row.ProcessId -lt 0 -or $seen.ContainsKey([long]$row.ProcessId)){throw 'Malformed process census row'}\n    $seen[[long]$row.ProcessId]=$true\n    if([string]$row.Name -ine 'node.exe'){continue}\n    if(-not $row.ProcessId -or -not $row.ExecutablePath -or -not $row.CommandLine -or -not $row.CreationDate){throw 'Unknown Node process identity'}\n    $line=[string]$row.CommandLine\n    $match=[regex]::Match($line,'(?s)^\\s*(?:\"[^\"]+\"|[^\\s\"]+)\\s+(?:\"(?<script>[^\"]+)\"|(?<script>[^\\s\"]+))(?<tail>.*)$')\n    if(-not $match.Success){throw 'Unknown Node command'}\n    $script=$match.Groups['script'].Value.Replace('\\','/').ToLowerInvariant()\n    $tail=$match.Groups['tail'].Value.Trim()\n    $kind=''\n    $controllerReference=$line -match '(?i)(?:lease2-provision|cloudflare-staging-watchdog|cloudflare-staging-ops)\\.mjs\\b'\n    if($script.StartsWith('-')){if($controllerReference){$kind='other'}else{continue}}\n    $name=($script -split '/')[-1]\n    if($name -eq 'lease2-provision.mjs'){$kind='provision'}\n    elseif($name -eq 'cloudflare-staging-watchdog.mjs'){$kind='watchdog'}\n    elseif($name -eq 'cloudflare-staging-ops.mjs'){$kind='other'}\n    elseif($script.StartsWith('-') -and $controllerReference){$kind='other'}\n    if(-not $kind){continue}\n    $exe=([string]$row.ExecutablePath).Replace('\\','/').ToLowerInvariant()\n    $fixed=$exe -eq 'd:/projects/isp-rails-tools/node24/node.exe' -and $script -eq ('d:/projects/isp-member-rails/script/'+$name)\n    $mode=if($tail -cmatch '^--[a-z-]+$'){$tail}else{'unknown'}\n    $created=([datetime]$row.CreationDate).ToUniversalTime().ToString('o')\n    $result+=@{pid=[long]$row.ProcessId;kind=$kind;fixed_identity=[bool]$fixed;mode=$mode;created_at=$created}\n  }\n  return $result\n}\ntry {\n  $at=[datetime]::UtcNow.ToString('o')\n  $rows=@(Get-CimInstance Win32_Process -ErrorAction Stop)\n  $observer=@($rows|Where-Object {[long]$_.ProcessId -eq $PID})\n  if($observer.Count -ne 1){throw 'Observer identity unavailable'}\n  $controllers=@(Read-ISPControllerRows $rows)\n  @{version=1;complete=$true;method='Win32_Process';observed_at=$at;process_count=$rows.Count;observer_pid=$PID;parent_pid=[long]$observer[0].ParentProcessId;controllers=$controllers}|ConvertTo-Json -Compress -Depth 5\n} catch {[Console]::Error.WriteLine('Controller census unavailable');exit 1}\n";
function makeProtocol(C){
function forbiddenNamespace(namespace){return (C.retiredNamespaces??[C.oldNamespace]).includes(namespace);}
function preserveRetiredNamespaces(rows){for(const retired of LEASE3_POLICY.retired){const found=rows.filter(row=>row.id===retired.namespace_id);must(found.length===1&&found[0].class===retired.class_name&&found[0].script===C.worker&&found[0].preview===undefined&&found[0].dispatch_namespace===undefined,'Retired namespace preservation required');}}

const imageRef=()=>'registry.cloudflare.com/'+C.account+'/isp-member-rails@'+C.digest;
class Refused extends Error {}
const must=(ok,reason='Lease2 release boundary refused')=>{if(!ok)throw new Refused(reason);};
const hash=value=>createHash('sha256').update(value).digest('hex');
const blobHash=value=>createHash('sha1').update('blob '+Buffer.byteLength(value)+'\0').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,null,2)+'\n';
const hex=(value,n)=>typeof value==='string'&&value.length===n&&/^[a-f0-9]+$/.test(value);
const uuid=value=>typeof value==='string'&&value.length===36&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
function instant(value){must(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value));const n=Date.parse(value);must(Number.isFinite(n)&&new Date(n).toISOString().replace('.000Z','Z')===value);return n;}
function validateCI(proof,source){
 const r=proof?.run;must(hex(source,40)&&r?.head_sha===source&&Number.isSafeInteger(r.id)&&r.id>0&&r.repository?.full_name===C.repository&&r.event==='push'&&r.head_branch==='production-readiness'&&r.path==='.github/workflows/rails-ci.yml'&&r.status==='completed'&&r.conclusion==='success','Exact successful push CI required');
 must(Array.isArray(proof.check_runs)&&proof.check_runs.length<100);
 for(const name of C.checks){const rows=proof.check_runs.filter(x=>x.name===name&&x.head_sha===source&&x.app?.slug==='github-actions'&&typeof x.details_url==='string'&&x.details_url.includes('/actions/runs/'+r.id+'/'));must(rows.length>0&&rows.every(x=>x.status==='completed'&&x.conclusion==='success'),'Required exact-source CI check missing');}
 must(hex(proof.bundle_sha256,64)&&proof.files&&typeof proof.files==='object'&&!Array.isArray(proof.files));return r.id;
}
function validateConfig(config,bytes){
 if(C.lease===LEASE3){must(hash(bytes)===C.configHash,'Reviewed lease3 inactive config required');return validateLease3InactiveConfig(config);}
 must(hash(bytes)===C.configHash&&config.name===C.worker&&config.account_id===C.account&&config.workers_dev===false&&config.preview_urls===false&&Array.isArray(config.routes)&&config.routes.length===0&&config.observability?.enabled===false,'Reviewed inactive config required');
 const v=config.vars;must(v?.ISP_CONTAINER_ENABLED==='false'&&v.APP_HOST===C.host&&v.ISP_STAGING_START_AT===''&&v.ISP_STAGING_EXPIRES_AT===''&&v.DB_SSLMODE==='verify-full'&&['ISP_DEMO_MODE','ISP_ACCOUNT_EMAILS_ENABLED','ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED'].every(k=>v[k]==='false'));
 must(config.containers?.length===1);const c=config.containers[0];must(c.name===C.worker&&c.class_name===C.className&&c.scheduling_policy==='default'&&c.image===imageRef()&&c.instance_type==='standard-2'&&c.max_instances===1&&c.observability?.enabled===false);
 must(JSON.stringify(config.durable_objects)===JSON.stringify({bindings:[{name:'RAILS_CONTAINER',class_name:C.className}]}));
 must(JSON.stringify(config.migrations)===JSON.stringify([{tag:'rails-container-v1',new_sqlite_classes:['RailsContainer']},{tag:C.migration,new_sqlite_classes:[C.className]}]));return config;
}
const SECRET_NAMES=['SECRET_KEY_BASE','ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY','ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY','ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT','ISP_STAGING_KEY','DATABASE_URL','STORAGE_BUCKET','AWS_REGION','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','STORAGE_ENDPOINT','STORAGE_FORCE_PATH_STYLE','MAIL_FROM'];
function validateBindings(secrets,seed){
 must(secrets&&Object.keys(secrets).length===SECRET_NAMES.length&&SECRET_NAMES.every(k=>typeof secrets[k]==='string'&&secrets[k].length>0));
 const keys=SECRET_NAMES.slice(0,5);must(seed&&Object.keys(seed).length===5&&keys.every(k=>hex(seed[k],k==='SECRET_KEY_BASE'?128:64)&&seed[k]===secrets[k])&&new Set(keys.map(k=>seed[k])).size===5,'Same reviewed seed required');
 const u=new URL(secrets.DATABASE_URL);must(['postgres:','postgresql:'].includes(u.protocol)&&u.hostname.replace('-pooler.','.')==='ep-delicate-frost-a1o15wrb.ap-southeast-1.aws.neon.tech'&&u.pathname==='/neondb'&&u.username&&u.password&&!u.hash&&(!u.port||u.port==='5432')&&u.searchParams.getAll('sslmode').length===1&&u.searchParams.get('sslmode')==='verify-full'&&[...u.searchParams.keys()].every(k=>['sslmode','channel_binding'].includes(k))&&u.searchParams.getAll('channel_binding').length<=1&&(!u.searchParams.has('channel_binding')||u.searchParams.get('channel_binding')==='require'));
 must(secrets.STORAGE_BUCKET==='isp-staging-private'&&secrets.STORAGE_ENDPOINT==='https://'+C.account+'.r2.cloudflarestorage.com'&&secrets.STORAGE_FORCE_PATH_STYLE==='true'&&secrets.AWS_REGION==='auto'&&secrets.MAIL_FROM==='staging@planterapp.co'&&/^[A-Za-z0-9_+/=-]{16,256}$/.test(secrets.AWS_ACCESS_KEY_ID)&&/^[A-Za-z0-9_+/=-]{32,256}$/.test(secrets.AWS_SECRET_ACCESS_KEY));return secrets;
}
function validateGrant(grant,{purpose,packageHash,helperHash,source,ciRun,preparedHash,now=Date.now(),allowExpired=false,...additional}={}){
 if(C.lease===LEASE3&&purpose==='runtime-window')return validateLease3RuntimeGrant(grant,{...additional,packageHash,helperHash,source,ciRun,preparedHash,now}).end;
 must(grant?.version===1&&grant.owner_authorized===true&&typeof grant.human_grant_reference==='string'&&grant.human_grant_reference.trim().length>=12&&grant.account===C.account&&grant.worker===C.worker&&grant.lease_id===C.lease&&grant.purpose===purpose&&grant.cumulative_test_ceiling_usd===5&&grant.image_digest===C.digest&&grant.config_sha256===C.configHash,'A real matching scoped human grant is required');
 must(grant.package_sha256===packageHash&&grant.helper_sha256===helperHash&&grant.worker_source===source&&grant.ci_run_id===ciRun,'Grant/source/package/helper mismatch');
 const start=instant(grant.starts_at),end=instant(grant.expires_at);must(end>start&&end-start<=60*60000&&start<=now&&(allowExpired||now<end),'Grant window unavailable');
 if(purpose==='inactive-provision'){must(grant.runtime_authorized===false&&grant.install_worker_bindings===true&&['oauth','api-token'].includes(grant.credential_kind)&&(grant.credential_kind==='oauth'||(grant.token_id&&typeof grant.token_id==='string')));}
 else {must(purpose==='runtime-window'&&grant.runtime_authorized===true&&grant.prepared_release_sha256===preparedHash);const a=instant(grant.runtime_start_at),b=instant(grant.runtime_expires_at);must(b>a&&b-a<=55*60000&&a>=start&&b<=end&&a<=now+60000&&b>now&&grant.cleanup_reserve_minutes===10);}
 return end;
}
function workerMetadata(config,secrets,{source,nonce,bundleHash}){
 must(hex(source,40)&&uuid(nonce)&&hex(bundleHash,64));return {
  main_module:'index.mjs',compatibility_date:config.compatibility_date,
  bindings:[...Object.entries(config.vars).map(([name,text])=>({name,type:'plain_text',text})),...SECRET_NAMES.map(name=>({name,type:'secret_text',text:secrets[name]})),{name:'RAILS_CONTAINER',type:'durable_object_namespace',class_name:C.className}],
  containers:[{class_name:C.className}],migrations:C.lease===LEASE3?lease3Migration():{old_tag:'rails-container-v1',new_tag:C.migration,steps:[{new_sqlite_classes:[C.className]}]},
  keep_bindings:['secret_text','secret_key'],observability:{enabled:false},
  annotations:{'workers/tag':(C.metadataTag??'isp-v2-')+nonce,'workers/message':source+' bundle:'+bundleHash}
 };
}
function applicationRequest(namespace){
 must(hex(namespace,32)&&!forbiddenNamespace(namespace));return {name:C.worker,scheduling_policy:'default',configuration:{image:imageRef(),instance_type:'standard-2'},instances:0,max_instances:1,durable_objects:{namespace_id:namespace},observability:{logs:{enabled:false}}};
}
function verifyWorker(observed,intent,config,expectedIngress=false){
 const {deployment:d,version:v,namespaces,content}=observed;
 must(uuid(d?.id)&&d.id!==intent.baseline.deployment.id&&d.versions?.length===1&&d.versions[0].percentage===100&&uuid(v?.id)&&v.id!==intent.baseline.version.id&&d.versions[0].version_id===v.id,'New single serving version/deployment required');
 must(v.annotations?.['workers/tag']===(C.metadataTag??'isp-v2-')+intent.nonce&&v.annotations?.['workers/message']===intent.source+' bundle:'+intent.bundle_sha256,'Worker attempt identity mismatch');
 const b=v.resources?.bindings;must(Array.isArray(b)&&b.length===Object.keys(config.vars).length+SECRET_NAMES.length+1&&new Set(b.map(x=>x.name)).size===b.length);const vars=Object.fromEntries(b.filter(x=>x.type==='plain_text').map(x=>[x.name,x.text]));must(JSON.stringify(Object.fromEntries(Object.entries(vars).sort()))===JSON.stringify(Object.fromEntries(Object.entries(config.vars).sort())),'Inactive Worker flags mismatch');
 must(SECRET_NAMES.every(name=>b.filter(x=>x.name===name&&x.type==='secret_text').length===1));
 const bindings=b.filter(x=>x.type==='durable_object_namespace');must(bindings.length===1);const binding=bindings[0];
 must(binding.name==='RAILS_CONTAINER'&&binding.class_name===C.className&&(binding.script_name===undefined||binding.script_name===C.worker)&&hex(binding.namespace_id,32)&&!forbiddenNamespace(binding.namespace_id)&&!intent.baseline.namespace_ids.includes(binding.namespace_id),'Fresh namespace is required');
 if(C.lease===LEASE3){assertLease3Namespace(binding.namespace_id,intent.baseline.namespace_ids);preserveRetiredNamespaces(namespaces);must(namespaces.filter(x=>x.script===C.worker&&x.class===C.className).length===1,'Conflicting fresh namespace');}
 const matches=namespaces.filter(x=>x.id===binding.namespace_id&&x.class===C.className&&x.script===C.worker&&x.preview===undefined&&x.dispatch_namespace===undefined);must(matches.length===1&&namespaces.filter(x=>x.class===C.className&&x.script===C.worker&&x.preview===undefined&&x.dispatch_namespace===undefined).length===1,'Unique namespace proof required');
 const runtime=v.resources?.script_runtime;must(runtime?.compatibility_date===config.compatibility_date);assertObservedContainer(runtime,C.className,{expectedContainerName:intent.container_name});
 must(content?.entrypoint==='index.mjs'&&content.modules?.length===1&&content.modules[0].name==='index.mjs'&&content.modules[0].sha256===intent.bundle_sha256,'Serving Worker module bytes could not be verified');
 must(observed.ingress?.enabled===expectedIngress&&observed.ingress.previews_enabled===false);return {namespace_id:binding.namespace_id,worker_version:v.id,deployment_id:d.id};
}
function selectOwnedApplication(apps,namespace,baselineIds=[],{cleanup=false}={}){
 must(Array.isArray(apps)&&hex(namespace,32)&&!forbiddenNamespace(namespace));
 const candidates=apps.filter(x=>x?.name===C.worker||x?.durable_objects?.namespace_id===namespace);
 if(C.lease===LEASE3){
  if(cleanup){const owned=apps.filter(row=>row?.durable_objects?.namespace_id===namespace);must(owned.length<=1,'Ambiguous cleanup namespace');if(!owned.length)return null;const app=owned[0];assertLease3CleanupIdentity(app,{lease_id:C.lease,account:C.account,worker:C.worker,class_name:C.className,application_id:app.id,namespace_id:namespace},{baselineApplicationIds:baselineIds});return app;}
  return assertLease3ApplicationRows(apps,{phase:candidates.length?'seal':'create',namespaceId:namespace,applicationId:candidates[0]?.id,baselineApplicationIds:baselineIds});
 }
 must(candidates.length<=1,'Ambiguous application identity');if(!candidates.length)return null;const a=candidates[0];
 must(a.name===C.worker&&a.account_id===C.account&&uuid(a.id)&&a.id!==C.oldApp&&!baselineIds.includes(a.id)&&a.durable_objects?.namespace_id===namespace,'Foreign application refused');return a;
}
function verifyInactiveApplication(app,instances){
 must(app?.scheduling_policy==='default'&&app.configuration?.image===imageRef()&&app.configuration.instance_type==='standard-2'&&app.instances===0&&app.max_instances===1,'Inactive application configuration mismatch');
 must(app.observability?.logs?.enabled===false||app.configuration?.observability?.logs?.enabled===false);
 must(Array.isArray(instances)&&instances.length===0,'Actual instance list must be empty');return app;
}
function preparedRecord({source,worker,app}){
 return validatePreparedRelease({version:1,lease_id:C.lease,account:C.account,worker:C.worker,application_name:C.worker,application_id:app.id,namespace_id:worker.namespace_id,class_name:C.className,worker_source:source,rails_source:C.rails,image_digest:C.digest,rollback_worker_version:worker.worker_version,rollback_deployment_id:worker.deployment_id,activation:false},C.lease);
}
async function oneShot({kind,intent,writeIntent,writeOutcome,mutate,reconcile}){
 await writeIntent(kind,intent);let sent=false,observation=null,requestOutcome=null,reconciliationFailure=null,reconciliationFailed=false;
 try{const exchange=await mutate();sent=true;requestOutcome=publicProviderOutcome(exchange?.provider_outcome);}catch(error){requestOutcome=publicProviderOutcome(error);}
 try{observation=await reconcile();}catch(error){reconciliationFailed=true;reconciliationFailure=publicProviderOutcome(error);}
 await writeOutcome(kind,{request_returned_success:sent,observed:observation,uncertain:!sent||observation===null,
  request_outcome:requestOutcome,reconciliation_failed:reconciliationFailed,reconciliation_request_outcome:reconciliationFailure});
 if(!sent||observation===null){const error=new Refused('Mutation outcome requires read-only reconciliation; do not replay it');error.provider_outcome=requestOutcome;throw error;}
 return observation;
}
function runtimeObjects({prepared,preparedHash,seed,secrets,grant,packageHash,helperHash,ciRun,now=Date.now(),grantOptions={}}){
 validatePreparedRelease(prepared,C.lease);validateBindings(secrets,seed);must(hex(preparedHash,64));
 validateGrant(grant,{...grantOptions,purpose:'runtime-window',packageHash,helperHash,source:prepared.worker_source,ciRun,preparedHash,now,prepared});
 const tuple=preparedTuple({...prepared,prepared_release_sha256:preparedHash});
 const runtime={...secrets,...seed,RAILS_ENV:'production',APP_HOST:C.host,DB_SSLMODE:'verify-full',ISP_DEMO_MODE:'false',ISP_ACCOUNT_EMAILS_ENABLED:'false',ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED:'false',ISP_CONTAINER_ENABLED:'true',ISP_STAGING_LEASE:C.lease,APPLICATION_ID:prepared.application_id,NAMESPACE_ID:prepared.namespace_id,CANDIDATE_COMMIT:prepared.worker_source,RAILS_SOURCE:prepared.rails_source,IMAGE_DIGEST:prepared.image_digest,ROLLBACK_WORKER_VERSION:prepared.rollback_worker_version,PREPARED_RELEASE_SHA256:preparedHash,ISP_STAGING_START_AT:grant.runtime_start_at,ISP_STAGING_EXPIRES_AT:grant.runtime_expires_at};
 return {runtime,plan:{...tuple,start_at:grant.runtime_start_at,expires_at:grant.runtime_expires_at},activation:false};
}

function bootstrapFence({aborted=false,cleaned=false,handedOff=false}={}, {cleanup=false}={}){
 must(!handedOff,'Bootstrap ownership handed off; use matching watchdog');
 if(!cleanup)must(!aborted&&!cleaned,'Provisioning is terminally aborted');
}
function finishHandoffRecords(intent,{writeOrVerify}){
 must(hex(intent.prepared_release_sha256,64)&&intent.runtime&&intent.plan);
 writeOrVerify('watchdog-plan.json',intent.plan);
 writeOrVerify('runtime.json',intent.runtime);
 const receipt={version:1,prepared_release_sha256:intent.prepared_release_sha256,runtime_sha256:hash(canonical(intent.runtime)),watchdog_plan_sha256:hash(canonical(intent.plan)),bootstrap_cleanup_retired:true};
 writeOrVerify('watchdog-handoff.json',receipt);return receipt;
}

function completeEnvelope(envelope){
 must(envelope?.success===true&&Object.hasOwn(envelope,'result'));
 for(const owner of [envelope,envelope.result_info,envelope.result]){
  if(!owner||typeof owner!=='object'||Array.isArray(owner))continue;
  for(const key of ['cursor','cursors','next_cursor','next_page_token','continuation_token']){
   const v=owner[key];must(v===undefined||v===null||v===''||(typeof v==='object'&&Object.values(v).every(x=>x===undefined||x===null||x==='')),'Partial provider page refused');
  }
  must(owner.has_more===undefined||owner.has_more===false,'Partial provider page refused');
 }
 const info=envelope.result_info,rows=Array.isArray(envelope.result)?envelope.result:envelope.result?.deployments;
 if(info){must(info.total_pages===undefined||info.total_pages===1||info.total_pages===0);must(info.page===undefined||info.page===1);if(Array.isArray(rows))for(const name of ['count','total_count'])must(info[name]===undefined||info[name]===rows.length,'Provider count does not match complete list');}
 return envelope.result;
}
function staleLockRecovery({lock,currentHash,expectedNonce,expectedHash,pidState}){
 must(lock&&Object.keys(lock).length===4&&Number.isSafeInteger(lock.pid)&&lock.pid>0&&uuid(lock.nonce)&&typeof lock.mode==='string'&&Number.isFinite(Date.parse(lock.at)));
 must(hex(currentHash,64)&&currentHash===expectedHash&&lock.nonce===expectedNonce&&pidState==='absent','Only the exact lock with a demonstrably absent owner may be recovered');
 return 'provision-operator.lock-history-'+lock.nonce+'.json';
}

function assertHistoricalControllerState(state,stateHash,{retiredApplication,ingress,observedAt,now=Date.now()}={}){
 const exact={armed:false,container_application_absent:true,ingress_closed:true,verified_at:'2026-10-26T09:55:57.343Z',application_id:'a03ae965-44e9-40b6-9c10-3f8f2c659c34',stop_at:'2026-10-26T09:54:50.000Z',updated_at:'2026-10-26T09:55:57.344Z'};
 must(C.lease===LEASE3&&state&&typeof state==='object'&&!Array.isArray(state)&&Object.keys(state).length===7&&Object.entries(exact).every(([key,value])=>state[key]===value)&&stateHash==='13c2a72dee8b05dfb5645bedd7087ba77cc321e5accfc91aaab8cf483691f55c','Exact historical terminal controller required');
 const at=Date.parse(observedAt);must(Number.isFinite(now)&&Number.isFinite(at)&&at<=now+5000&&now-at<=60000,'Current retirement observation required');
 must(retiredApplication?.application_id===exact.application_id&&retiredApplication.http_status===404&&retiredApplication.ok===true&&retiredApplication.absent===true&&ingress?.enabled===false&&ingress.previews_enabled===false,'Current exact historical compute absence and closed ingress required');
 return true;
}
function assertControllerCensus(census,{currentPid,currentLock,currentNonce,mode,allowedWatchdogPid=null,watchdogState=null,prepared=null,preparedHash=null,now=Date.now()}={}){
 const at=Date.parse(census?.observed_at),lockAt=Date.parse(currentLock?.at);
 must(C.lease===LEASE3&&census?.version===1&&census.complete===true&&census.method==='Win32_Process'&&Number.isSafeInteger(census.process_count)&&census.process_count>0&&census.process_count<=8192&&Number.isSafeInteger(census.observer_pid)&&census.observer_pid>0&&census.observer_pid!==currentPid&&census.parent_pid===currentPid,'Complete direct-child Windows controller census required');
 must(Number.isFinite(now)&&Number.isFinite(at)&&at<=now+5000&&now-at<=60000&&Number.isSafeInteger(currentPid)&&currentPid>0&&currentLock?.pid===currentPid&&uuid(currentNonce)&&currentLock.nonce===currentNonce&&currentLock.mode===mode&&Number.isFinite(lockAt)&&lockAt<=now+5000,'Current operator census identity required');
 const rows=census.controllers;must(Array.isArray(rows)&&rows.length<=256&&rows.length<=census.process_count&&new Set(rows.map(row=>row?.pid)).size===rows.length,'Complete distinct controller census required');
 must(rows.every(row=>row&&Number.isSafeInteger(row.pid)&&row.pid>0&&['provision','watchdog','other'].includes(row.kind)&&typeof row.fixed_identity==='boolean'&&typeof row.mode==='string'&&Number.isFinite(Date.parse(row.created_at))&&Date.parse(row.created_at)<=now+5000),'Controller process identity unknown');
 const own=rows.filter(row=>row.pid===currentPid);must(own.length===1&&own[0].kind==='provision'&&own[0].fixed_identity===true&&own[0].mode===mode&&Date.parse(own[0].created_at)<=lockAt+5000,'Exact current fixed operator required');
 if(allowedWatchdogPid!==null){
  must(Number.isSafeInteger(allowedWatchdogPid)&&allowedWatchdogPid>0&&allowedWatchdogPid!==currentPid&&watchdogState?.pid===allowedWatchdogPid&&watchdogState.armed===true,'Exact selected armed watchdog required');
  validatePreparedRelease(prepared,C.lease);must(hex(preparedHash,64));const tuple=preparedTuple({...prepared,prepared_release_sha256:preparedHash});
  must(Object.entries(tuple).every(([key,value])=>watchdogState[key]===value),'Exact sealed watchdog tuple required');
  const updated=Date.parse(watchdogState.updated_at);must(Number.isFinite(updated)&&updated<=now+5000&&now-updated<=45000&&Date.parse(watchdogState.stop_at)>now,'Fresh selected armed watchdog required');
  const found=rows.filter(row=>row.pid===allowedWatchdogPid);must(found.length===1&&found[0].kind==='watchdog'&&found[0].fixed_identity===true&&found[0].mode==='--arm'&&Date.parse(found[0].created_at)<=updated+5000,'Exact fixed live watchdog command required');
 }
 must(rows.every(row=>row.pid===currentPid||(allowedWatchdogPid!==null&&row.pid===allowedWatchdogPid)),'Parallel ISP controller refused');return true;
}

function activationAdmission({prepared,preparedHash,runtime,plan,state,handoff,runtimeHash,planHash,now=Date.now(),pidAlive=false,early=true}){
 validatePreparedRelease(prepared,C.lease);must(hex(preparedHash,64));const withHash={...prepared,prepared_release_sha256:preparedHash};
 assertRuntimeRelease(leaseContext(C.lease),runtime,withHash);assertWatchdogTuple(leaseContext(C.lease),runtime,plan,state,withHash);
 must(handoff&&Object.keys(handoff).length===5&&handoff.version===1&&handoff.bootstrap_cleanup_retired===true&&handoff.prepared_release_sha256===preparedHash&&handoff.runtime_sha256===runtimeHash&&handoff.watchdog_plan_sha256===planHash,'Complete exact watchdog handoff required');
 const start=instant(runtime.ISP_STAGING_START_AT),end=instant(runtime.ISP_STAGING_EXPIRES_AT),updated=Date.parse(state.updated_at);
 must(end>start&&end-start<=55*60000&&now>=start&&now<end-10*60000&&(!early||now<=start+120000),'Activation admission window unavailable');
 must(state.armed===true&&Number.isSafeInteger(state.pid)&&state.pid>0&&pidAlive&&Number.isFinite(updated)&&updated<=now+5000&&now-updated<=45000&&Date.parse(state.stop_at)===end-5*60000,'Live matching external watchdog required');return withHash;
}
function assertActiveIngressReadback(reference,readback){
 must(reference&&readback&&uuid(reference.worker_version)&&uuid(reference.deployment_id)&&hex(reference.namespace_id,32)&&hex(reference.module_sha256,64),'Reconciled active Worker proof required');
 for(const key of ['worker_version','deployment_id','namespace_id','module_sha256'])must(readback[key]===reference[key],'Active Worker differs from reconciled PUT');return readback;
}
function activationMetadata(base,prepared,runtime,nonce){
 validatePreparedRelease(prepared,C.lease);must(uuid(nonce));const out=structuredClone(base);must(out.migrations?.new_tag===C.migration&&out.containers?.length===1&&out.containers[0].class_name===C.className);
 delete out.migrations;
 for(const binding of out.bindings){
  if(binding.type==='plain_text'){must(typeof runtime[binding.name]==='string');binding.text=runtime[binding.name];}
  if(binding.type==='durable_object_namespace'){must(binding.name==='RAILS_CONTAINER'&&binding.class_name===C.className);binding.namespace_id=prepared.namespace_id;}
 }
 must(runtime.ISP_CONTAINER_ENABLED==='true'&&runtime.APP_HOST===C.host&&['ISP_DEMO_MODE','ISP_ACCOUNT_EMAILS_ENABLED','ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED'].every(k=>runtime[k]==='false'));instant(runtime.ISP_STAGING_START_AT);instant(runtime.ISP_STAGING_EXPIRES_AT);
 out.annotations['workers/tag']=(C.metadataTag??'isp-v2-')+nonce;return out;
}

function admitProviderRequest(counts,{emergency=false}={}){
 const next={...counts};const key=emergency?'emergency':'normal';
 must(Number.isSafeInteger(next[key])&&next[key]>=0&&next[key]<120,'Bounded provider request budget reached');next[key]++;return next;
}
async function failureShutdown({persistAbort,stop,persistResult}){
 let abortPersisted=false,result=null;
 try{await persistAbort();abortPersisted=true;}catch{}
 try{result=await stop();}catch{}
 if(result)try{await persistResult(result);}catch{}
 return {abort_persisted:abortPersisted,result,shutdown_confirmed:result?.container_application_absent===true&&result?.ingress_closed===true&&result?.provider_evidence_complete!==false&&result?.status!=='FAIL'};
}

return Object.freeze({C,imageRef,Refused,must,hash,blobHash,canonical,hex,uuid,instant,validateCI,validateConfig,SECRET_NAMES,validateBindings,validateGrant,workerMetadata,applicationRequest,verifyWorker,selectOwnedApplication,verifyInactiveApplication,preparedRecord,oneShot,runtimeObjects,bootstrapFence,finishHandoffRecords,completeEnvelope,staleLockRecovery,assertHistoricalControllerState,assertControllerCensus,activationAdmission,assertActiveIngressReadback,activationMetadata,admitProviderRequest,failureShutdown});
}
const LEASE2_PROTOCOL=makeProtocol(C),LEASE3_PROTOCOL=makeProtocol(C3);
export const {imageRef,Refused,must,hash,blobHash,canonical,hex,uuid,instant,validateCI,validateConfig,SECRET_NAMES,validateBindings,validateGrant,workerMetadata,applicationRequest,verifyWorker,selectOwnedApplication,verifyInactiveApplication,preparedRecord,oneShot,runtimeObjects,bootstrapFence,finishHandoffRecords,completeEnvelope,staleLockRecovery,assertHistoricalControllerState,assertControllerCensus,activationAdmission,assertActiveIngressReadback,activationMetadata,admitProviderRequest,failureShutdown}=LEASE2_PROTOCOL;
export function releaseProtocol(leaseId=LEASE2){if(leaseId===LEASE2)return LEASE2_PROTOCOL;if(leaseId===LEASE3)return LEASE3_PROTOCOL;throw Error("Explicit supported provisioning lease required");}
