// Registry-only transfer. No Worker/app deployment or runtime activation.
// Crane may retry identical content-addressed HTTP uploads internally; this helper never repeats an invocation.
import fs from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {createGunzip} from 'node:zlib';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readDeploymentToken,createReadonlyClient,inspectApplications} from './cloudflare-staging-ops.mjs';
const BASE='D:/Projects/isp-rails-tools/isp-staging-private/leases/rails-staging-2/image-transfer';
const CRANE='D:/Projects/isp-rails-tools/crane-v0.22.1/crane.exe',TAR='C:/Windows/System32/tar.exe';
const CRANE_SHA='e22e47202cece45d09fe92919bdb683f56f548d360cb96f6a852defd965c935d';
const ACCOUNT='a9720867333b64a4f8ee70cdfd673eb9',WORKER='isp-member-production';
const SCRIPT='2add92d700014660819ef6b5d266f104',TRIGGER='338f5327-8486-4f8a-aa9a-b0ee4739f427';
const SOURCE='80d32fddf88251a6608ba047a577ce16efe8c834',WORKFLOW='73add85e87235caccb8661208b8fe28a5cdd0a2c';
const RUN=40351242941,JOB=121671738041,ARTIFACT=12664935022;
const ZIP_SHA='a9fa0c7dbfe3c340e361809fbb23e7e77e9b01f2a1495be69f79d44679251a1e';
const REGISTRY='registry.cloudflare.com',REPO=`${REGISTRY}/${ACCOUNT}/isp-member-rails`,TAG=`${SOURCE}-gh${RUN}`,REF=`${REPO}:${TAG}`;
const ZIP=`${BASE}/artifact.zip`,GZ=`${BASE}/isp-rails-image.tar.gz`,IMAGE=`${BASE}/image.tar`;
const AUTH=`${BASE}/crane-auth`,AUTH_FILE=`${AUTH}/config.json`,ATTEMPT=`${BASE}/upload-attempt.json`;

const NOOP=`node -e "console.log('ISP deployment is disabled; use the reviewed manual release procedure.')"`;
const ACCEPT='application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json';
let stage='arguments',lastHTTP=null,lastExit=null,receipt=null,authCreated=false;
const guard=ok=>{if(!ok)throw Error('Image transfer refused');};
const normalize=p=>resolve(p).replaceAll('\\','/').toLowerCase();
function fixed(p,directory=false){const s=fs.lstatSync(p);guard(!s.isSymbolicLink()&&normalize(fs.realpathSync(p))===normalize(p)&&(directory?s.isDirectory():s.isFile()));return p;}
function absent(p){try{fs.lstatSync(p);return false;}catch(e){guard(e.code==='ENOENT');return true;}}
function bytes(name){const p=fixed(`${BASE}/${name}`);guard(fs.statSync(p).size<=2*1024*1024);return fs.readFileSync(p);}
const json=name=>JSON.parse(bytes(name).toString('utf8').replace(/^\uFEFF/,''));
const hash=b=>createHash('sha256').update(b).digest('hex');
async function hashStream(s){const h=createHash('sha256');for await(const c of s)h.update(c);return h.digest('hex');}
const hashFile=p=>hashStream(fs.createReadStream(fixed(p)));
function environment(){const e={};for(const k of ['SystemRoot','SYSTEMROOT','WINDIR','windir','ComSpec','COMSPEC','PATH','Path','PATHEXT','USERPROFILE','PROCESSOR_ARCHITECTURE'])if(process.env[k]!==undefined)e[k]=process.env[k];return {...e,DOCKER_CONFIG:AUTH,TEMP:'D:/Projects/isp-rails-tools/tmp',TMP:'D:/Projects/isp-rails-tools/tmp'};}
function tool(exe,args,timeout=300000,input){const r=spawnSync(exe,args,{cwd:BASE,env:environment(),windowsHide:true,shell:false,input,timeout,maxBuffer:2*1024*1024});lastExit=r.status;if(r.error||r.status!==0)fs.writeFileSync(BASE+'/tool-failure-'+Date.now()+'.json',JSON.stringify({stage,exit:r.status,code:r.error?.code,stdout:r.stdout?.toString(),stderr:r.stderr?.toString()},null,2),{mode:0o600,flag:'wx'});guard(!r.error&&r.status===0);return r.stdout;}
async function zipHash(member){const c=spawn(TAR,['-xOf',ZIP,'--',member],{cwd:BASE,env:environment(),windowsHide:true,shell:false,stdio:['ignore','pipe','ignore']});const done=new Promise((ok,no)=>{c.once('error',no);c.once('close',n=>n===0?ok():no(Error('Archive member refused')));});const timer=setTimeout(()=>c.kill(),120000);try{const [digest]=await Promise.all([hashStream(c.stdout),done]);return digest;}finally{clearTimeout(timer);if(c.exitCode===null)c.kill();}}
function durable(p,v){const fd=fs.openSync(p,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(v,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function save(){fixed(ATTEMPT);const tmp=ATTEMPT+'.tmp-'+randomBytes(6).toString('hex');durable(tmp,receipt);fs.renameSync(tmp,ATTEMPT);}
function imageConfig(c){guard(c?.os==='linux'&&c.architecture==='amd64'&&c.config?.User==='1000:1000'&&c.config?.Labels?.['org.opencontainers.image.revision']===SOURCE);}
export async function verify(){
 stage='offline_paths';fixed(BASE,true);for(const p of [ZIP,GZ,IMAGE,CRANE,TAR])fixed(p);
 guard(await hashFile(CRANE)===CRANE_SHA);guard(/^v?0\.22\.1$/.test(tool(CRANE,['version'],10000).toString().trim()));
 stage='artifact_proof';const metadata=json('artifact.json'),a=metadata.artifact,j=metadata.job,p=json('provenance.json'),ins=json('docker-image-inspect.json');
 guard(a?.id===ARTIFACT&&a.digest===`sha256:${ZIP_SHA}`&&a.name==='isp-reviewed-image-80d32fdd'&&a.expired===false&&a.workflow_run?.id===RUN&&a.workflow_run?.head_sha===WORKFLOW);
 guard(j?.id===JOB&&j.run_id===RUN&&j.head_sha===WORKFLOW&&j.name==='reviewed_image_artifact'&&j.status==='completed'&&j.conclusion==='success');guard(await hashFile(ZIP)===ZIP_SHA);
 const names=tool(TAR,['-tf',ZIP],30000).toString().trim().split(/\r?\n/),members=new Map(names.map(n=>[n.replace(/^\.\//,''),n]));const expected=['SHA256SUMS','docker-image-inspect.json','isp-rails-image.tar.gz','provenance.json'];
 guard(names.length===4&&members.size===4&&expected.every(n=>members.has(n)));
 for(const n of expected.filter(n=>n!=='isp-rails-image.tar.gz'))guard(hash(bytes(n))===await zipHash(members.get(n)));
 const gzSHA=await hashFile(GZ);guard(gzSHA===await zipHash(members.get('isp-rails-image.tar.gz'))&&gzSHA===p.archive_sha256);
 const sums=bytes('SHA256SUMS').toString().trim().split(/\r?\n/);guard(sums.length===1);const sum=sums[0].match(/^([a-f0-9]{64})[ \t]+\*?(?:image-export\/)?isp-rails-image\.tar\.gz$/);guard(sum&&sum[1]===gzSHA);
 guard(p.version===1&&p.repository==='meithanr-creator/isp-malaysia-member-guide'&&p.application_source===SOURCE&&p.actual_checkout===SOURCE&&p.workflow_source===WORKFLOW&&String(p.run_id)===String(RUN)&&String(p.run_attempt)===String(j.run_attempt)&&p.runtime_secrets===false&&p.os==='linux'&&p.architecture==='amd64'&&p.user==='1000:1000'&&/^sha256:[a-f0-9]{64}$/.test(p.image_id)&&p.scanner_checks==='Passed on this image before export');
 guard(Array.isArray(ins)&&ins.length===1&&ins[0].Id===p.image_id&&ins[0].Os==='linux'&&ins[0].Architecture==='amd64'&&ins[0].Config?.User==='1000:1000'&&ins[0].Config?.Labels?.['org.opencontainers.image.revision']===SOURCE);
 stage='docker_archive';const tarSHA=await hashFile(IMAGE),input=fs.createReadStream(GZ),decoded=createGunzip();input.on('error',e=>decoded.destroy(e));input.pipe(decoded);guard(tarSHA===await hashStream(decoded));
 const manifest=JSON.parse(tool(TAR,['-xOf',IMAGE,'--','manifest.json'],30000).toString());guard(Array.isArray(manifest)&&manifest.length===1&&JSON.stringify(manifest[0].RepoTags)===JSON.stringify([`isp-export:${SOURCE}`]));
 const cp=manifest[0].Config;guard(typeof cp==='string'&&/^(?:[a-f0-9]{64}\.json|blobs\/sha256\/[a-f0-9]{64})$/.test(cp));const cb=tool(TAR,['-xOf',IMAGE,'--',cp],30000);guard(`sha256:${hash(cb)}`===p.image_id);imageConfig(JSON.parse(cb.toString()));
 stage='full_local_validation';tool(CRANE,['validate','--tarball',IMAGE],360000);const digest=tool(CRANE,['digest','--tarball',IMAGE],240000).toString().trim();guard(/^sha256:[a-f0-9]{64}$/.test(digest));
 return {provider:'github-actions+crane',account:ACCOUNT,worker:WORKER,candidate:SOURCE,workflow_source:WORKFLOW,github_run_id:RUN,github_job_id:JOB,artifact_id:ARTIFACT,artifact_sha256:ZIP_SHA,archive_sha256:gzSHA,tar_sha256:tarSHA,image_id:p.image_id,expected_digest:digest,image:`${REPO}@${digest}`,runtime_started:false};
}
async function bodyBytes(r){const chunks=[];let size=0;if(r.body)for await(const c of r.body){size+=c.length;guard(size<=1024*1024);chunks.push(Buffer.from(c));}return Buffer.concat(chunks);}
async function api(token,path,method='GET',value){guard(method==='GET'||(method==='POST'&&path===`/accounts/${ACCOUNT}/containers/registries/${REGISTRY}/credentials`));const r=await fetch('https://api.cloudflare.com/client/v4'+path,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/json','Content-Type':'application/json'},body:value?JSON.stringify(value):undefined,redirect:'error',signal:AbortSignal.timeout(20000)});lastHTTP=r.status;guard(r.ok);const b=JSON.parse((await bodyBytes(r)).toString());guard(b?.success===true&&Object.hasOwn(b,'result'));return b.result;}
export function credentialMinutes(deadline,now=Date.now()){guard(Number.isFinite(deadline)&&Number.isFinite(now));const n=Math.min(10,Math.floor((deadline-now-60000)/60000));guard(n>=5);return n;}const minutes=credentialMinutes;
export function validateRegistryCredentialExpiry(jwt,{requestedMinutes,receivedAt,cutoff}){
 guard(Number.isInteger(requestedMinutes)&&requestedMinutes>=5&&requestedMinutes<=10&&Number.isSafeInteger(receivedAt)&&Number.isSafeInteger(cutoff));
 guard(Number.isSafeInteger(jwt?.exp));const expiry=jwt.exp*1000;
 guard(Number.isSafeInteger(expiry)&&expiry<=Math.min(cutoff,receivedAt+requestedMinutes*60000)&&expiry>receivedAt+4*60000);return expiry;
}
function budget(deadline,max){const n=Math.min(max,deadline-Date.now()-30000);guard(n>=1000);return n;}
async function registry(auth,suffix,method,deadline){const r=await fetch(`https://${REGISTRY}/v2/${ACCOUNT}/isp-member-rails/${suffix}`,{method,headers:{Authorization:auth,Accept:ACCEPT},redirect:'error',signal:AbortSignal.timeout(budget(deadline,20000))});lastHTTP=r.status;return r;}
async function head(auth,digest,deadline){const r=await registry(auth,`manifests/${TAG}`,'HEAD',deadline);guard(r.status===404||(r.status===200&&r.headers.get('docker-content-digest')===digest));return r.status;}
const PLAN_FIELDS=['version','purpose','account_id','registry_repository','candidate','workflow_source','github_run_id','github_job_id','artifact_id','artifact_sha256','expected_image_digest','helper_sha256','owner_authorized','runtime_authorized','total_test_ceiling_usd','starts_at','expires_at'];
function canonicalUTC(value){guard(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value));const ms=Date.parse(value);guard(Number.isFinite(ms)&&new Date(ms).toISOString()===value.replace(/Z$/,'.000Z'));return ms;}
export function validateRegistryUploadPlan(p,options={}){const {helperSha256,expectedDigest,now=Date.now()}=options;
 guard(p!==null&&typeof p==='object'&&!Array.isArray(p));guard(Object.keys(p).length===PLAN_FIELDS.length&&PLAN_FIELDS.every(k=>Object.hasOwn(p,k)));
 guard(p.version===1&&p.purpose==='registry-upload-only'&&p.owner_authorized===true&&p.runtime_authorized===false&&p.total_test_ceiling_usd===5);
 guard(p.account_id===ACCOUNT&&p.registry_repository===REPO&&p.candidate===SOURCE&&p.workflow_source===WORKFLOW&&p.github_run_id===RUN&&p.github_job_id===JOB&&p.artifact_id===ARTIFACT&&p.artifact_sha256===ZIP_SHA);
 guard(typeof helperSha256==='string'&&/^[a-f0-9]{64}$/.test(helperSha256)&&p.helper_sha256===helperSha256);guard(typeof p.expected_image_digest==='string'&&/^sha256:[a-f0-9]{64}$/.test(p.expected_image_digest));
 if(Object.hasOwn(options,'expectedDigest'))guard(typeof expectedDigest==='string'&&expectedDigest===p.expected_image_digest);
 const start=canonicalUTC(p.starts_at),cutoff=canonicalUTC(p.expires_at);guard(Number.isSafeInteger(now)&&now>=0&&cutoff>start&&cutoff-start<=60*60000&&now>=start&&now<cutoff);return Object.freeze({start,cutoff,expected_digest:p.expected_image_digest});
}
async function preflight(token,planDeadline){stage='token_active';const v=await api(token,'/user/tokens/verify');guard(v.status==='active');guard(Number.isFinite(planDeadline)&&typeof v.expires_on==='string');const expiry=Date.parse(v.expires_on);guard(Number.isFinite(expiry));const deadline=Math.min(planDeadline,expiry);minutes(deadline);stage='zero_applications';const apps=await inspectApplications(createReadonlyClient({token}));guard(apps.account_id===ACCOUNT&&apps.applications.length===0);stage='ingress_disabled';const ingress=await api(token,`/accounts/${ACCOUNT}/workers/scripts/${WORKER}/subdomain`);guard(ingress.enabled===false&&ingress.previews_enabled===false);stage='commands_inert';const rows=await api(token,`/accounts/${ACCOUNT}/builds/workers/${SCRIPT}/triggers`);guard(Array.isArray(rows));const selected=rows.filter(x=>x.trigger_uuid===TRIGGER);guard(selected.length===1);const t=selected[0];guard(t.external_script_id===SCRIPT&&t.repo_connection?.repo_name==='isp-malaysia-member-guide'&&t.repo_connection?.provider_account_name==='meithanr-creator'&&t.deploy_command===NOOP&&t.build_command===NOOP);return deadline;}
function cleanAuth(){if(!authCreated)return true;try{fixed(AUTH_FILE);fs.unlinkSync(AUTH_FILE);authCreated=false;return true;}catch{return false;}}
export async function upload(){
 stage='registry_upload_plan';fixed(BASE,true);
 const planBytes=bytes('registry-upload-plan.json'),planHash=hash(planBytes),plan=JSON.parse(planBytes.toString('utf8').replace(/^\uFEFF/,''));
 const helperFile=fixed(fileURLToPath(import.meta.url)),helperHash=hash(fs.readFileSync(helperFile));
 const checkPlan=expectedDigest=>{guard(hash(bytes('registry-upload-plan.json'))===planHash&&hash(fs.readFileSync(fixed(helperFile)))===helperHash);const options={helperSha256:helperHash};if(expectedDigest!==undefined)options.expectedDigest=expectedDigest;return validateRegistryUploadPlan(plan,options);};
 const allowed=checkPlan();minutes(allowed.cutoff);const proof=await verify();guard(typeof proof.expected_digest==='string');stage='registry_upload_plan_recheck';checkPlan(proof.expected_digest);minutes(allowed.cutoff);
 guard(absent(`${BASE}/push-reference.txt`)&&absent(AUTH));
 const initial={...proof,registry_tag:REF,upload_plan_sha256:planHash,helper_sha256:helperHash,authorized_starts_at:plan.starts_at,authorized_expires_at:plan.expires_at,started_at:new Date().toISOString(),phase:'prepared',may_have_uploaded:false,status:'pending'};stage='exclusive_attempt';durable(ATTEMPT,initial);receipt=initial;
 try{stage='authorization_before_credentials';checkPlan(proof.expected_digest);minutes(allowed.cutoff);stage='read_local_token';const token=readDeploymentToken(),cutoff=await preflight(token,allowed.cutoff);stage='authorization_before_jwt';checkPlan(proof.expected_digest);const n=minutes(cutoff);stage='temporary_registry_credentials';const c=await api(token,`/accounts/${ACCOUNT}/containers/registries/${REGISTRY}/credentials`,'POST',{expiration_minutes:n,permissions:['push','pull']});
 guard(c.account_id===ACCOUNT&&c.registry_host===REGISTRY&&typeof c.username==='string'&&c.username.length>0&&c.username.length<=256&&!/[:\s]/.test(c.username)&&typeof c.password==='string'&&c.password.length<=16384&&/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(c.password));const receivedAt=Date.now(),jwt=JSON.parse(Buffer.from(c.password.split('.')[1],'base64url').toString());const deadline=validateRegistryCredentialExpiry(jwt,{requestedMinutes:n,receivedAt,cutoff}),auth='Basic '+Buffer.from(`${c.username}:${c.password}`).toString('base64');
 stage='fresh_private_auth';fs.mkdirSync(AUTH,{mode:0o700});fixed(AUTH,true);authCreated=true;durable(AUTH_FILE,{auths:{}});tool(CRANE,['auth','login',REGISTRY,'--username',c.username,'--password-stdin'],budget(deadline,20000),c.password+'\n');fixed(AUTH_FILE);stage='before_tag_head';const before=await head(auth,proof.expected_digest,deadline);
 if(before===404){guard(await hashFile(IMAGE)===proof.tar_sha256);checkPlan(proof.expected_digest);stage='durable_push_intent';receipt.phase='push_intent';receipt.may_have_uploaded=true;receipt.push_intent_at=new Date().toISOString();save();stage='registry_push';const out=tool(CRANE,['push',IMAGE,REF,'--image-refs',`${BASE}/push-reference.txt`],budget(deadline,8*60000)).toString().trim();guard(out===proof.image&&bytes('push-reference.txt').toString().trim()===proof.image);}else receipt.existing_same_digest=true;
 stage='after_tag_head';guard(await head(auth,proof.expected_digest,deadline)===200);stage='remote_manifest';const r=await registry(auth,`manifests/${proof.expected_digest}`,'GET',deadline);guard(r.status===200&&r.headers.get('docker-content-digest')===proof.expected_digest);const raw=await bodyBytes(r);guard(`sha256:${hash(raw)}`===proof.expected_digest);const m=JSON.parse(raw.toString());guard(m.schemaVersion===2&&m.config?.digest===proof.image_id&&['application/vnd.docker.distribution.manifest.v2+json','application/vnd.oci.image.manifest.v1+json'].includes(m.mediaType));stage='fast_remote_validation';tool(CRANE,['validate','--remote',proof.image,'--fast'],budget(deadline,120000));stage='final_zero_applications';const apps=await inspectApplications(createReadonlyClient({token}));guard(apps.account_id===ACCOUNT&&apps.applications.length===0);stage='final_ingress_disabled';const ingress=await api(token,`/accounts/${ACCOUNT}/workers/scripts/${WORKER}/subdomain`);guard(ingress.enabled===false&&ingress.previews_enabled===false);const finalRows=await api(token,`/accounts/${ACCOUNT}/builds/workers/${SCRIPT}/triggers`);const finalTriggers=finalRows.filter(x=>x.trigger_uuid===TRIGGER);guard(finalTriggers.length===1&&finalTriggers[0].build_command===NOOP&&finalTriggers[0].deploy_command===NOOP);receipt.commands_inert=true;receipt.applications=0;receipt.ingress_closed=true;receipt.phase='confirmed';receipt.status='success';receipt.image_digest=proof.expected_digest;receipt.finished_at=new Date().toISOString();save();
 }catch{receipt.status=receipt.may_have_uploaded?'unknown':'failed_before_push';receipt.phase=receipt.status;receipt.failed_stage=stage;receipt.http_status=lastHTTP;receipt.child_exit=lastExit;receipt.finished_at=new Date().toISOString();try{save();}catch{}throw Error('Image upload refused or unconfirmed');}finally{receipt.auth_cleanup_pending=!cleanAuth();try{save();}catch{}}
 guard(receipt.auth_cleanup_pending===false);return receipt;
}
export async function main(args=process.argv.slice(2)){guard(args.length===1&&['--verify','--upload'].includes(args[0]));console.log(JSON.stringify(args[0]==='--verify'?await verify():await upload()));}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))main().catch(()=>{console.error(JSON.stringify({error:'Image transfer refused or unconfirmed; no credentials displayed',stage,http_status:lastHTTP,child_exit:lastExit,runtime_started:false}));process.exitCode=1;});