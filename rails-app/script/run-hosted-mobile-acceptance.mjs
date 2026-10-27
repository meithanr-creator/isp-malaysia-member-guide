// Hosted launcher; importing this module performs no I/O.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readMobileInputs,readPrivate,durable,ROOT,PRIVATE,CONTEXT,selectedMobileContext} from './virtual-mobile-acceptance.mjs';
import {argumentsFor,profileWindow,ensure,LIMITS,sha256,encode} from './virtual-mobile-journeys.mjs';
import {validServerId,validateLinuxWebKitConnection} from './linux-webkit-connection.mjs';
const WSL='C:/Windows/System32/wsl.exe',NODE='D:/Projects/isp-rails-tools/node24/node.exe',LNODE='/mnt/d/Projects/isp-rails-tools/node24-linux/node',LSERVER='/mnt/d/Projects/isp-member-rails/script/linux-webkit-server.mjs',MINI='/mnt/d/Projects/isp-rails-tools/virtual-browsers-linux/webkit-2370/minibrowser-wpe/bin/MiniBrowser';
const CHROME='D:/Projects/isp-rails-tools/virtual-browsers/chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe';
export const PREFIX=Object.freeze(['-d','Ubuntu-24.04','--exec','/usr/bin/env','-u','NODE_OPTIONS','-u','NODE_PATH','-u','NODE_COMPILE_CACHE','-u','DEBUG','-u','PWDEBUG','-u','PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS']);
export function cleanEnvironment(source,extra={},leaseId=CONTEXT.leaseId){
 const context=selectedMobileContext(leaseId);ensure(extra.ISP_STAGING_LEASE===undefined||extra.ISP_STAGING_LEASE===leaseId);
 const env={...source};for(const key of Object.keys(env))if(['DEBUG','PWDEBUG','NODE_OPTIONS','NODE_PATH','NODE_COMPILE_CACHE','PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS','WSLENV'].includes(key.toUpperCase()))delete env[key];
 const supplied=[extra.TEMP,extra.TMP,extra.TMPDIR],tmp=extra.TEMP??context.privateRoot+'/virtual-browser-tmp';
 ensure(supplied.every(v=>v===undefined)||supplied.every(v=>v===tmp),'Explicit browser temporary paths must match');
 ensure(tmp===context.privateRoot+'/virtual-browser-tmp'||/^D:\/Projects\/isp-rails-tools\/offline-browser-preflight\/(?:windows\/[a-f0-9-]{36}|virtual-browser-tmp)$/.test(tmp),'Fixed browser temporary scope required');
 return {...env,...extra,TEMP:tmp,TMP:tmp,TMPDIR:tmp,ISP_STAGING_LEASE:leaseId};
}
export function completeReceipt({profile,leaseId,runMarker,controller,snapshot,observation,server,id,finishedAt,now=Date.now()}){
 const receipt={version:1,lease_id:leaseId,profile,run_marker:runMarker,controller_pid:controller?.pid,controller_exit_code:controller?.code,controller_exited:controller?.finished===true,browser_absent:!!snapshot&&observation?.absent===true,observed_at:new Date(now).toISOString()};
 if(profile==='iphone-webkit')Object.assign(receipt,{server_id:id,server_pid_linux:snapshot?.server?.pid,browser_pid_linux:snapshot?.browser?.pid,server_absent:observation?.own_server_pids?.length===0,wsl_child_exited:server?.finished===true,wsl_child_exit_code:server?.code});
 else receipt.browser_pid_windows=snapshot?.browser?.pid;
 const success=['rails-staging-2','rails-staging-3','rails-private-acceptance'].includes(leaseId)&&snapshot?.lease_id===leaseId&&observation?.lease_id===leaseId&&receipt.controller_pid>0&&receipt.controller_exit_code===0&&receipt.controller_exited&&receipt.browser_absent&&Date.parse(finishedAt)<=now&&(profile==='iphone-webkit'?receipt.server_pid_linux>0&&receipt.browser_pid_linux>0&&receipt.server_pid_linux!==receipt.browser_pid_linux&&receipt.server_absent&&receipt.wsl_child_exited&&receipt.wsl_child_exit_code===0:receipt.browser_pid_windows>0);
 return {receipt,success};
}
export function ownWindowsSnapshot(rows,root,controllerPid,previous=[]){
 ensure(Array.isArray(rows)&&Number.isSafeInteger(root)&&root>0&&Number.isSafeInteger(controllerPid)&&controllerPid>0);
 const found=rows.find(r=>r.pid===root),known=new Map(previous.map(r=>[r.pid,r]));
 if(!known.has(root)){ensure(found&&found.ppid===controllerPid&&found.exe?.replaceAll('\\','/').toLowerCase()===CHROME.toLowerCase()&&typeof found.created==='string','Exact owned pinned Chromium required');known.set(root,found);}
 let changed=true;while(changed){changed=false;for(const row of rows)if(known.has(row.ppid)&&!known.has(row.pid)){ensure(row.pid>0&&typeof row.created==='string');known.set(row.pid,row);changed=true;}}
 ensure(known.size<=128);return {browser:known.get(root),tracked:[...known.values()]};
}
export function processAbsence(rows,snapshot){return !!snapshot&&snapshot.tracked.every(t=>!rows.some(r=>r.pid===t.pid));}
const PY=[
'import os,sys,json',
'mode,lease,ident,pid,node,script,mini,tracked=sys.argv[1:]',
"assert lease in ['rails-staging-2','rails-staging-3','rails-private-acceptance']",
"want=[node,script,'--lease',lease,'--id',ident]",
'def record(p):',
" t=open('/proc/'+str(p)+'/stat').read().rsplit(') ',1)[1].split()",
" return {'pid':int(p),'ppid':int(t[1]),'start_ticks':t[19]}",
'def args(p):',
" return open('/proc/'+str(p)+'/cmdline','rb').read().rstrip(b'\\0').decode('utf-8','surrogateescape').split('\\0')",
'rows=[]',
"for p in os.listdir('/proc'):",
' if not p.isdigit(): continue',
' try: rows.append(record(p))',
' except (FileNotFoundError,ProcessLookupError,PermissionError): pass',
"known={r['pid']:r for r in json.loads(tracked)}",
"if mode=='snapshot':",
' root=record(int(pid))',
" assert args(root['pid'])==want and os.path.realpath('/proc/'+str(root['pid'])+'/exe')==node",
" known[root['pid']]=root",
' changed=True',
' while changed:',
'  changed=False',
'  for r in rows:',
"   if r['ppid'] in known and r['pid'] not in known: known[r['pid']]=r;changed=True",
' children=[]',
' for r in rows:',
'  try:',
"   if r['ppid']==root['pid'] and os.path.realpath('/proc/'+str(r['pid'])+'/exe')==mini: children.append(r)",
'  except (FileNotFoundError,ProcessLookupError,PermissionError): pass',
' assert len(children)==1 and len(known)<=128',
" print(json.dumps({'lease_id':lease,'server':root,'browser':children[0],'tracked':list(known.values())}))",
'else:',
' own=[]',
' for r in rows:',
'  try:',
"   if args(r['pid'])==want: own.append(r['pid'])",
'  except (FileNotFoundError,ProcessLookupError,PermissionError): pass',
" present=[r['pid'] for r in rows if r['pid'] in known]",
" print(json.dumps({'lease_id':lease,'tracked_pids_present':present,'own_server_pids':own,'absent':not present and not own}))"
].join('\n');
function fixed(path,directory=false){const st=fs.lstatSync(path);ensure(!st.isSymbolicLink()&&fs.realpathSync(path).replaceAll('\\','/').toLowerCase()===path.toLowerCase()&&(directory?st.isDirectory():st.isFile()));return st;}
export function prepareMobileWorkdirs(privateRoot){
 ensure(typeof privateRoot==='string'&&path.isAbsolute(privateRoot)&&!privateRoot.split(/[\\/]/).some(part=>part==='.'||part==='..'),'Absolute browser work root required');
 const root=path.resolve(privateRoot),same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
 const verify=directory=>{const st=fs.lstatSync(directory);ensure(st.isDirectory()&&!st.isSymbolicLink()&&same(fs.realpathSync(directory),directory),'Existing browser work path must be a real directory');};
 let ancestor=path.dirname(root);for(;;){verify(ancestor);const parent=path.dirname(ancestor);if(parent===ancestor)break;ancestor=parent;}
 const dirs={privateRoot:root,controlParent:path.join(root,'mobile-browser-control'),temporary:path.join(root,'virtual-browser-tmp'),linuxParent:path.join(root,'linux-webkit')};
 for(const directory of Object.values(dirs)){try{fs.mkdirSync(directory,{mode:0o700});}catch(error){ensure(error.code==='EEXIST','Browser work directory creation failed');}verify(directory);}
 return Object.freeze(dirs);
}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export function linuxServerArguments(leaseId,id){
 ensure(typeof leaseId==='string');selectedMobileContext(leaseId);ensure(validServerId(id),'Exact Linux server identity required');
 return Object.freeze([LNODE,LSERVER,'--lease',leaseId,'--id',id]);
}
export async function main(args=process.argv.slice(2)){
 const command=argumentsFor(args);if(command.mode==='plan'){console.log(JSON.stringify({status:'OPEN',profiles:['iphone-webkit','android-chromium'],controller_max_ms:LIMITS.profile_ms,server_ready_max_ms:70000,cleanup_max_ms:30000,automatic_retries:0}));return;}
 ensure(command.mode==='execute','Use controller --reconcile after root capture-ids/status');
 const name=command.profile,input=readMobileInputs(name),window=profileWindow(input.runtime);
 ensure(fs.realpathSync(process.execPath).replaceAll('\\','/').toLowerCase()===NODE.toLowerCase());
 const workdirs=prepareMobileWorkdirs(PRIVATE);
 const id=randomUUID(),parent=workdirs.controlParent.replaceAll('\\','/'),control=parent+'/'+id,run=PRIVATE+'/linux-webkit/'+id,lock=PRIVATE+'/mobile-browser-wrapper.lock',receiptPath=PRIVATE+'/virtual-mobile-'+name+'-process.json';
 ensure(!fs.existsSync(receiptPath),'Existing receipt cannot be replayed');
 fs.mkdirSync(control,{mode:0o700});const lockFd=fs.openSync(lock,'wx',0o600);fs.writeFileSync(lockFd,JSON.stringify({pid:process.pid,id,profile:name})+'\n');fs.fsyncSync(lockFd);
 const jobs=[];let seq=0,server,controller,connection,snapshot,observation,phase='server_start',successful=false,finishedAt;
 function launch(exe,args,label,extra={}){
  const output=control+'/'+label+'.stdout',error=control+'/'+label+'.stderr',out=fs.openSync(output,'wx',0o600),err=fs.openSync(error,'wx',0o600);let child;
  try{child=spawn(exe,args,{cwd:ROOT,env:cleanEnvironment(process.env,extra),windowsHide:true,stdio:['ignore',out,err]});}finally{fs.closeSync(out);fs.closeSync(err);}
  const job={child,pid:child.pid,output,error,finished:false,code:null};jobs.push(job);job.done=new Promise(resolve=>{child.once('error',()=>{job.finished=true;job.spawn_error=true;resolve();});child.once('close',code=>{job.code=code;job.finished=true;resolve();});});return job;
 }
 async function wait(job,ms){if(job.finished)return true;let t;try{return await Promise.race([job.done.then(()=>true),new Promise(resolve=>{t=setTimeout(()=>resolve(false),Math.max(1,ms));})]);}finally{clearTimeout(t);}}
 async function probeLinux(mode,ms=6000){
  const job=launch(WSL,[...PREFIX,'/usr/bin/python3','-I','-B','-c',PY,mode,CONTEXT.leaseId,id,String(connection?.server_pid_linux||0),LNODE,LSERVER,MINI,JSON.stringify(snapshot?.tracked||[])],'linux-probe-'+(++seq));
  ensure(await wait(job,ms)&&job.code===0&&!job.spawn_error);ensure(fixed(job.output).size<=131072);return JSON.parse(fs.readFileSync(job.output,'utf8'));
 }
 async function windowsRows(){
  const code="Get-CimInstance Win32_Process | ForEach-Object { @{pid=[int]$_.ProcessId;ppid=[int]$_.ParentProcessId;exe=$_.ExecutablePath;created=$_.CreationDate.ToUniversalTime().ToString('o')} } | ConvertTo-Json -Compress";
  const job=launch('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-Command',code],'windows-probe-'+(++seq));ensure(await wait(job,6000)&&job.code===0&&!job.spawn_error);ensure(fixed(job.output).size<=1048576);return JSON.parse(fs.readFileSync(job.output,'utf8').replace(/^\uFEFF/,''));
 }
 function requestStop(){try{fs.mkdirSync(run,{mode:0o700});}catch(e){ensure(e.code==='EEXIST');}fixed(run,true);const path=run+'/stop';try{fs.writeFileSync(path,id+'\n',{flag:'wx',mode:0o600});}catch(e){ensure(e.code==='EEXIST'&&fixed(path).size<=64&&fs.readFileSync(path,'utf8')===id+'\n');}}
 try{
  if(name==='iphone-webkit'){
   fixed(PRIVATE+'/linux-webkit',true);server=launch(WSL,[...PREFIX,...linuxServerArguments(CONTEXT.leaseId,id)],'server');const until=Date.now()+70000;
   while(Date.now()<until){ensure(!server.finished);try{const path=run+'/connection.json';ensure(fixed(path).size<=8192);const value=JSON.parse(fs.readFileSync(path,'utf8'));validateLinuxWebKitConnection(value,{serverId:id,leaseId:CONTEXT.leaseId,deadline:window.deadline});connection=value;break;}catch{}await pause(250);}
   ensure(connection,'Linux readiness timed out');snapshot=await probeLinux('snapshot');durable(control+'/process-snapshot.json',snapshot,true);
  }
  phase='controller';controller=launch(NODE,[ROOT+'/script/virtual-mobile-acceptance.mjs','--execute','--profile',name],'controller',{ISP_MOBILE_CONTROLLER_ID:id,ISP_MOBILE_RUNTIME_SHA256:input.runtimeHash,ISP_MOBILE_ADMISSION_SHA256:sha256(encode(input.admissionSnapshot)),...(name==='iphone-webkit'?{ISP_LINUX_WEBKIT_SERVER_ID:id}:{})});
  const until=Math.min(window.deadline+10000,Date.now()+LIMITS.profile_ms+10000);let next=0;
  while(!controller.finished&&Date.now()<until){
   if(Date.now()>=next){next=Date.now()+4000;
    if(name==='iphone-webkit'){try{snapshot=await probeLinux('snapshot');durable(control+'/process-snapshot-current.json',snapshot);}catch{}}
    else{try{const p=readPrivate('acceptance-mobile.json').value.profiles?.[name];if(p?.controller_pid===controller.pid&&p.browser_pid_windows){snapshot={...ownWindowsSnapshot(await windowsRows(),p.browser_pid_windows,controller.pid,snapshot?.tracked),lease_id:CONTEXT.leaseId};durable(control+'/process-snapshot-current.json',snapshot);}}catch{}}
   }
   await wait(controller,250);
  }
  ensure(controller.finished&&controller.code===0&&!controller.spawn_error,'Bounded controller failed or timed out');
  const p=readPrivate('acceptance-mobile.json').value.profiles?.[name];ensure(p?.lease_id===CONTEXT.leaseId&&p.controller_pid===controller.pid&&p.cleanup==='pass'&&p.finished_at);finishedAt=p.finished_at;successful=true;
 }catch{successful=false;}
 finally{
  const failedPhase=phase;phase='shutdown';try{fs.writeFileSync(control+'/controller-stop',id+'\n',{flag:'wx',mode:0o600});}catch{}let stopped=name!=='iphone-webkit';if(name==='iphone-webkit')try{requestStop();stopped=true;}catch{}
  const until=Date.now()+30000;
  while(Date.now()<until){try{observation=name==='iphone-webkit'?await probeLinux('observe',Math.min(6000,until-Date.now())):{lease_id:CONTEXT.leaseId,absent:processAbsence(await windowsRows(),snapshot)};if(observation.absent&&controller?.finished&&(!server||server.finished))break;}catch{}await pause(250);}
  const complete=completeReceipt({profile:name,leaseId:CONTEXT.leaseId,runMarker:input.fixtures.run_marker,controller,snapshot,observation,server,id,finishedAt});successful=successful&&stopped&&complete.success;
  try{durable(receiptPath,{...complete.receipt,status:successful?'UI_COMPLETE_AWAITING_RECONCILIATION':'FAIL',failure_phase:successful?undefined:failedPhase},true);
  durable(control+'/orchestrator-result.json',{id,profile:name,status:successful?'UI_COMPLETE_AWAITING_RECONCILIATION':'FAIL',stop_requested:stopped,receipt:complete.receipt,children:jobs.map(j=>({pid:j.pid,finished:j.finished,code:j.code,spawn_error:j.spawn_error===true}))},true);
  }finally{if(jobs.every(j=>j.finished)){fs.closeSync(lockFd);fs.unlinkSync(lock);}else{fs.closeSync(lockFd);for(const job of jobs)if(!job.finished)job.child.unref();}}
 }
 console.log(JSON.stringify({status:successful?'UI_COMPLETE_AWAITING_RECONCILIATION':'FAIL',aggregate:'OPEN',profile:name,process_cleanup:successful?'pass':'unproved',next:'Root fixture capture-ids/status, then controller --reconcile for this profile'}));if(!successful)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Hosted mobile launcher refused; aggregate OPEN. Private process evidence retained.');process.exitCode=1;});
