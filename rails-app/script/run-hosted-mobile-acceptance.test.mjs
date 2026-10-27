import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanEnvironment,completeReceipt,ownWindowsSnapshot,processAbsence,PREFIX,linuxServerArguments,main} from './run-hosted-mobile-acceptance.mjs';
const now=Date.parse('2026-10-27T00:00:00Z'),created='2026-10-27T00:00:00.0000000Z',exe='D:/Projects/isp-rails-tools/virtual-browsers/chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe';
const row=(pid,ppid,path=exe)=>({pid,ppid,exe:path,created});
const linux=()=>({profile:'iphone-webkit',leaseId:'rails-staging-2',runMarker:'synthetic',controller:{pid:40,finished:true,code:0},snapshot:{lease_id:'rails-staging-2',server:{pid:41},browser:{pid:42}},observation:{lease_id:'rails-staging-2',absent:true,own_server_pids:[]},server:{finished:true,code:0},id:'fresh-uuid',finishedAt:new Date(now-1).toISOString(),now});
test('launcher environment removes injected debugging/runtime controls and preserves HOME',()=>{
 const original={HOME:'/original/home',PATH:'D:/bin',NODE_OPTIONS:'injected',node_path:'injected',DEBUG:'*',pwdebug:'1',WSLENV:'NODE_OPTIONS/u'};
 const value=cleanEnvironment(original,{},'rails-staging-2');assert.equal(value.HOME,original.HOME);assert.equal(value.PATH,original.PATH);for(const key of ['NODE_OPTIONS','node_path','DEBUG','pwdebug','WSLENV'])assert.equal(value[key],undefined);assert.equal(value.ISP_STAGING_LEASE,'rails-staging-2');
 assert.ok(PREFIX.includes('NODE_OPTIONS')&&PREFIX.includes('DEBUG')&&PREFIX.includes('PWDEBUG'));assert.equal(original.DEBUG,'*');
});
test('only exact controller-owned pinned Chromium PID can start process snapshot',()=>{
 const rows=[row(10,9),row(11,10),row(12,11),row(20,18)];
 const snapshot=ownWindowsSnapshot(rows,10,9);assert.deepEqual(snapshot.tracked.map(r=>r.pid),[10,11,12]);assert.equal(snapshot.browser.pid,10);
 assert.throws(()=>ownWindowsSnapshot(rows,10,8));assert.throws(()=>ownWindowsSnapshot([row(10,9,'C:/other.exe')],10,9));assert.throws(()=>ownWindowsSnapshot([],10,9));
});
test('later owned descendants are retained and PID reuse is conservatively still present',()=>{
 let snapshot=ownWindowsSnapshot([row(10,9),row(11,10)],10,9);
 snapshot=ownWindowsSnapshot([row(10,9),row(11,10),row(12,11)],10,9,snapshot.tracked);
 assert.equal(snapshot.tracked.length,3);assert.equal(processAbsence([row(20,19)],snapshot),true);assert.equal(processAbsence([row(11,99,'C:/unrelated.exe')],snapshot),false);assert.equal(processAbsence([],null),false);
});
test('Linux receipt needs controller exit0, both PIDs absent and WSL child exit0',()=>{
 assert.equal(completeReceipt(linux()).success,true);
 for(const mutate of [x=>x.controller.code=1,x=>x.controller.finished=false,x=>x.observation.absent=false,x=>x.observation.own_server_pids=[41],x=>x.server.finished=false,x=>x.server.code=1,x=>x.snapshot=null,x=>x.snapshot.browser.pid=41,x=>x.finishedAt='invalid']){
 const value=linux();mutate(value);assert.equal(completeReceipt(value).success,false);}
});
test('Android receipt cannot borrow Linux PID proof or omit actual controller exit',()=>{
 const value={...linux(),profile:'android-chromium',snapshot:{lease_id:'rails-staging-2',browser:{pid:54}}};assert.equal(completeReceipt(value).success,true);assert.equal(completeReceipt({...value,snapshot:null}).success,false);assert.equal(completeReceipt({...value,controller:{pid:40,finished:false,code:0}}).success,false);
});
test('plan mode performs no secret reads or browser/provider actions and remains OPEN',async()=>{
 const original=console.log,lines=[];try{console.log=value=>lines.push(JSON.parse(value));await main(['--plan']);}finally{console.log=original;}
 assert.equal(lines.length,1);assert.equal(lines[0].status,'OPEN');assert.equal(lines[0].automatic_retries,0);assert.equal(lines[0].server_ready_max_ms,70000);
});

test('child environment and Linux command use only the selected fixed lease',()=>{
 const id='9cbf15d1-2363-47a2-9c39-0ac8d8d27ca0';
 for(const leaseId of ['rails-staging-2','rails-staging-3']){
  const env=cleanEnvironment({HOME:'preserved',ISP_STAGING_LEASE:'injected'},{ISP_MOBILE_CONTROLLER_ID:id},leaseId);
  assert.equal(env.ISP_STAGING_LEASE,leaseId);assert.equal(env.TEMP,'D:/Projects/isp-rails-tools/isp-staging-private/leases/'+leaseId+'/virtual-browser-tmp');assert.equal(env.TMP,env.TEMP);assert.equal(env.HOME,'preserved');
  const args=linuxServerArguments(leaseId,id);assert.deepEqual(args.slice(-4),['--lease',leaseId,'--id',id]);assert.equal(Object.isFrozen(args),true);
  assert.throws(()=>cleanEnvironment({},{ISP_STAGING_LEASE:'legacy-1'},leaseId));
 }
 for(const leaseId of ['legacy-1','rails-staging-4','rails-staging-3\\n']){assert.throws(()=>cleanEnvironment({}, {},leaseId));assert.throws(()=>linuxServerArguments(leaseId,id));}
 assert.throws(()=>linuxServerArguments('rails-staging-3',id+'\\n'));
});
test('process cleanup evidence cannot be borrowed from another lease',()=>{
 for(const leaseId of ['rails-staging-2','rails-staging-3']){
  const value=linux();value.leaseId=leaseId;value.snapshot.lease_id=leaseId;value.observation.lease_id=leaseId;const complete=completeReceipt(value);assert.equal(complete.success,true);assert.equal(complete.receipt.lease_id,leaseId);
  assert.equal(completeReceipt({...value,snapshot:{...value.snapshot,lease_id:'legacy-1'}}).success,false);
  assert.equal(completeReceipt({...value,observation:{...value.observation,lease_id:undefined}}).success,false);
 }
 assert.equal(completeReceipt({...linux(),leaseId:undefined}).success,false);
});

test('Linux child command requires an explicit lease argument',()=>{assert.throws(()=>linuxServerArguments(undefined,'9cbf15d1-2363-47a2-9c39-0ac8d8d27ca0'));});
