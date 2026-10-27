// Read-only dependency observations. Import and --plan read no files or secrets.
import {randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseEnv} from 'node:util';
export const LEASE3='rails-staging-3';
export const ACCESS=Object.freeze({
 root:'D:/Projects/isp-member-rails',node:'D:/Projects/isp-rails-tools/node24/node.exe',
 ruby:'D:/Projects/isp-rails-tools/ruby34-devkit/bin/ruby.exe',
 gems:'D:/Projects/isp-rails-tools/gems',temp:'D:/Projects/isp-rails-tools/tmp',
 ca:'D:/Projects/isp-rails-tools/ruby34-devkit/lib/ruby/3.4.0/etc/ssl/cert.pem',
 project:'royal-glitter-45740959',host:'ep-delicate-frost-a1o15wrb.ap-southeast-1.aws.neon.tech',
 database:'neondb',account:'a9720867333b64a4f8ee70cdfd673eb9',bucket:'isp-staging-private',
 endpoint:'https://a9720867333b64a4f8ee70cdfd673eb9.r2.cloudflarestorage.com',
 read_ms:40000,cleanup_ms:5000,receipt_age_ms:60000,stdout_bytes:32768,stderr_bytes:8192
});
const KINDS=Object.freeze({database:'postgresql-readonly-access',storage:'r2-readonly-access'});
const LEAVES=Object.freeze({database:'database-access-observation.json',storage:'storage-access-observation.json'});
const AUTH_CODES=Object.freeze(['InvalidArgument','InvalidRequest','AuthorizationHeaderMalformed','SignatureDoesNotMatch']);
const CHILD_CODES=new Set(['postgresql_access_failed','r2_access_failed','r2_metadata_permission_required','r2_public_access_enabled','r2_metadata_incomplete','r2_anonymous_access_not_denied']);
const HEX=/^[a-f0-9]{64}$/;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export class AccessRefused extends Error{constructor(code){super('Read-only dependency observation refused');this.code=code;}}
const need=(ok,code)=>{if(!ok)throw new AccessRefused(code);};
const timestamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?Date.parse(v):NaN;
function common(v,kind,{startedAt,now}){
 need(object(v)&&v.version===1&&v.kind===kind&&v.lease_id===LEASE3&&v.status==='PASS'&&v.read_only===true,'receipt_not_actual_pass');
 const at=timestamp(v.observed_at);need(Number.isSafeInteger(now)&&Number.isSafeInteger(startedAt)&&Number.isFinite(at)&&at>=startedAt&&at<=now&&now-at<=ACCESS.receipt_age_ms,'receipt_start_time_or_age');
}
export function validateDatabaseReceipt(v,options){
 common(v,KINDS.database,options);
 need(v.transaction_read_only==='on'&&v.ssl_verified===true&&/^TLSv1\.[23]$/.test(v.tls_protocol)&&typeof v.tls_cipher==='string'&&v.tls_cipher.length>0&&v.tls_cipher.length<=160,'postgresql_readonly_tls_required');
 need(v.project===ACCESS.project&&v.host===ACCESS.host&&v.database===ACCESS.database&&v.pg_major===18&&v.sslmode==='verify-full','postgresql_fixed_target_required');
 const keys=['version','kind','lease_id','observed_at','status','read_only','transaction_read_only','ssl_verified','tls_protocol','tls_cipher','project','host','database','pg_major','sslmode'];
 return {...Object.fromEntries(keys.map(k=>[k,v[k]])),project_identity_basis:'approved_host_mapping; not_a_server_reported_project_id'};
}
export function validateStorageReceipt(v,options){
 common(v,KINDS.storage,options);
 need(v.tls_verified===true&&v.authenticated_head_status===200&&v.authenticated_list_status===200&&v.truncated===false&&v.access_verified===true,'r2_complete_authenticated_read_required');
 need(v.anonymous_denied===true&&([401,403].includes(v.anonymous_status)||(v.anonymous_status===400&&AUTH_CODES.includes(v.authentication_error_code))),'r2_anonymous_denial_required');
 need(v.bucket===ACCESS.bucket&&v.endpoint===ACCESS.endpoint,'r2_fixed_target_required');
 need(v.public_access_verified===true&&v.private===true&&v.managed_public_enabled===false&&v.custom_domains_disabled===true&&v.custom_domains_complete===true&&v.cf_managed_status===200&&v.cf_custom_status===200&&HEX.test(v.cf_managed_sha256)&&HEX.test(v.cf_custom_sha256),'r2_public_metadata_required');
 need(Number.isSafeInteger(v.object_count)&&v.object_count>=0&&v.object_count<=1000,'r2_complete_inventory_required');
 const keys=['version','kind','lease_id','observed_at','status','read_only','tls_verified','authenticated_head_status','authenticated_list_status','anonymous_denied','anonymous_status','truncated','public_access_verified','private','access_verified','bucket','endpoint','managed_public_enabled','custom_domains_disabled','custom_domains_complete','cf_managed_status','cf_custom_status','cf_managed_sha256','cf_custom_sha256','object_count'];
 const safe=Object.fromEntries(keys.map(k=>[k,v[k]]));
 if(v.anonymous_status===400)safe.authentication_error_code=v.authentication_error_code;
 return safe;
}
export function argumentsFor(args){
 if(args.length===0||JSON.stringify(args)===JSON.stringify(['--plan']))return {capture:false};
 need(JSON.stringify(args)===JSON.stringify(['--capture','--lease',LEASE3]),'fixed_capture_command_required');return {capture:true,leaseId:LEASE3};
}
export function plan(){
 return {version:1,kind:'staging_access_observation_plan',lease_id:LEASE3,executes:false,secret_reads:0,network_requests:0,database_writes:0,object_writes:0,
  targets:{project:ACCESS.project,host:ACCESS.host,database:ACCESS.database,bucket:ACCESS.bucket},
  operations:['PostgreSQL verify-full TLS and READ ONLY transaction','R2 authenticated HEAD and one complete bounded list','Unsigned S3 denial','Cloudflare managed and custom public-access metadata GETs'],
  bounds:{read_ms:ACCESS.read_ms,cleanup_ms:ACCESS.cleanup_ms,receipt_age_ms:ACCESS.receipt_age_ms,metadata_body_bytes:262144,s3_list_body_bytes:4194304},
  permission_gap:'Existing four-scope deployment key/OAuth does not establish R2 metadata read permission; missing permission is BLOCKED. No scope change or fallback.',
  execution_authority:false};
}
export function childEnvironment(kind,{local,r2,credential,inherited={}}){
 need(['database','storage'].includes(kind),'fixed_helper_required');
 const env={};for(const name of ['SystemRoot','SYSTEMROOT','WINDIR','windir','ComSpec','COMSPEC','USERPROFILE','USERNAME','USERDOMAIN','OS','PROCESSOR_ARCHITECTURE'])if(typeof inherited[name]==='string')env[name]=inherited[name];
 Object.assign(env,{PATH:'D:/Projects/isp-rails-tools/ruby34-devkit/bin;C:/Windows/System32',GEM_HOME:ACCESS.gems,GEM_PATH:ACCESS.gems,BUNDLE_GEMFILE:ACCESS.root+'/Gemfile',BUNDLE_USER_HOME:'D:/Projects/isp-rails-tools/bundle-home',TEMP:ACCESS.temp,TMP:ACCESS.temp,SSL_CERT_FILE:ACCESS.ca,ISP_STAGING_LEASE:LEASE3});
 if(kind==='database'){
  need(object(local)&&local.NEON_VERIFY_HOST===ACCESS.host&&local.DB_SSLMODE==='verify-full','postgresql_fixed_configuration_required');
  let url;try{url=new URL(local.DATABASE_URL_UNPOOLED);}catch{throw new AccessRefused('postgresql_fixed_configuration_required');}
  need(['postgres:','postgresql:'].includes(url.protocol)&&url.hostname===ACCESS.host&&url.pathname==='/'+ACCESS.database&&url.username&&url.password&&!url.hash&&(!url.port||url.port==='5432')&&url.searchParams.getAll('sslmode').length===1&&url.searchParams.get('sslmode')==='verify-full'&&[...url.searchParams.keys()].every(k=>['sslmode','channel_binding'].includes(k))&&url.searchParams.getAll('channel_binding').length<=1&&(!url.searchParams.has('channel_binding')||url.searchParams.get('channel_binding')==='require'),'postgresql_fixed_configuration_required');
  Object.assign(env,{DATABASE_URL_UNPOOLED:local.DATABASE_URL_UNPOOLED,NEON_VERIFY_HOST:ACCESS.host,DB_SSLMODE:'verify-full',PGSSLROOTCERT:ACCESS.ca});
 }else{
  need(object(r2)&&r2.STORAGE_BUCKET===ACCESS.bucket&&(r2.STORAGE_ENDPOINT===undefined||r2.STORAGE_ENDPOINT===ACCESS.endpoint)&&typeof r2.AWS_ACCESS_KEY_ID==='string'&&/^[A-Za-z0-9_+/=-]{16,256}$/.test(r2.AWS_ACCESS_KEY_ID)&&typeof r2.AWS_SECRET_ACCESS_KEY==='string'&&/^[A-Za-z0-9_+/=-]{32,256}$/.test(r2.AWS_SECRET_ACCESS_KEY),'r2_fixed_configuration_required');
  need(credential&&typeof credential.token==='string'&&/^[A-Za-z0-9._~+/-]{32,4096}={0,2}$/.test(credential.token),'r2_metadata_credential_required');
  Object.assign(env,{AWS_ACCESS_KEY_ID:r2.AWS_ACCESS_KEY_ID,AWS_SECRET_ACCESS_KEY:r2.AWS_SECRET_ACCESS_KEY,AWS_REGION:'auto',AWS_EC2_METADATA_DISABLED:'true',AWS_SHARED_CREDENTIALS_FILE:ACCESS.temp+'/no-shared-credentials',AWS_CONFIG_FILE:ACCESS.temp+'/no-shared-config',ISP_CF_METADATA_TOKEN:credential.token});
 }
 return env;
}
export function runReadHelper(spawn,kind,env,{readMs=ACCESS.read_ms,cleanupMs=ACCESS.cleanup_ms}={}){
 need(['database','storage'].includes(kind)&&typeof spawn==='function'&&Number.isSafeInteger(readMs)&&readMs>0&&readMs<=ACCESS.read_ms&&Number.isSafeInteger(cleanupMs)&&cleanupMs>0&&cleanupMs<=ACCESS.cleanup_ms,'fixed_helper_bound_required');
 return new Promise(resolve=>{
  let child,closed=false,settled=false,code=null,signal=null,failure=null,readTimer,cleanupTimer,stderrBytes=0,stdoutBytes=0;const chunks=[];
  const done=()=>{if(settled)return;settled=true;clearTimeout(readTimer);clearTimeout(cleanupTimer);resolve({closed,exit_code:code,signal,failure,stdout:Buffer.concat(chunks).toString('utf8'),stderr_bytes:stderrBytes,pid:child?.pid??null});};
  const stop=reason=>{failure??=reason;if(closed)return done();try{child?.kill('SIGKILL');}catch{}if(closed||settled)return done();if(cleanupTimer)return;cleanupTimer=setTimeout(()=>{if(!closed){failure='helper_process_cleanup_unverified';child?.stdout?.destroy();child?.stderr?.destroy();child?.unref();}done();},cleanupMs);};
  try{child=spawn(ACCESS.ruby,['-rbundler/setup',ACCESS.root+'/script/staging-'+(kind==='database'?'postgres':'storage')+'-access.rb'],{cwd:ACCESS.root,env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});}catch{failure='helper_spawn_failed';return done();}
  child.stdout.on('data',chunk=>{stdoutBytes+=chunk.length;if(stdoutBytes>ACCESS.stdout_bytes)return stop('helper_output_bound');chunks.push(Buffer.from(chunk));});
  child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;if(stderrBytes>ACCESS.stderr_bytes)stop('helper_output_bound');});
  child.once('error',()=>stop('helper_spawn_failed'));
  child.once('close',(exitCode,exitSignal)=>{closed=true;code=exitCode;signal=exitSignal;done();});
  readTimer=setTimeout(()=>stop('helper_timeout'),readMs);
 });
}
function decoded(outcome){
 need(object(outcome)&&outcome.closed===true,'helper_process_cleanup_unverified');
 need(!outcome.failure,outcome.failure??'helper_failed');
 let value;try{value=JSON.parse(outcome.stdout);}catch{throw new AccessRefused('helper_receipt_invalid');}
 if(value?.status!=='PASS'&&CHILD_CODES.has(value?.code))throw new AccessRefused(value.code);
 need(outcome.exit_code===0&&!outcome.signal,'helper_exit_not_successful');return value;
}
const failure=(kind,code,at)=>({version:1,kind:KINDS[kind],lease_id:LEASE3,observed_at:new Date(at).toISOString(),status:'FAIL',read_only:true,code});
export function invalidateReady(sink,code,at){
 for(const kind of ['database','storage'])sink.replaceReady(kind,{...failure(kind,code,at),status:'BLOCKED'});
}
export function finishObservations(outcomes,sink,{startedAt,now}){
 const receipts={},codes={};
 for(const kind of ['database','storage']){
  try{const value=decoded(outcomes[kind]);receipts[kind]=(kind==='database'?validateDatabaseReceipt:validateStorageReceipt)(value,{startedAt,now});}
  catch(error){codes[kind]=error instanceof AccessRefused?error.code:'helper_receipt_invalid';receipts[kind]=failure(kind,codes[kind],startedAt);}
 }
 const pass=Object.keys(codes).length===0;
 try{
  for(const kind of ['database','storage'])sink.archive(kind,receipts[kind]);
  sink.archive('processes',{version:1,kind:'staging-access-processes',lease_id:LEASE3,observed_at:new Date(now).toISOString(),helpers:Object.fromEntries(['database','storage'].map(kind=>{const o=outcomes[kind];return [kind,{helper:kind==='database'?'staging-postgres-access.rb':'staging-storage-access.rb',pid:Number.isSafeInteger(o?.pid)&&o.pid>0?o.pid:null,closed:o?.closed===true,exit_code:Number.isSafeInteger(o?.exit_code)?o.exit_code:null,signal:typeof o?.signal==='string'&&/^SIG[A-Z0-9]+$/.test(o.signal)?o.signal:null,failed:!!o?.failure}];}))});
  sink.archive('capture',{version:1,kind:'staging-access-capture',lease_id:LEASE3,status:pass?'PASS':'FAIL',observed_at:new Date(startedAt).toISOString(),read_only:true,codes});
  if(pass){for(const kind of ['database','storage'])sink.replaceReady(kind,receipts[kind]);}
  else invalidateReady(sink,'access_capture_failed',now);
 }catch{try{invalidateReady(sink,'access_receipt_persistence_failed',now);}catch{}throw new AccessRefused('access_receipt_persistence_failed');}
 return {status:pass?'PASS':'BLOCKED',lease_id:LEASE3,read_only:true,database:receipts.database.status,storage:receipts.storage.status,codes,
  process_cleanup:Object.values(outcomes).every(v=>v?.closed===true),database_writes:0,object_writes:0,execution_authority:false};
}
async function capture(){
 const fs=await import('node:fs'),path=await import('node:path'),{spawn}=await import('node:child_process'),{leaseContext}=await import('./staging-lease-context.mjs');
 const context=leaseContext(LEASE3),norm=p=>path.resolve(p).replaceAll(String.fromCharCode(92),'/').toLowerCase();
 const fixed=(p,directory=false)=>{const s=fs.lstatSync(p);need(!s.isSymbolicLink()&&norm(fs.realpathSync(p))===norm(p)&&(directory?s.isDirectory():s.isFile()),'fixed_capture_path_required');return s;};
 need(process.platform==='win32'&&process.versions.node==='24.21.0'&&norm(fs.realpathSync(process.execPath))===norm(ACCESS.node)&&norm(fileURLToPath(new URL('../',import.meta.url)))===norm(ACCESS.root),'fixed_capture_runtime_required');
 fixed(ACCESS.root,true);fixed(context.privateRoot,true);fixed(context.credentialRoot,true);fixed(ACCESS.temp,true);fixed(ACCESS.ca);fixed(ACCESS.ruby);
 for(const kind of ['postgres','storage'])fixed(ACCESS.root+'/script/staging-'+kind+'-access.rb');
 const id=randomUUID(),archiveRoot=context.privateRoot+'/access-observation-archives';
 try{fs.mkdirSync(archiveRoot,{mode:0o700});}catch(e){need(e.code==='EEXIST','access_archive_unavailable');}fixed(archiveRoot,true);
 const archive=archiveRoot+'/'+id;fs.mkdirSync(archive,{mode:0o700});fixed(archive,true);
 const write=(p,v,exclusive=false)=>{if(fs.existsSync(p))fixed(p);const bytes=JSON.stringify(v,null,2)+String.fromCharCode(10),temporary=exclusive?p:p+'.'+id+'.tmp',fd=fs.openSync(temporary,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(!exclusive)fs.renameSync(temporary,p);};
 const sink={archive:(kind,value)=>write(archive+'/'+kind+'.json',value,true),replaceReady:(kind,value)=>{const leaf=context.privateRoot+'/'+LEAVES[kind];try{write(leaf,value);}catch(error){if(fs.existsSync(leaf)){fixed(leaf);fs.unlinkSync(leaf);}throw error;}}};
 const lock=context.privateRoot+'/access-observation-capture.lock',lockRaw=id+String.fromCharCode(10),lockFd=fs.openSync(lock,'wx',0o600);
 try{
  fs.writeFileSync(lockFd,lockRaw);fs.fsyncSync(lockFd);
  invalidateReady(sink,'access_capture_in_progress',Date.now());
  const read=(p,max)=>{const s=fixed(p);need(s.size>0&&s.size<=max,'fixed_configuration_size_bound');return fs.readFileSync(p,'utf8').replace(/^\uFEFF/,'');};
  const local=parseEnv(read(ACCESS.root+'/.env.local',65536)),r2=JSON.parse(read(context.credentialRoot+'/r2.json',16384));
  const {readStagingCredential}=await import('./staging-credential-provider.mjs');
  const credential=readStagingCredential({leaseId:LEASE3,requiredUntil:Date.now()+ACCESS.read_ms+ACCESS.cleanup_ms});
  const dbEnv=childEnvironment('database',{local,inherited:process.env}),storageEnv=childEnvironment('storage',{r2,credential,inherited:process.env}),startedAt=Date.now();
  const [database,storage]=await Promise.all([runReadHelper(spawn,'database',dbEnv),runReadHelper(spawn,'storage',storageEnv)]);
  return {...finishObservations({database,storage},sink,{startedAt,now:Date.now()}),attempt_id:id};
 }catch(error){
  const code=error instanceof AccessRefused?error.code:'access_capture_failed';
  try{sink.archive('failure',{version:1,kind:'staging-access-capture',lease_id:LEASE3,status:'FAIL',observed_at:new Date().toISOString(),read_only:true,code});}catch{}
  try{invalidateReady(sink,code,Date.now());}catch{}
  throw error instanceof AccessRefused?error:new AccessRefused('access_capture_failed');
 }finally{
  fs.closeSync(lockFd);if(fs.existsSync(lock)){fixed(lock);need(fs.readFileSync(lock,'utf8')===lockRaw,'capture_lock_identity_mismatch');fs.unlinkSync(lock);}
 }
}
export async function main(args=process.argv.slice(2),{captureObservation=capture,log=console.log}={}){
 const selected=argumentsFor(args);if(!selected.capture){const value=plan();log(JSON.stringify(value));return value;}
 const result=await captureObservation();log(JSON.stringify(result));if(result.status!=='PASS')process.exitCode=1;return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(JSON.stringify({status:'BLOCKED',lease_id:LEASE3,code:error instanceof AccessRefused?error.code:'access_capture_failed',execution_authority:false}));process.exitCode=1;});
