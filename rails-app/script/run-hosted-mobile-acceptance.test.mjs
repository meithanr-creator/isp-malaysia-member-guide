import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {prepareMobileWorkdirs,cleanEnvironment,completeReceipt,ownWindowsSnapshot,processAbsence,PREFIX,linuxServerArguments,main} from './run-hosted-mobile-acceptance.mjs';
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

function workdirFixture(t){
 const base=process.platform==='win32'?'D:/Projects/isp-rails-tools/tmp':os.tmpdir(),directory=fs.mkdtempSync(path.join(base,'mobile-workdirs-'));
 t.after(()=>{const resolved=fs.realpathSync(directory),parent=fs.realpathSync(base);assert.equal(path.dirname(resolved),parent);assert.match(path.basename(resolved),/^mobile-workdirs-/);fs.rmSync(resolved,{recursive:true,force:false});});
 return directory;
}
test('actual workdir preparation creates every launcher parent before lock or UUID artifacts',t=>{
 const base=workdirFixture(t),privateRoot=path.join(base,'clean-private-root'),dirs=prepareMobileWorkdirs(privateRoot);
 assert.equal(Object.isFrozen(dirs),true);assert.equal(dirs.privateRoot,privateRoot);
 for(const [key,name] of [['controlParent','mobile-browser-control'],['temporary','virtual-browser-tmp'],['linuxParent','linux-webkit']]){assert.equal(dirs[key],path.join(privateRoot,name));assert.equal(fs.lstatSync(dirs[key]).isDirectory(),true);assert.equal(fs.lstatSync(dirs[key]).isSymbolicLink(),false);assert.deepEqual(fs.readdirSync(dirs[key]),[]);}
 assert.deepEqual(fs.readdirSync(privateRoot).sort(),['linux-webkit','mobile-browser-control','virtual-browser-tmp']);assert.equal(fs.existsSync(path.join(privateRoot,'mobile-browser-wrapper.lock')),false);
});
test('preparation preserves prior UUID evidence and never recreates an old run',t=>{
 const base=workdirFixture(t),privateRoot=path.join(base,'private'),dirs=prepareMobileWorkdirs(privateRoot),id='9cbf15d1-2363-47a2-9c39-0ac8d8d27ca0';
 const oldControl=path.join(dirs.controlParent,id),oldServer=path.join(dirs.linuxParent,id);fs.mkdirSync(oldControl);fs.mkdirSync(oldServer);fs.writeFileSync(path.join(oldControl,'original-proof'),'immutable original bytes');fs.writeFileSync(path.join(oldServer,'stop'),id+'\n');
 const proof=fs.readFileSync(path.join(oldControl,'original-proof'));assert.deepEqual(prepareMobileWorkdirs(privateRoot),dirs);assert.deepEqual(fs.readdirSync(dirs.controlParent),[id]);assert.deepEqual(fs.readdirSync(dirs.linuxParent),[id]);assert.deepEqual(fs.readFileSync(path.join(oldControl,'original-proof')),proof);
 fs.unlinkSync(path.join(oldServer,'stop'));fs.rmdirSync(oldServer);prepareMobileWorkdirs(privateRoot);assert.equal(fs.existsSync(oldServer),false);assert.deepEqual(fs.readdirSync(dirs.linuxParent),[]);
});
test('workdir seam refuses foreign files for root or any required parent before lock acquisition',t=>{
 const base=workdirFixture(t);
 for(const leaf of ['root','mobile-browser-control','virtual-browser-tmp','linux-webkit']){const privateRoot=path.join(base,'file-'+leaf);if(leaf==='root')fs.writeFileSync(privateRoot,'foreign file');else{fs.mkdirSync(privateRoot);fs.writeFileSync(path.join(privateRoot,leaf),'foreign file');}assert.throws(()=>prepareMobileWorkdirs(privateRoot));assert.equal(fs.existsSync(path.join(privateRoot,'mobile-browser-wrapper.lock')),false);}
 assert.throws(()=>prepareMobileWorkdirs('relative/root'));assert.throws(()=>prepareMobileWorkdirs(path.join(base,'safe')+path.sep+'..'+path.sep+'escape'));
});
test('workdir seam refuses symbolic or junction parents and redirects',t=>{
 const base=workdirFixture(t),target=path.join(base,'target');fs.mkdirSync(target);
 const linkedParent=path.join(base,'linked-parent');fs.symlinkSync(target,linkedParent,process.platform==='win32'?'junction':'dir');assert.throws(()=>prepareMobileWorkdirs(path.join(linkedParent,'private')));assert.equal(fs.existsSync(path.join(target,'private')),false);fs.unlinkSync(linkedParent);
 const privateRoot=path.join(base,'private');fs.mkdirSync(privateRoot);const redirected=path.join(privateRoot,'linux-webkit');fs.symlinkSync(target,redirected,process.platform==='win32'?'junction':'dir');assert.throws(()=>prepareMobileWorkdirs(privateRoot));assert.equal(fs.existsSync(path.join(privateRoot,'mobile-browser-wrapper.lock')),false);fs.unlinkSync(redirected);
});
test('offline temporary override must remain in its fixed root and match all three variables',()=>{
 const tmp='D:/Projects/isp-rails-tools/offline-browser-preflight/windows/9cbf15d1-2363-47a2-9c39-0ac8d8d27ca0';
 const value=cleanEnvironment({HOME:'preserved'},{TEMP:tmp,TMP:tmp,TMPDIR:tmp},'rails-staging-3');assert.equal(value.TEMP,tmp);assert.equal(value.TMP,tmp);assert.equal(value.TMPDIR,tmp);assert.equal(value.HOME,'preserved');
 for(const extra of [{TEMP:tmp},{TEMP:tmp,TMP:tmp,TMPDIR:tmp+'/other'},{TEMP:'C:/foreign',TMP:'C:/foreign',TMPDIR:'C:/foreign'},{TEMP:tmp+'/../escape',TMP:tmp+'/../escape',TMPDIR:tmp+'/../escape'}])assert.throws(()=>cleanEnvironment({},extra,'rails-staging-3'));
});
test('offline launch environment equals the live minimal source plus the reviewed temporary scope',async()=>{
 const previous=process.env.ISP_PRIVATE_ACCEPTANCE;process.env.ISP_PRIVATE_ACCEPTANCE='true';
 try{const [{preflightEnvironment},{privateExecutionEnvironment}]=await Promise.all([import('./offline-browser-preflight.mjs'),import('./private-acceptance.mjs')]);const tmp='D:/Projects/isp-rails-tools/offline-browser-preflight/windows/9cbf15d1-2363-47a2-9c39-0ac8d8d27ca0';const expected=cleanEnvironment(privateExecutionEnvironment(),{TEMP:tmp,TMP:tmp,TMPDIR:tmp},'rails-private-acceptance');assert.deepEqual(preflightEnvironment(tmp),expected);assert.equal(expected.ISP_STAGING_LEASE,'rails-private-acceptance');assert.equal(expected.ISP_PRIVATE_ACCEPTANCE,'true');for(const key of ['CLOUDFLARE_API_TOKEN','AWS_SECRET_ACCESS_KEY','DATABASE_URL','NODE_OPTIONS','WSLENV'])assert.equal(expected[key],undefined);}finally{if(previous===undefined)delete process.env.ISP_PRIVATE_ACCEPTANCE;else process.env.ISP_PRIVATE_ACCEPTANCE=previous;}
});
