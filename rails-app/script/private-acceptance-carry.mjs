// Fixed historical evidence for the nine completed private identity cases.
// No provider calls, credentials export, actor restore or work on import.
import fs from 'node:fs';
import {readMobileCarry} from './private-acceptance-mobile.mjs';
import {readTailCarry} from './private-acceptance-tail.mjs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const CARRIED_CASE_IDS=Object.freeze(['edge_denial','health','visitor_denial','credential_rejection','member_login','admin_enrollment','profile_forgery','role_boundaries','response_headers']);
export const PRIVATE_ROOT='D:/Projects/isp-rails-tools/isp-staging-private';
export const CURRENT_ROOT=PRIVATE_ROOT+'/private-acceptance';
export const ARCHIVE_ROOT=PRIVATE_ROOT+'/private-acceptance-history/qa-20261027-913674d20bad';
const PRIOR_ARTIFACT_SHA256=Object.freeze({"packet.json":"80925d8803ea43c508892cc39a6965e401565a830d0b51d71f0adf24c8220243","runtime.json":"9c33cecab9807853b0cd38c9e94d2c13a65e2c24f472bbf8bbc584a76275add7","acceptance-http.json":"79333ac167b731d045a06fc04328929f127497772e9ec06ddfea5d17b825a271","result.json":"8e24804872566b3d5cba421dea0adc42b34e9397cfc8429389f409195aaad7f1","actor-retirement-result.json":"2f5b0af73359219b6ede87d3899b93962378cfa7a5f0817210332c373807ecbc","acceptance-db-identity-credential_rejection.json":"25fc3b9d281d97642280091fa02f0b8b66b7fb1a62e5cc0f491251cf05da3643","acceptance-db-identity-member_login.json":"25fc3b9d281d97642280091fa02f0b8b66b7fb1a62e5cc0f491251cf05da3643","acceptance-db-identity-admin_enrollment.json":"25fc3b9d281d97642280091fa02f0b8b66b7fb1a62e5cc0f491251cf05da3643","acceptance-db-identity-profile_forgery.json":"25fc3b9d281d97642280091fa02f0b8b66b7fb1a62e5cc0f491251cf05da3643"});
const MARKER='qa-20261027-913674d20bad',PRIOR_PACKET='80925d8803ea43c508892cc39a6965e401565a830d0b51d71f0adf24c8220243',PRIOR_NAMESPACE='5b9024adc423420191c2f27b13b141d3';
const SOURCE='80d32fddf88251a6608ba047a577ce16efe8c834',IMAGE='sha256:152480a896060eae82a380dc54f651e199ff1585cd5dd805d0d51b9f3a587d2a';
export const PROTECTED_BASELINE=Object.freeze({version:1,kind:'upload_recovery_tombstones',source_run_marker:MARKER,blob_ids:[2,3],upload_operation_id:'a9ab3941-9489-4764-8a09-6a765c0666ae',blob_rows_sha256:'ade7fc2601adff2d43055ad939d988f16e4c734b271dfb7ebe9c8413f102cd4a',source_retirement_result_sha256:'2f5b0af73359219b6ede87d3899b93962378cfa7a5f0817210332c373807ecbc'});
const hash=value=>createHash('sha256').update(value).digest('hex');
const check=(v,m)=>{if(!v)throw Error(m);};
const normalize=value=>value===null||typeof value!=='object'?value:Array.isArray(value)?value.map(normalize):Object.fromEntries(Object.keys(value).sort().map(k=>[k,normalize(value[k])]));
const canonical=value=>JSON.stringify(normalize(value));
const local=file=>process.platform==='linux'?file.replace(/^D:\//,'/mnt/d/'):file;
function exactDirectory(directory){check(/^[dD]:\//.test(directory),'Drive D evidence required');directory=local(directory);let current=directory;while(!fs.existsSync(current))current=path.dirname(current);for(;;){check(!fs.lstatSync(current).isSymbolicLink(),'Redirected evidence path refused');const parent=path.dirname(current);if(parent===current)break;current=parent;}check(fs.realpathSync(path.dirname(directory)).replaceAll('\\','/').toLowerCase()===path.dirname(directory).replaceAll('\\','/').toLowerCase(),'Resolved evidence parent changed');}
function buildRecord(directory){
 exactDirectory(directory);const artifacts={};
 const read=name=>{check(Object.hasOwn(PRIOR_ARTIFACT_SHA256,name),'Fixed historical filename required');const target=local(directory+'/'+name);check(!fs.lstatSync(target).isSymbolicLink(),'Redirected historical file refused');const raw=fs.readFileSync(target);check(raw.length>0&&raw.length<=16*1024*1024,'Bounded historical evidence required');check(hash(raw)===PRIOR_ARTIFACT_SHA256[name],'Original historical artifact bytes changed');artifacts[name]={sha256:hash(raw),bytes:raw.length};return JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,''));};
 const packet=read('packet.json'),runtime=read('runtime.json'),state=read('acceptance-http.json'),stop=read('result.json'),retired=read('actor-retirement-result.json');
 check(artifacts['packet.json'].sha256===PRIOR_PACKET&&packet.rails_source===SOURCE&&packet.image.endsWith('@'+IMAGE),'Original reviewed packet required');
 check(state.run_marker===MARKER&&state.prepared_release_sha256===PRIOR_PACKET&&state.rails_source===SOURCE&&state.image_digest===IMAGE&&state.namespace_id===PRIOR_NAMESPACE&&state.application_id===PRIOR_NAMESPACE,'Original historical run identity mismatch');
 check(state.halted===true&&canonical(state.completed_batches)===canonical(['identity']),'Original stopped checkpoint required');
 check(stop.shutdown==='PASS'&&stop.shutdown_facts?.application_absent===true&&stop.shutdown_facts.ingress_closed===true&&stop.shutdown_facts.application_id===PRIOR_NAMESPACE,'Historical shutdown proof required');
 check(artifacts['actor-retirement-result.json'].sha256===PROTECTED_BASELINE.source_retirement_result_sha256&&retired.status==='ACTORS_RETIRED_RECOVERY_RETAINED'&&retired.retained_blob_rows_sha256===PROTECTED_BASELINE.blob_rows_sha256,'Reviewed retirement required');
 const start=Date.parse(runtime.ISP_STAGING_START_AT),end=Date.parse(runtime.ISP_STAGING_EXPIRES_AT),stopped=Date.parse(stop.shutdown_facts.at);
 check(Number.isFinite(start)&&Number.isFinite(end)&&Number.isFinite(stopped)&&start<stopped&&stopped<=end&&end-start<=55*60000,'Original run window required');
 check(Object.values(state.cases).filter(c=>c.status==='PASS').length===9,'Exactly nine historical passes required');
 const cases=CARRIED_CASE_IDS.map(id=>{const c=state.cases[id];check(c?.status==='PASS'&&c.http==='PASS'&&Date.parse(c.started_at)>=start&&Date.parse(c.finished_at)<=stopped,'Historical case proof missing');
  if(c.db?.length){const name='acceptance-db-identity-'+id+'.json';check(String(c.observation_file).replaceAll('\\','/')===CURRENT_ROOT+'/'+name,'Original retained observation reference required');const obs=read(name);check(artifacts[name].sha256===c.observation_sha256&&obs.run_marker===MARKER&&obs.lease_id===state.lease_id&&canonical(obs.target)===canonical(state.target)&&Date.parse(obs.captured_at)>=Date.parse(c.observed_after)&&Date.parse(obs.captured_at)<=stopped,'Independent historical observation mismatch');}
  return {id,status:'PASS_CARRIED',http:'PASS',original_run_marker:MARKER,original_case_sha256:hash(JSON.stringify(c)),started_at:c.started_at,finished_at:c.finished_at,...(c.observation_sha256?{observation_sha256:c.observation_sha256,db_observed_at:c.db_observed_at}:{})};
 });
 return {version:1,kind:'historical_identity_carry',prior_run:{run_marker:MARKER,packet_sha256:PRIOR_PACKET,namespace_id:PRIOR_NAMESPACE,application_id:PRIOR_NAMESPACE,rails_source:SOURCE,image_digest:IMAGE,candidate:state.candidate,deployment_id:state.deployment_id,start_at:runtime.ISP_STAGING_START_AT,end_at:runtime.ISP_STAGING_EXPIRES_AT,stopped_at:stop.shutdown_facts.at},cases,artifacts,protected_baseline:PROTECTED_BASELINE};
}
export function validateHistoricalIdentityCarry(carry,native){
 const {runtime,prepared}=native??{},prior=carry?.prior_run;
 check(carry?.version===1&&carry.kind==='historical_identity_carry'&&prior?.packet_sha256===PRIOR_PACKET&&prior.namespace_id===PRIOR_NAMESPACE&&prior.rails_source===SOURCE&&prior.image_digest===IMAGE,'Historical carry identity mismatch');
 check(canonical(carry.cases?.map(c=>c.id))===canonical(CARRIED_CASE_IDS)&&carry.cases.every(c=>c.status==='PASS_CARRIED'&&c.http==='PASS'&&c.original_run_marker===MARKER),'Exact carried cases required');
 check(canonical(carry.protected_baseline)===canonical(PROTECTED_BASELINE),'Protected baseline changed');
 check(runtime?.ISP_ACCEPTANCE_CONTINUATION==='true'&&runtime.APP_HOST==='isp-rails-startup.meithan-r.workers.dev'&&prepared?.rails_source===SOURCE&&prepared.image_digest===IMAGE,'Compatible current Rails runtime required');
 check(/^[a-f0-9]{32}$/.test(prepared.namespace_id??'')&&prepared.namespace_id!==PRIOR_NAMESPACE&&prepared.application_id===prepared.namespace_id,'Fresh continuation namespace required');
 const start=Date.parse(runtime.ISP_STAGING_START_AT),end=Date.parse(runtime.ISP_STAGING_EXPIRES_AT);
 check(Number.isFinite(start)&&Number.isFinite(end)&&start>=Date.parse(prior.end_at)&&end>start&&end-start<=53*60000,'Fresh bounded continuation window required');
 return carry;
}
export function inspectPreviousAcceptance(){return buildRecord(CURRENT_ROOT);}
export function prepareHistoricalIdentityCarry(){return buildRecord(ARCHIVE_ROOT);}
export function readHistoricalIdentityCarry(native){
 exactDirectory(CURRENT_ROOT);check(!fs.lstatSync(local(CURRENT_ROOT+'/continuation-carry.json')).isSymbolicLink(),'Redirected carry refused');const raw=fs.readFileSync(local(CURRENT_ROOT+'/continuation-carry.json')),sha256=hash(raw);check(sha256===native?.prepared?.historical_carry_sha256,'Sealed historical carry binding required');
 const carry=JSON.parse(raw.toString('utf8'));check(canonical(carry)===canonical(buildRecord(ARCHIVE_ROOT)),'Archived historical evidence changed');validateHistoricalIdentityCarry(carry,native);return {...carry,sha256,...((native.prepared.final_tail||native.prepared.mobile_only)?{tail:readTailCarry(native)}:{}),...(native.prepared.mobile_only?{mobile:readMobileCarry(native)}:{})};
}
export function archivePreviousAcceptance(){
 check(process.platform==='win32','Archive mutation is restricted to Windows drive D');
 exactDirectory(CURRENT_ROOT);check(!fs.existsSync(ARCHIVE_ROOT),'Previous run archive already exists');
 const record=buildRecord(CURRENT_ROOT);const parent=path.dirname(ARCHIVE_ROOT);if(!fs.existsSync(parent))fs.mkdirSync(parent,{recursive:false});exactDirectory(ARCHIVE_ROOT);
 check(fs.realpathSync(CURRENT_ROOT).replaceAll('\\','/').toLowerCase()===CURRENT_ROOT.toLowerCase()&&path.resolve(ARCHIVE_ROOT).replaceAll('\\','/').startsWith(PRIVATE_ROOT+'/private-acceptance-history/'),'Verified archive targets required');
 fs.renameSync(CURRENT_ROOT,ARCHIVE_ROOT);check(canonical(buildRecord(ARCHIVE_ROOT))===canonical(record),'Archive readback mismatch');return {status:'ARCHIVED_IMMUTABLY',run_marker:MARKER,carried_passes:9,retained_recovery_rows:2,provider_requests:0};
}