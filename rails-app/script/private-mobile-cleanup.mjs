// Fixed-target cooperative browser cleanup. No provider, credentials, kills or I/O on import.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {QA_DISTRO,verifyQaDistroBasePath} from './run-hosted-mobile-acceptance.mjs';
export const PRIVATE='D:/Projects/isp-rails-tools/isp-staging-private/private-acceptance';
const ROOT='D:/Projects/isp-member-rails',TOOLS='D:/Projects/isp-rails-tools',ID='rails-private-acceptance';
const NODE=TOOLS+'/node24/node.exe',CHROME=TOOLS+'/virtual-browsers/chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe';
const LNODE='/mnt/d/Projects/isp-rails-tools/node24-linux/node',LSERVER='/mnt/d/Projects/isp-member-rails/script/linux-webkit-server.mjs',LBROWSER='/mnt/d/Projects/isp-rails-tools/virtual-browsers-linux/webkit-2370/';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v),pid=v=>Number.isSafeInteger(v)&&v>0;
const need=(v,m)=>{if(!v)throw Error(m);};
function fixed(file,directory=false){need(file===PRIVATE||file.startsWith(PRIVATE+'/'),'Fixed private cleanup target required');let cursor=file;for(;;){const s=fs.lstatSync(cursor);need(!s.isSymbolicLink(),'Redirected cleanup path refused');const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}const st=fs.lstatSync(file);need(directory?st.isDirectory():st.isFile(),'Cleanup target type refused');need(fs.realpathSync(file).replaceAll('\\','/').toLowerCase()===file.toLowerCase(),'Redirected cleanup target refused');return st;}
function optional(file){try{const s=fixed(file);need(s.size<=2*1024*1024,'Bounded cleanup record required');return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function directories(root){try{fixed(root,true);const names=fs.readdirSync(root);need(names.length<=8&&names.every(uuid),'Only bounded UUID cleanup directories accepted');for(const n of names)fixed(root+'/'+n,true);return names;}catch(e){if(e.code==='ENOENT')return [];throw e;}}
export function cleanupTargets({ids,lock,journal,controls}){
 need(Array.isArray(ids)&&ids.length<=8&&ids.every(uuid)&&new Set(ids).size===ids.length,'Bounded owned cleanup IDs required');const windows=new Set(),linux=new Set(),issues=[];const add=(set,value)=>{need(pid(value),'Recorded cleanup PID invalid');set.add(value);};
 if(lock){need(uuid(lock.id)&&ids.includes(lock.id)&&['iphone-webkit','android-chromium'].includes(lock.profile),'Owned wrapper lock required');add(windows,lock.pid);}
 for(const id of ids){const c=controls[id]??{},result=c.result;let profile=result?.profile??(lock?.id===id?lock.profile:null);if(!profile){const found=Object.entries(journal?.profiles??{}).filter(([,p])=>p.server_id===id);if(found.length===1)profile=found[0][0];}
  if(result){need(result.id===id&&['iphone-webkit','android-chromium'].includes(profile)&&result.receipt?.lease_id===ID,'Owned orchestrator result required');if(pid(result.receipt.controller_pid))add(windows,result.receipt.controller_pid);for(const child of result.children??[])if(pid(child.pid))add(windows,child.pid);}
  const p=journal?.profiles?.[profile];if(p){need(p.lease_id===ID,'Foreign mobile journal refused');add(windows,p.controller_pid);if(profile==='android-chromium'&&p.browser_pid_windows)add(windows,p.browser_pid_windows);if(profile==='iphone-webkit'&&p.server_pid_linux)add(linux,p.server_pid_linux);}
  const snapshots=c.snapshots??[];if(!snapshots.length){issues.push({id,code:'descendant_snapshot_missing'});continue;}
  for(const s of snapshots){need(s?.lease_id===ID&&Array.isArray(s.tracked)&&s.tracked.length>0&&s.tracked.length<=128,'Owned descendant snapshot required');const group=profile==='iphone-webkit'?linux:profile==='android-chromium'?windows:null;need(group,'Snapshot profile identity unknown');const unique=new Set();for(const row of s.tracked){need(pid(row.pid)&&!unique.has(row.pid)&&pid(row.ppid),'Recorded descendant identity invalid');unique.add(row.pid);add(group,row.pid);}need(pid(s.browser?.pid)&&unique.has(s.browser.pid),'Browser root snapshot required');if(profile==='iphone-webkit')need(pid(s.server?.pid)&&unique.has(s.server.pid)&&s.server.pid!==s.browser.pid,'Linux server snapshot required');}
 }
 return {ids:[...ids],windows:[...windows].sort((a,b)=>a-b),linux:[...linux].sort((a,b)=>a-b),issues};
}
export function cleanupObservation(targets,windows,linux){const issues=[...targets.issues];if(windows?.complete!==true||!Array.isArray(windows.present)||!Array.isArray(windows.relevant))issues.push({code:'windows_census_incomplete'});if(linux?.complete!==true||!Array.isArray(linux.present)||!Array.isArray(linux.relevant))issues.push({code:'linux_census_incomplete'});const wp=windows?.present??[],wr=windows?.relevant??[],lp=linux?.present??[],lr=linux?.relevant??[];if(wp.length||wr.length)issues.push({code:'windows_process_present'});if(lp.length||lr.length)issues.push({code:'linux_process_present'});return {status:issues.length?'FAIL':'PASS',tracked_windows_pids:targets.windows,tracked_linux_pids:targets.linux,windows_absent:windows?.complete===true&&!wp.length&&!wr.length,linux_absent:linux?.complete===true&&!lp.length&&!lr.length,issues};}
function signal(directory,name,id){fixed(directory,true);const file=directory+'/'+name;try{fs.writeFileSync(file,id+'\n',{flag:'wx',mode:0o600});}catch(e){need(e.code==='EEXIST'&&fixed(file).size<=64&&fs.readFileSync(file,'utf8')===id+'\n','Existing cleanup signal differs');}}
function environment(){const env={};for(const k of ['SystemRoot','SYSTEMROOT','WINDIR','windir','ComSpec','COMSPEC','PATH','Path','PATHEXT'])if(process.env[k])env[k]=process.env[k];return {...env,TEMP:TOOLS+'/tmp',TMP:TOOLS+'/tmp'};}
function execute(exe,args,until){const ms=Math.min(5000,until-Date.now());need(ms>0,'Cleanup observation deadline reached');const r=spawnSync(exe,args,{cwd:ROOT,env:environment(),encoding:'utf8',windowsHide:true,timeout:ms,maxBuffer:1024*1024});need(!r.error&&r.status===0&&r.stdout.length<=1024*1024,'Complete cleanup process census required');return JSON.parse(r.stdout.replace(/^\uFEFF/,''));}
export function windowsCensusScript(targets,{fixtureRows}={}){
 need(Array.isArray(targets.windows)&&targets.windows.every(pid),'Exact tracked Windows PIDs required');if(fixtureRows!==undefined)need(Array.isArray(fixtureRows)&&fixtureRows.length<=16,'Bounded pure census fixtures required');
 const scripts=['run-private-mobile.mjs','run-hosted-mobile-acceptance.mjs','virtual-mobile-acceptance.mjs'].map(n=>(ROOT+'/script/'+n).toLowerCase());
 const rows=fixtureRows===undefined?'@(Get-CimInstance Win32_Process -ErrorAction Stop)':'@([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("'+Buffer.from(JSON.stringify(fixtureRows)).toString('base64')+'")) | ConvertFrom-Json)';
 return '$ErrorActionPreference="Stop";$ProgressPreference="SilentlyContinue";$tracked=@('+targets.windows.join(',')+');$scripts=@('+scripts.map(s=>'"'+s+'"').join(',')+');$present=@();$relevant=@();$complete=$true;$seen=@{};$rows='+rows+';foreach($r in $rows){$name=([string]$r.Name).ToLowerInvariant();$knownName=@("node.exe","chrome-headless-shell.exe","wsl.exe") -contains $name;$p=0;try{$p=[long]$r.ProcessId}catch{};if($null -eq $r.ProcessId -or $p -le 0){if($knownName){$complete=$false};continue};$trackedPid=$tracked -contains $p;if($seen.ContainsKey($p) -and ($knownName -or $trackedPid)){$complete=$false};$seen[$p]=$true;if($trackedPid){$present+=$p};$exe=([string]$r.ExecutablePath).Replace([char]92,[char]47).ToLowerInvariant();$cmd=([string]$r.CommandLine).Replace([char]92,[char]47).ToLowerInvariant();if(($knownName -or $trackedPid) -and (!$exe -or !$cmd)){$complete=$false};$own=$false;if($exe -eq "'+NODE.toLowerCase()+'"){foreach($script in $scripts){if($cmd.Contains($script)){$own=$true}}};if($exe -eq "'+CHROME.toLowerCase()+'"){$own=$true};if($exe.EndsWith("/wsl.exe") -and $cmd.Contains("'+LSERVER+'") -and $cmd.Contains("'+ID+'")){$own=$true};if($own){$relevant+=$p}};[pscustomobject]@{complete=$complete;present=@($present);relevant=@($relevant)}|ConvertTo-Json -Compress';
}
function windowsCensus(targets,until){return execute('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(windowsCensusScript(targets),'utf16le').toString('base64')],until);}
const PY=[
'import os,sys,json',
'tracked=set(json.loads(sys.argv[1])); ids=set(json.loads(sys.argv[2])); present=[]; relevant=[]; complete=True',
'for entry in os.listdir("/proc"):',
' if not entry.isdigit(): continue',
' p=int(entry)',
' try:',
'  if os.stat("/proc/"+entry).st_uid!=os.geteuid() and p not in tracked: continue',
'  if p in tracked: present.append(p)',
'  exe=os.path.realpath("/proc/"+entry+"/exe")',
'  args=open("/proc/"+entry+"/cmdline","rb").read().rstrip(b"\\0").decode("utf-8","surrogateescape").split("\\0")',
'  own=len(args)==6 and args[0]==sys.argv[3] and args[1]==sys.argv[4] and args[2:4]==["--lease","rails-private-acceptance"] and args[4]=="--id" and args[5] in ids',
'  if own or exe.startswith(sys.argv[5]): relevant.append(p)',
' except (FileNotFoundError,ProcessLookupError): pass',
' except (PermissionError,OSError): complete=False',
'print(json.dumps({"complete":complete,"present":present,"relevant":relevant}))'
].join('\n');
function linuxCensus(targets,until){return execute('C:/Windows/System32/wsl.exe',['-d',QA_DISTRO,'--exec','/usr/bin/python3','-I','-B','-c',PY,JSON.stringify(targets.linux),JSON.stringify(targets.ids),LNODE,LSERVER,LBROWSER],until);}
export async function cleanupPrivateMobile(){need(process.platform==='win32'&&process.versions.node==='24.21.0','Pinned Windows cleanup runtime required');verifyQaDistroBasePath();fixed(PRIVATE,true);const until=Date.now()+30000,control=PRIVATE+'/mobile-browser-control',linuxRoot=PRIVATE+'/linux-webkit',ids=[...new Set([...directories(control),...directories(linuxRoot)])],controls={};const lock=optional(PRIVATE+'/mobile-browser-wrapper.lock'),journal=optional(PRIVATE+'/acceptance-mobile.json');if(journal)need(journal.lease_id===undefined||journal.lease_id===ID,'Foreign private journal refused');
 const signalIssues=[];for(const id of ids){controls[id]={snapshots:[]};for(const name of ['process-snapshot.json','process-snapshot-current.json']){const s=optional(control+'/'+id+'/'+name);if(s)controls[id].snapshots.push(s);}controls[id].result=optional(control+'/'+id+'/orchestrator-result.json');try{if(fs.existsSync(control+'/'+id))signal(control+'/'+id,'controller-stop',id);if(fs.existsSync(linuxRoot+'/'+id))signal(linuxRoot+'/'+id,'stop',id);}catch{signalIssues.push({id,code:'stop_signal_unconfirmed'});}}
 const targets=cleanupTargets({ids,lock,journal,controls});targets.issues.push(...signalIssues);let result;
 do{let windows,linux;try{windows=windowsCensus(targets,until);}catch{windows={complete:false};}try{linux=linuxCensus(targets,until);}catch{linux={complete:false};}result=cleanupObservation(targets,windows,linux);if(result.status==='PASS'||Date.now()+250>=until)break;await new Promise(r=>setTimeout(r,250));}while(Date.now()<until);
 return {version:1,kind:'private-mobile-process-cleanup',lease_id:ID,observed_at:new Date().toISOString(),...result};
}
async function main(){if(process.argv.length===3&&process.argv[2]==='--plan'){console.log(JSON.stringify({provider_requests:0,signals:['controller-stop','linux stop'],max_ms:30000,fixed_private_root:PRIVATE,process_kills:0}));return;}need(process.argv.length===3&&process.argv[2]==='--execute','Use --plan or --execute');let result;try{result=await cleanupPrivateMobile();}catch{result={version:1,kind:'private-mobile-process-cleanup',lease_id:ID,status:'FAIL',observed_at:new Date().toISOString(),issues:[{code:'cleanup_observation_failed'}]};}const file=PRIVATE+'/mobile-cleanup-'+randomUUID()+'.json';try{fixed(PRIVATE,true);fs.writeFileSync(file,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});}catch{result.status='FAIL';result.local_evidence=false;}console.log(JSON.stringify(result));if(result.status!=='PASS')process.exitCode=1;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Private mobile process cleanup unproved.');process.exitCode=1;});
