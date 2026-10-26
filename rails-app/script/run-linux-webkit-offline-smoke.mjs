import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {validateLinuxWebKitConnection} from './linux-webkit-connection.mjs';
const ROOT='D:/Projects/isp-member-rails',TOOLS='D:/Projects/isp-rails-tools';
const PRIVATE=TOOLS+'/isp-staging-private/leases/rails-staging-2',WSL='C:/Windows/System32/wsl.exe',NODE=TOOLS+'/node24/node.exe';
const LNODE='/mnt/d/Projects/isp-rails-tools/node24-linux/node',LSERVER='/mnt/d/Projects/isp-member-rails/script/linux-webkit-server.mjs';
const MINI='/mnt/d/Projects/isp-rails-tools/virtual-browsers-linux/webkit-2370/minibrowser-wpe/bin/MiniBrowser';
const id=randomUUID(),run=PRIVATE+'/linux-webkit/'+id,controlParent=PRIVATE+'/linux-webkit-control',control=controlParent+'/'+id;
const audit=ROOT+'/audit/staging-2/linux-webkit-engine.json',jobs=[];let sequence=0,server,smoke,connection,snapshot,observation,phase='prerequisites';
const report={version:1,scope:'Offline virtual Linux WebKit engine only; no hosted or physical-device claim',run_id:id,started_at:new Date().toISOString(),status:'running'};
const guard=(ok,message='Local Linux WebKit orchestration refused')=>{if(!ok)throw Error(message);};
const normalized=p=>fs.realpathSync(p).replaceAll('\\','/').toLowerCase();
function fixed(p,directory=false){const s=fs.lstatSync(p);guard(!s.isSymbolicLink()&&normalized(p)===p.toLowerCase()&&(directory?s.isDirectory():s.isFile()));return s;}
function write(p,value){fs.writeFileSync(p,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function cleanEnv(extra={}){
 const env={...process.env};for(const k of Object.keys(env))if(['DEBUG','PWDEBUG','NODE_OPTIONS','NODE_PATH','NODE_COMPILE_CACHE','PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS','WSLENV'].includes(k.toUpperCase()))delete env[k];
 return {...env,TEMP:TOOLS+'/tmp',TMP:TOOLS+'/tmp',TMPDIR:TOOLS+'/tmp',...extra};
}
function launch(exe,args,label,extra={}){
 const output=control+'/'+label+'.stdout',error=control+'/'+label+'.stderr';
 const out=fs.openSync(output,'wx',0o600),err=fs.openSync(error,'wx',0o600);let child;
 try{child=spawn(exe,args,{cwd:ROOT,env:cleanEnv(extra),windowsHide:true,stdio:['ignore',out,err]});}finally{fs.closeSync(out);fs.closeSync(err);}
 const job={child,output,error,pid:child.pid,finished:false,code:null,signal:null,spawn_error:false};jobs.push(job);
 job.done=new Promise(resolve=>{child.once('error',()=>{job.spawn_error=true;job.finished=true;resolve();});child.once('close',(code,signal)=>{job.code=code;job.signal=signal;job.finished=true;resolve();});});return job;
}
async function wait(job,ms){if(job.finished)return true;let timer;try{return await Promise.race([job.done.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),Math.max(1,ms));})]);}finally{clearTimeout(timer);}}
const PREFIX=['-d','Ubuntu-24.04','--exec','/usr/bin/env','-u','NODE_OPTIONS','-u','NODE_PATH','-u','NODE_COMPILE_CACHE','-u','DEBUG','-u','PWDEBUG','-u','PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS'];
const PY=String.raw`import os,sys,json
mode,ident,pid,node,script,mini,tracked=sys.argv[1:]
want=[node,script,'--id',ident]
def record(p):
    base='/proc/'+str(p)
    tail=open(base+'/stat').read().rsplit(') ',1)[1].split()
    return {'pid':int(p),'ppid':int(tail[1]),'start_ticks':tail[19]}
def args(p):
    return open('/proc/'+str(p)+'/cmdline','rb').read().rstrip(b'\0').decode('utf-8','surrogateescape').split('\0')
if mode=='snapshot':
    root=record(int(pid))
    assert args(root['pid'])==want and os.path.realpath('/proc/'+str(root['pid'])+'/exe')==node
    children=[]
    for p in os.listdir('/proc'):
        if not p.isdigit(): continue
        try:
            row=record(p)
            if row['ppid']==root['pid'] and os.path.realpath('/proc/'+p+'/exe')==mini: children.append(row)
        except (FileNotFoundError,ProcessLookupError,PermissionError): pass
    assert len(children)==1
    print(json.dumps({'server':root,'browser':children[0]}))
else:
    own=[]
    for p in os.listdir('/proc'):
        if not p.isdigit(): continue
        try:
            if args(p)==want: own.append(int(p))
        except (FileNotFoundError,ProcessLookupError,PermissionError): pass
    present=[]
    for row in json.loads(tracked):
        try: os.stat('/proc/'+str(row['pid'])); present.append(row['pid'])
        except (FileNotFoundError,ProcessLookupError): pass
    print(json.dumps({'tracked_pids_present':present,'own_server_pids':own,'absent':not present and not own}))`;
async function probe(mode,ms=6000){
 const tracked=snapshot?[snapshot.server,snapshot.browser]:[];
 const job=launch(WSL,[...PREFIX,'/usr/bin/python3','-I','-B','-c',PY,mode,id,String(connection?.server_pid_linux||0),LNODE,LSERVER,MINI,JSON.stringify(tracked)],'probe-'+(++sequence));
 guard(await wait(job,ms)&&job.code===0&&!job.spawn_error,'Private Linux process observation failed');
 guard(fixed(job.output).size<=32768);return JSON.parse(fs.readFileSync(job.output,'utf8'));
}
function requestStop(){
 try{fs.mkdirSync(run,{mode:0o700});}catch(e){guard(e.code==='EEXIST');}fixed(run,true);
 const file=run+'/stop';try{fs.writeFileSync(file,id+'\n',{flag:'wx',mode:0o600});}catch(e){guard(e.code==='EEXIST');fixed(file);guard(fs.readFileSync(file,'utf8')===id+'\n');}
}
async function main(){
 guard(process.platform==='win32'&&process.versions.node==='24.21.0'&&process.argv.length===3&&process.argv[2]==='--execute'&&normalized(process.execPath)===NODE.toLowerCase());
 fixed(PRIVATE,true);fixed(PRIVATE+'/linux-webkit',true);fixed(ROOT+'/audit/staging-2',true);
 try{fs.mkdirSync(controlParent,{mode:0o700});}catch(e){guard(e.code==='EEXIST');}fixed(controlParent,true);fs.mkdirSync(control,{mode:0o700});fixed(control,true);
 fs.writeFileSync(audit,JSON.stringify(report,null,2)+'\n');let successful=false;
 try{
  phase='server_start';server=launch(WSL,[...PREFIX,LNODE,LSERVER,'--id',id],'server');const readyUntil=Date.now()+70000;
  while(Date.now()<readyUntil){
   guard(!server.finished,'Local Linux browser server exited before readiness');
   try{const p=run+'/connection.json';guard(fixed(p).size<=8192);const value=JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));validateLinuxWebKitConnection(value,{serverId:id,deadline:Date.now()+120000});connection=value;break;}catch{}
   await pause(250);
  }
  guard(connection,'Local Linux browser readiness timed out');phase='process_snapshot';snapshot=await probe('snapshot');write(control+'/process-snapshot.json',snapshot);
  phase='controller';smoke=launch(NODE,[ROOT+'/script/linux-webkit-offline-smoke.mjs','--execute'],'controller',{ISP_LINUX_WEBKIT_SERVER_ID:id});
  guard(await wait(smoke,130000),'Local offline controller timed out');guard(smoke.code===0&&!smoke.spawn_error,'Local offline controller failed');
  guard(fixed(smoke.output).size<=32768);const lines=fs.readFileSync(smoke.output,'utf8').trim().split(/\r?\n/);guard(lines.length===1);const value=JSON.parse(lines[0]);
  guard(value.status==='pass'&&value.engine==='WebKit'&&typeof value.version==='string'&&value.version.length>0&&value.execution_platform==='linux'&&value.controller_platform==='win32'&&value.controller_pid_windows===smoke.pid&&value.profile==='iPhone 13'&&value.touch?.trusted_touch_events===1&&value.touch.viewport_width===390);
  guard(fixed(run+'/offline-smoke.png').size>8);report.engine={name:'WebKit',version:value.version,revision:connection.browser_revision,playwright:connection.playwright_version,node_linux:connection.node_version,node_windows:process.versions.node,profile:value.profile,touch:value.touch};successful=true;
 }catch{report.failure_phase=phase;successful=false;}
 finally{
  phase='shutdown';let stopRequested=false;try{requestStop();stopRequested=true;}catch{}
  const until=Date.now()+20000;while(stopRequested&&Date.now()<until){
   try{observation=await probe('observe',Math.min(6000,until-Date.now()));if(observation.absent&&server?.finished&&(!smoke||smoke.finished))break;}catch{}
   await pause(250);
  }
  report.shutdown={stop_requested:stopRequested,tracked_pids_absent:!!snapshot&&observation?.absent===true,wsl_child_exited:!!server?.finished,wsl_child_exit_code:server?.code,controller_exited:!smoke||smoke.finished};
  if(!(successful&&report.shutdown.tracked_pids_absent&&report.shutdown.wsl_child_exited&&server.code===0&&smoke?.finished&&smoke.code===0)){successful=false;report.failure_phase??='shutdown';}
  report.status=successful?'pass':'fail';report.finished_at=new Date().toISOString();write(control+'/orchestrator-result.json',{...report,children:jobs.map(j=>({pid:j.pid,finished:j.finished,code:j.code,signal:j.signal,spawn_error:j.spawn_error}))});
  fs.writeFileSync(audit,JSON.stringify(report,null,2)+'\n');for(const job of jobs)if(!job.finished)job.child.unref();
 }
 console.log(JSON.stringify({status:report.status,scope:report.scope,engine:report.engine,shutdown:report.shutdown,evidence:audit}));if(report.status!=='pass')process.exitCode=1;
}
main().catch(()=>{for(const job of jobs)if(!job.finished)job.child.unref();console.error('Local Linux WebKit orchestration failed; private evidence retained');process.exitCode=1;});
