// Hosted launcher; importing this module performs no I/O.
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readMobileInputs,readPrivate,durable,ROOT,PRIVATE} from './virtual-mobile-acceptance.mjs';
import {argumentsFor,profileWindow,ensure,LIMITS} from './virtual-mobile-journeys.mjs';
import {validateLinuxWebKitConnection} from './linux-webkit-connection.mjs';
const WSL='C:/Windows/System32/wsl.exe',NODE='D:/Projects/isp-rails-tools/node24/node.exe',LNODE='/mnt/d/Projects/isp-rails-tools/node24-linux/node',LSERVER='/mnt/d/Projects/isp-member-rails/script/linux-webkit-server.mjs',MINI='/mnt/d/Projects/isp-rails-tools/virtual-browsers-linux/webkit-2370/minibrowser-wpe/bin/MiniBrowser';
const CHROME='D:/Projects/isp-rails-tools/virtual-browsers/chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe';
export const PREFIX=Object.freeze(['-d','Ubuntu-24.04','--exec','/usr/bin/env','-u','NODE_OPTIONS','-u','NODE_PATH','-u','NODE_COMPILE_CACHE','-u','DEBUG','-u','PWDEBUG','-u','PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS']);
export function cleanEnvironment(source,extra={}){
 const env={...source};for(const key of Object.keys(env))if(['DEBUG','PWDEBUG','NODE_OPTIONS','NODE_PATH','NODE_COMPILE_CACHE','PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS','WSLENV'].includes(key.toUpperCase()))delete env[key];
 return {...env,TEMP:PRIVATE+'/virtual-browser-tmp',TMP:PRIVATE+'/virtual-browser-tmp',TMPDIR:PRIVATE+'/virtual-browser-tmp',ISP_STAGING_LEASE:'rails-staging-2',...extra};
}
export function completeReceipt({profile,runMarker,controller,snapshot,observation,server,id,finishedAt,now=Date.now()}){
 const receipt={version:1,profile,run_marker:runMarker,controller_pid:controller?.pid,controller_exit_code:controller?.code,controller_exited:controller?.finished===true,browser_absent:!!snapshot&&observation?.absent===true,observed_at:new Date(now).toISOString()};
 if(profile==='iphone-webkit')Object.assign(receipt,{server_id:id,server_pid_linux:snapshot?.server?.pid,browser_pid_linux:snapshot?.browser?.pid,server_absent:observation?.own_server_pids?.length===0,wsl_child_exited:server?.finished===true,wsl_child_exit_code:server?.code});
 else receipt.browser_pid_windows=snapshot?.browser?.pid;
 const success=receipt.controller_pid>0&&receipt.controller_exit_code===0&&receipt.controller_exited&&receipt.browser_absent&&Date.parse(finishedAt)<=now&&(profile==='iphone-webkit'?receipt.server_pid_linux>0&&receipt.browser_pid_linux>0&&receipt.server_pid_linux!==receipt.browser_pid_linux&&receipt.server_absent&&receipt.wsl_child_exited&&receipt.wsl_child_exit_code===0:receipt.browser_pid_windows>0);
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
'mode,ident,pid,node,script,mini,tracked=sys.argv[1:]',
"want=[node,script,'--id',ident]",
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
" print(json.dumps({'server':root,'browser':children[0],'tracked':list(known.values())}))",
'else:',
' own=[]',
' for r in rows:',
'  try:',
"   if args(r['pid'])==want: own.append(r['pid'])",
'  except (FileNotFoundError,ProcessLookupError,PermissionError): pass',
" present=[r['pid'] for r in rows if r['pid'] in known]",
" print(json.dumps({'tracked_pids_present':present,'own_server_pids':own,'absent':not present and not own}))"
].join('\n');
function fixed(path,directory=false){const st=fs.lstatSync(path);ensure(!st.isSymbolicLink()&&fs.realpathSync(path).replaceAll('\\','/').toLowerCase()===path.toLowerCase()&&(directory?st.isDirectory():st.isFile()));return st;}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function main(args=process.argv.slice(2)){
 const command=argumentsFor(args);if(command.mode==='plan'){console.log(JSON.stringify({status:'OPEN',profiles:['iphone-webkit','android-chromium'],controller_max_ms:LIMITS.profile_ms,server_ready_max_ms:70000,cleanup_max_ms:30000,automatic_retries:0}));return;}
 ensure(command.mode==='execute','Use controller --reconcile after root capture-ids/status');
 const name=command.profile,input=readMobileInputs(name),window=profileWindow(input.runtime);
 ensure(fs.realpathSync(process.execPath).replaceAll('\\','/').toLowerCase()===NODE.toLowerCase());
 const id=randomUUID(),parent=PRIVATE+'/mobile-browser-control',control=parent+'/'+id,run=PRIVATE+'/linux-webkit/'+id,lock=PRIVATE+'/mobile-browser-wrapper.lock',receiptPath=PRIVATE+'/virtual-mobile-'+name+'-process.json';
 ensure(!fs.existsSync(receiptPath),'Existing receipt cannot be replayed');
 for(const dir of [parent,PRIVATE+'/virtual-browser-tmp']){try{fs.mkdirSync(dir,{mode:0o700});}catch(e){ensure(e.code==='EEXIST');}fixed(dir,true);}
 fs.mkdirSync(control,{mode:0o700});const lockFd=fs.openSync(lock,'wx',0o600);fs.writeFileSync(lockFd,JSON.stringify({pid:process.pid,id,profile:name})+'\n');fs.fsyncSync(lockFd);
 const jobs=[];let seq=0,server,controller,connection,snapshot,observation,phase='server_start',successful=false,finishedAt;
 function launch(exe,args,label,extra={}){
  const output=control+'/'+label+'.stdout',error=control+'/'+label+'.stderr',out=fs.openSync(output,'wx',0o600),err=fs.openSync(error,'wx',0o600);let child;
  try{child=spawn(exe,args,{cwd:ROOT,env:cleanEnvironment(process.env,extra),windowsHide:true,stdio:['ignore',out,err]});}finally{fs.closeSync(out);fs.closeSync(err);}
  const job={child,pid:child.pid,output,error,finished:false,code:null};jobs.push(job);job.done=new Promise(resolve=>{child.once('error',()=>{job.finished=true;job.spawn_error=true;resolve();});child.once('close',code=>{job.code=code;job.finished=true;resolve();});});return job;
 }
 async function wait(job,ms){if(job.finished)return true;let t;try{return await Promise.race([job.done.then(()=>true),new Promise(resolve=>{t=setTimeout(()=>resolve(false),Math.max(1,ms));})]);}finally{clearTimeout(t);}}
 async function probeLinux(mode,ms=6000){
  const job=launch(WSL,[...PREFIX,'/usr/bin/python3','-I','-B','-c',PY,mode,id,String(connection?.server_pid_linux||0),LNODE,LSERVER,MINI,JSON.stringify(snapshot?.tracked||[])],'linux-probe-'+(++seq));
  ensure(await wait(job,ms)&&job.code===0&&!job.spawn_error);ensure(fixed(job.output).size<=131072);return JSON.parse(fs.readFileSync(job.output,'utf8'));
 }
 async function windowsRows(){
  const code="Get-CimInstance Win32_Process | ForEach-Object { @{pid=[int]$_.ProcessId;ppid=[int]$_.ParentProcessId;exe=$_.ExecutablePath;created=$_.CreationDate.ToUniversalTime().ToString('o')} } | ConvertTo-Json -Compress";
  const job=launch('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-Command',code],'windows-probe-'+(++seq));ensure(await wait(job,6000)&&job.code===0&&!job.spawn_error);ensure(fixed(job.output).size<=1048576);return JSON.parse(fs.readFileSync(job.output,'utf8').replace(/^\uFEFF/,''));
 }
 function requestStop(){try{fs.mkdirSync(run,{mode:0o700});}catch(e){ensure(e.code==='EEXIST');}fixed(run,true);const path=run+'/stop';try{fs.writeFileSync(path,id+'\n',{flag:'wx',mode:0o600});}catch(e){ensure(e.code==='EEXIST'&&fixed(path).size<=64&&fs.readFileSync(path,'utf8')===id+'\n');}}
 try{
  if(name==='iphone-webkit'){
   fixed(PRIVATE+'/linux-webkit',true);server=launch(WSL,[...PREFIX,LNODE,LSERVER,'--id',id],'server');const until=Date.now()+70000;
   while(Date.now()<until){ensure(!server.finished);try{const path=run+'/connection.json';ensure(fixed(path).size<=8192);const value=JSON.parse(fs.readFileSync(path,'utf8'));validateLinuxWebKitConnection(value,{serverId:id,deadline:window.deadline});connection=value;break;}catch{}await pause(250);}
   ensure(connection,'Linux readiness timed out');snapshot=await probeLinux('snapshot');durable(control+'/process-snapshot.json',snapshot,true);
  }
  phase='controller';controller=launch(NODE,[ROOT+'/script/virtual-mobile-acceptance.mjs','--execute','--profile',name],'controller',{ISP_MOBILE_CONTROLLER_ID:id,...(name==='iphone-webkit'?{ISP_LINUX_WEBKIT_SERVER_ID:id}:{})});
  const until=Math.min(window.deadline+10000,Date.now()+LIMITS.profile_ms+10000);let next=0;
  while(!controller.finished&&Date.now()<until){
   if(Date.now()>=next){next=Date.now()+4000;
    if(name==='iphone-webkit'){try{snapshot=await probeLinux('snapshot');durable(control+'/process-snapshot-current.json',snapshot);}catch{}}
    else{try{const p=readPrivate('acceptance-mobile.json').value.profiles?.[name];if(p?.controller_pid===controller.pid&&p.browser_pid_windows){snapshot=ownWindowsSnapshot(await windowsRows(),p.browser_pid_windows,controller.pid,snapshot?.tracked);durable(control+'/process-snapshot-current.json',snapshot);}}catch{}}
   }
   await wait(controller,250);
  }
  ensure(controller.finished&&controller.code===0&&!controller.spawn_error,'Bounded controller failed or timed out');
  const p=readPrivate('acceptance-mobile.json').value.profiles?.[name];ensure(p?.controller_pid===controller.pid&&p.cleanup==='pass'&&p.finished_at);finishedAt=p.finished_at;successful=true;
 }catch{successful=false;}
 finally{
  const failedPhase=phase;phase='shutdown';try{fs.writeFileSync(control+'/controller-stop',id+'\n',{flag:'wx',mode:0o600});}catch{}let stopped=name!=='iphone-webkit';if(name==='iphone-webkit')try{requestStop();stopped=true;}catch{}
  const until=Date.now()+30000;
  while(Date.now()<until){try{observation=name==='iphone-webkit'?await probeLinux('observe',Math.min(6000,until-Date.now())):{absent:processAbsence(await windowsRows(),snapshot)};if(observation.absent&&controller?.finished&&(!server||server.finished))break;}catch{}await pause(250);}
  const complete=completeReceipt({profile:name,runMarker:input.fixtures.run_marker,controller,snapshot,observation,server,id,finishedAt});successful=successful&&stopped&&complete.success;
  try{durable(receiptPath,{...complete.receipt,status:successful?'UI_COMPLETE_AWAITING_RECONCILIATION':'FAIL',failure_phase:successful?undefined:failedPhase},true);
  durable(control+'/orchestrator-result.json',{id,profile:name,status:successful?'UI_COMPLETE_AWAITING_RECONCILIATION':'FAIL',stop_requested:stopped,receipt:complete.receipt,children:jobs.map(j=>({pid:j.pid,finished:j.finished,code:j.code,spawn_error:j.spawn_error===true}))},true);
  }finally{if(jobs.every(j=>j.finished)){fs.closeSync(lockFd);fs.unlinkSync(lock);}else{fs.closeSync(lockFd);for(const job of jobs)if(!job.finished)job.child.unref();}}
 }
 console.log(JSON.stringify({status:successful?'UI_COMPLETE_AWAITING_RECONCILIATION':'FAIL',aggregate:'OPEN',profile:name,process_cleanup:successful?'pass':'unproved',next:'Root fixture capture-ids/status, then controller --reconcile for this profile'}));if(!successful)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Hosted mobile launcher refused; aggregate OPEN. Private process evidence retained.');process.exitCode=1;});
