import {existsSync,lstatSync,realpathSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {validUuid} from '../cloudflare/src/diagnostics.js';
export const LEGACY_LEASE='legacy-1',LEASE2='rails-staging-2';
export const LEGACY_PRIVATE='D:/Projects/isp-rails-tools/isp-staging-private';
const ACCOUNT='a9720867333b64a4f8ee70cdfd673eb9',WORKER='isp-member-production';
const OLD_APP='a03ae965-44e9-40b6-9c10-3f8f2c659c34',OLD_NAMESPACE='a0e936fb9d634f59b1caaa1896b07a1f';
const OLD_VERSION='d6978392-76ac-4208-aaf9-e907be1939c0',OLD_DEPLOYMENT='1847c5bc-7b6e-4c0a-9eee-657f7c3476f1';
const OLD_RAILS='c9a5142bd8c949c6415c3639c0113ee015f9a3f4',OLD_IMAGE='sha256:0187a1e32351a3f7a8f9c87a48798c0adf31f3b6c4116309c78f638582700cd2';
const FIELDS=['version','lease_id','account','worker','application_name','application_id','namespace_id','class_name','worker_source','rails_source','image_digest','rollback_worker_version','rollback_deployment_id','activation'];
const TUPLE=['lease_id','account','worker','application_name','application_id','namespace_id','class_name','worker_source','rails_source','image_digest','rollback_worker_version','prepared_release_sha256'];
function refused(){throw Error('Staging lease context refused; inspect the fixed private preparation.');}
const hex=(value,length)=>typeof value==='string'&&value.length===length&&/^[a-f0-9]+$/.test(value);
export function selectLease(value=process.env.ISP_STAGING_LEASE){
 if(value===undefined)return LEGACY_LEASE;if(value===LEASE2)return LEASE2;return refused();
}
export function leaseContext(leaseId=LEGACY_LEASE){
 if(leaseId!==LEGACY_LEASE&&leaseId!==LEASE2)return refused();
 const fresh=leaseId===LEASE2;
 return Object.freeze({leaseId,fresh,credentialRoot:LEGACY_PRIVATE,
  privateRoot:fresh?`${LEGACY_PRIVATE}/leases/${LEASE2}`:LEGACY_PRIVATE,
  auditRoot:`D:/Projects/isp-member-rails/audit${fresh?'/staging-2':''}`});
}
export function validatePreparedRelease(value){
 if(!value||Array.isArray(value)||Object.keys(value).length!==FIELDS.length||!FIELDS.every(key=>Object.hasOwn(value,key))||
  value.version!==1||value.lease_id!==LEASE2||value.account!==ACCOUNT||value.worker!==WORKER||value.application_name!==WORKER||
  value.class_name!=='RailsStaging2'||value.activation!==false||
  !validUuid(value.application_id)||value.application_id===OLD_APP||!hex(value.namespace_id,32)||value.namespace_id===OLD_NAMESPACE||
  !hex(value.worker_source,40)||!hex(value.rails_source,40)||value.rails_source===OLD_RAILS||
  typeof value.image_digest!=='string'||value.image_digest.length!==71||!/^sha256:[a-f0-9]{64}$/.test(value.image_digest)||value.image_digest===OLD_IMAGE||
  !validUuid(value.rollback_worker_version)||value.rollback_worker_version===OLD_VERSION||
  !validUuid(value.rollback_deployment_id)||value.rollback_deployment_id===OLD_DEPLOYMENT)return refused();
 return Object.freeze(Object.fromEntries(FIELDS.map(key=>[key,value[key]])));
}
const normalized=value=>resolve(value).replaceAll('\\','/').toLowerCase();
export function readPreparedRelease(context){
 if(!context.fresh)return null;
 const canonical=leaseContext(context.leaseId),file=`${canonical.privateRoot}/prepared-release.json`;
 try{
  for(const path of [canonical.privateRoot,file]){
   const stat=lstatSync(path);
   if(stat.isSymbolicLink()||normalized(realpathSync(path))!==normalized(path)||(path===file?(!stat.isFile()||stat.size>16384):!stat.isDirectory()))return refused();
  }
  const source=readFileSync(file,'utf8');const value=validatePreparedRelease(JSON.parse(source.replace(/^\uFEFF/,'')));
  return Object.freeze({...value,prepared_release_sha256:createHash('sha256').update(source).digest('hex')});
 }catch{return refused();}
}
export function preparedTuple(prepared){return Object.fromEntries(TUPLE.map(key=>[key,prepared[key]]));}
export function assertRuntimeRelease(context,runtime,prepared){
 if(!context.fresh)return;
 if(!prepared||runtime.ISP_STAGING_LEASE!==LEASE2||runtime.APPLICATION_ID!==prepared.application_id||runtime.NAMESPACE_ID!==prepared.namespace_id||
  runtime.CANDIDATE_COMMIT!==prepared.worker_source||runtime.RAILS_SOURCE!==prepared.rails_source||runtime.IMAGE_DIGEST!==prepared.image_digest||
  runtime.ROLLBACK_WORKER_VERSION!==prepared.rollback_worker_version||runtime.PREPARED_RELEASE_SHA256!==prepared.prepared_release_sha256)return refused();
}
export function assertPreparedTuple(context,value,prepared){
 if(!context.fresh)return;
 if(!prepared||!value||!TUPLE.every(key=>value[key]===prepared[key]))return refused();
}
export function assertWatchdogTuple(context,runtime,plan,state,prepared){
 if(!plan||!state||plan.account!==ACCOUNT||plan.worker!==WORKER||plan.application_name!==WORKER||
  state.application_id!==plan.application_id||plan.start_at!==runtime.ISP_STAGING_START_AT||plan.expires_at!==runtime.ISP_STAGING_EXPIRES_AT)return refused();
 if(context.fresh){assertRuntimeRelease(context,runtime,prepared);assertPreparedTuple(context,plan,prepared);assertPreparedTuple(context,state,prepared);}
 else if(plan.application_id!==OLD_APP)return refused();
}
export function assertApplication(context,app,plan,prepared){
 if(app&&app.name!==WORKER)return refused();
 if(context.fresh){assertPreparedTuple(context,plan,prepared);if(app&&(app.account_id!==ACCOUNT||app.id!==prepared.application_id||app.durable_objects?.namespace_id!==prepared.namespace_id))return refused();}
}
export function assertActiveRelease(context,runtime,active,prepared){
 if(!context.fresh)return;
 assertRuntimeRelease(context,runtime,prepared);assertPreparedTuple(context,active,prepared);
 if(active.activation!==true||!validUuid(active.worker_version)||active.worker_version===prepared.rollback_worker_version||
  active.worker_version!==runtime.CLOUDFLARE_WORKER_VERSION||!validUuid(active.deployment_id)||active.deployment_id!==runtime.CLOUDFLARE_DEPLOYMENT_ID)return refused();
}
export function buildLease2Seed(previous,random){
 const lengths={SECRET_KEY_BASE:128,ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY:64,ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY:64,ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT:64},seed={};
 for(const[name,length]of Object.entries(lengths)){
  const value=previous?.[name];if(typeof value!=='string'||value.length!==length||!/^[a-f0-9]+$/.test(value))throw Error('Existing staging encryption keys refused');seed[name]=value;
 }
 seed.ISP_STAGING_KEY=random(32).toString('hex');
 if(seed.ISP_STAGING_KEY.length!==64||!/^[a-f0-9]{64}$/.test(seed.ISP_STAGING_KEY)||seed.ISP_STAGING_KEY===previous.ISP_STAGING_KEY||new Set(Object.values(seed)).size!==5)throw Error('Fresh review key refused');
 return seed;
}
// Once the new release is sealed, legacy operators are read-only historical tools.
export function assertWritableLease(context,exists=existsSync){
 if(!context.fresh&&exists(leaseContext(LEASE2).privateRoot+'/prepared-release.json'))return refused();
}