// Existing sealed-release/handoff/watchdog admission. Importing performs no I/O.
import fs from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {leaseContext,readPreparedRelease,assertLeaseMutationAllowed,assertActiveRelease,assertWatchdogTuple} from './staging-lease-context.mjs';
import {validatePlan,validateWatchdogHandoff} from './cloudflare-staging-watchdog.mjs';
const HOST='isp-member-production.meithan-r.workers.dev';
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const need=(value,code)=>{if(!value)throw Error(code);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const parse=raw=>{need(raw instanceof Uint8Array&&raw.byteLength>0&&raw.byteLength<=16384,'active_record_bytes_required');const value=JSON.parse(Buffer.from(raw).toString('utf8').replace(/^\uFEFF/,''));need(object(value),'active_record_object_required');return value;};
export function assertAdmissionSnapshotDigest(snapshot,expectedDigest){
 need(snapshot&&typeof snapshot==='object'&&/^[a-f0-9]{64}$/.test(expectedDigest??'')&&hash(Buffer.from(JSON.stringify(snapshot)))===expectedDigest,'parent_execution_admission_replaced');return snapshot;
}
export function assertHostedRuntimeMode(runtime){
 need(runtime?.APP_HOST===HOST&&runtime.RAILS_ENV==='production'&&runtime.ISP_DEMO_MODE==='false'&&runtime.ISP_ACCOUNT_EMAILS_ENABLED==='false'&&runtime.ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED==='false','hosted_runtime_mode_required');return runtime;
}
export function assertActiveStagingAdmission({context,prepared,expectedRuntime,expectedSnapshot,runtimeBytes,planBytes,handoffBytes,activeBytes,state,now=Date.now(),minimumRemainingMs=0,pidAlive}={}){
 assertLeaseMutationAllowed(context);
 need(object(expectedRuntime)&&Number.isFinite(now)&&Number.isFinite(minimumRemainingMs)&&minimumRemainingMs>=0,'execution_snapshot_required');
 const runtime=assertHostedRuntimeMode(parse(runtimeBytes)),plan=parse(planBytes),handoff=parse(handoffBytes),active=parse(activeBytes);
 need(JSON.stringify(runtime)===JSON.stringify(expectedRuntime),'execution_runtime_replaced');
 assertActiveRelease(context,runtime,active,prepared);
 need(active.ingress_enabled===true,'active_ingress_receipt_required');
 validateWatchdogHandoff(handoff,runtimeBytes,planBytes,prepared);
 assertWatchdogTuple(context,runtime,plan,state,prepared);
 const {stopAt}=validatePlan(plan,now),start=Date.parse(runtime.ISP_STAGING_START_AT),end=Date.parse(runtime.ISP_STAGING_EXPIRES_AT);
 need(Number.isFinite(start)&&Number.isFinite(end)&&now>=start&&now+minimumRemainingMs<end-600000,'active_cleanup_reserve_required');
 const updated=Date.parse(state?.updated_at);
 need(state?.armed===true&&Number.isFinite(updated)&&updated<=now+5000&&now-updated<=45000&&Date.parse(state.stop_at)===stopAt&&Number.isSafeInteger(state.pid)&&state.pid>0,'fresh_matching_watchdog_required');
 const snapshot={runtime_sha256:hash(runtimeBytes),plan_sha256:hash(planBytes),active_sha256:hash(activeBytes),prepared_release_sha256:prepared.prepared_release_sha256,watchdog_pid:state.pid};
 if(expectedSnapshot)need(Object.keys(snapshot).every(key=>snapshot[key]===expectedSnapshot[key]),'execution_admission_replaced');
 let alive=false;try{alive=typeof pidAlive==='function'&&pidAlive(state.pid)===true;}catch{}
 need(alive,'watchdog_process_unavailable');
 return {runtime,plan,state,active,snapshot:Object.freeze(snapshot)};
}
const normalized=value=>resolve(value).replaceAll('\\','/').toLowerCase();
export function readActiveStagingAdmission(context,{expectedRuntime,expectedSnapshot,prepared,now=Date.now(),minimumRemainingMs=0,pidAlive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}}}={}){
 const selected=leaseContext(context.leaseId);assertLeaseMutationAllowed(selected);
 need(selected.privateRoot===context.privateRoot&&selected.auditRoot===context.auditRoot,'canonical_active_context_required');
 const actualPrepared=readPreparedRelease(selected);
 if(prepared)need(prepared.prepared_release_sha256===actualPrepared.prepared_release_sha256,'execution_prepared_release_replaced');
 const read=name=>{const path=selected.privateRoot+'/'+name,stat=fs.lstatSync(path);need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=16384&&normalized(fs.realpathSync(path))===normalized(path),'fixed_active_record_required');return fs.readFileSync(path);};
 return assertActiveStagingAdmission({context:selected,prepared:actualPrepared,expectedRuntime,expectedSnapshot,runtimeBytes:read('runtime.json'),planBytes:read('watchdog-plan.json'),handoffBytes:read('watchdog-handoff.json'),activeBytes:read('acceptance-release.json'),state:parse(read('watchdog-state.json')),now,minimumRemainingMs,pidAlive});
}
