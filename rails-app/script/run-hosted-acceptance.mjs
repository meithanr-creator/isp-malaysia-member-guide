// One-shot orchestration: actual HTTPS batch -> exact key capture -> independent DB status -> reconcile.
// No retries, no provisioning, no secret output; independent cost watchdog is mandatory.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const ROOT='D:/Projects/isp-member-rails',PRIVATE='D:/Projects/isp-rails-tools/isp-staging-private';
const get=file=>JSON.parse(fs.readFileSync(PRIVATE+'/'+file,'utf8'));
function fail(){throw Error('Acceptance sequencing stopped; inspect preserved evidence before any further mutation')}
let requireWatchdog=false,expectedWindow=null;
function verifyWatchdog(){
 const state=get('watchdog-state.json'),plan=get('watchdog-plan.json'),now=Date.now();
 const updated=Date.parse(state.updated_at),stop=Date.parse(state.stop_at);
 if(plan.account!=='a9720867333b64a4f8ee70cdfd673eb9'||plan.worker!=='isp-member-production'||plan.application_name!=='isp-member-production'||plan.application_id!=='a03ae965-44e9-40b6-9c10-3f8f2c659c34'||state.application_id!==plan.application_id||plan.start_at!==expectedWindow.start||plan.expires_at!==expectedWindow.end)fail();
 if(state.armed!==true||!Number.isFinite(updated)||updated>now+5000||now-updated>45000||!Number.isFinite(stop)||stop!==Date.parse(expectedWindow.end)-5*60000||!Number.isSafeInteger(state.pid)||state.pid<=0)fail();
 try{process.kill(state.pid,0)}catch{fail()}
}
function command(script,args,deadline,capture=false){
 if(requireWatchdog)verifyWatchdog();const timeout=Math.min(script==='hosted-acceptance.mjs'&&args.includes('aged-stepup')?14*60000:180000,deadline-Date.now());if(timeout<20000)fail();
 const result=spawnSync(process.execPath,[ROOT+'/script/'+script,...args],{cwd:ROOT,env:{...process.env,TEMP:'D:/Projects/isp-rails-tools/tmp',TMP:'D:/Projects/isp-rails-tools/tmp'},windowsHide:true,shell:false,stdio:capture?['ignore','pipe','pipe']:'inherit',encoding:'utf8',timeout,maxBuffer:2*1024*1024});
 if(result.error||result.status!==0)fail();return result.stdout;
}
try{
 const plan=JSON.parse(command('hosted-acceptance.mjs',['--plan'],Date.now()+30000,true));
 if(!Array.isArray(plan.batches)||plan.batches.length>20||!plan.batches.every(b=>/^[a-z-]+$/.test(b)))fail();
 if(process.argv.length!==3||process.argv[2]!=='--execute'){
  console.log(JSON.stringify({executes:false,batches:plan.batches,sequence:'HTTPS batch, independent database status, reconcile; halt on failure',automatic_retries:0}));
 }else{
  const runtime=get('runtime.json'),fixture=get('acceptance-fixtures.json'),watchdog=get('watchdog-state.json');
  const deadline=Date.parse(runtime.ISP_STAGING_EXPIRES_AT)-10*60000;expectedWindow={start:runtime.ISP_STAGING_START_AT,end:runtime.ISP_STAGING_EXPIRES_AT};requireWatchdog=true;verifyWatchdog();
  if(!Number.isFinite(deadline)||deadline<=Date.now()||fixture.phase!=='active'||watchdog.armed!==true||Date.now()-Date.parse(watchdog.updated_at)>45000)fail();
  for(const batch of plan.batches){
   command('hosted-acceptance.mjs',['--execute','--batch',batch],deadline);
   command('hosted-acceptance-operator.mjs',['capture-ids'],deadline);
   command('hosted-acceptance-operator.mjs',['status'],deadline);
   command('hosted-acceptance.mjs',['--reconcile'],deadline);
   const state=get('acceptance-http.json');
   if(state.halted||state.running_batch||Object.values(state.cases).some(c=>c.status==='FAIL'||(c.http==='PASS'&&c.db?.length&&c.status!=='PASS')))fail();
   console.log(JSON.stringify({batch,independent_database_checks:'pass',next:'Continue once; no mutation replay'}));
  }
  console.log(JSON.stringify({http_batches_completed:true,production_release_approved:false,next:'Virtual browsers and remaining operational evidence; exact cleanup and verified shutdown'}));
 }
}catch{console.error('Hosted acceptance sequencing refused or stopped. Private credentials were not printed.');process.exitCode=1;}
