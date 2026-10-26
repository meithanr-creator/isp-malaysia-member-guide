// Isolated Free-project restore. Never finalizes, migrates or changes the parent.
import fs from 'node:fs';
import {buildEnvironment} from './hosted-acceptance-operator.mjs';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
const ROOT='D:/Projects/isp-member-rails',PRIVATE='D:/Projects/isp-rails-tools/isp-staging-private';
const PROJECT='royal-glitter-45740959',PARENT='br-floral-tree-a1hpnagn',REGION='aws-ap-southeast-1';
const CLI='D:/Projects/isp-rails-tools/npm-global/node_modules/neon/dist/cli.js';
const COMMON=['--config-dir','D:/Projects/isp-rails-tools/neon-auth','--no-analytics','--no-color','--output','json'];
let actionDeadline=Date.now()+7*60000,cleanupDeadline=actionDeadline+3*60000;
let phase='preflight',snapshotId=null,branchId=null,endpointId=null,beforeBranches=[],beforeEndpoints=[];
const name='qa-restore-'+crypto.randomUUID().replaceAll('-','').slice(0,12);
const report={scope:'Rows, schema, constraints, indexes and encrypted MFA; sequence state, write journey and files are not claimed',started_at:new Date().toISOString(),project:PROJECT,name,finalize_restore:false};
const save=()=>fs.writeFileSync(PRIVATE+'/neon-restore-state.json',JSON.stringify({...report,phase,snapshotId,branchId,endpointId},null,2),{mode:0o600});
const assert=(ok)=>{if(!ok)throw Error('Isolated restore safety check failed')};
function cli(args){
 const remaining=(phase==='cleanup'?cleanupDeadline:actionDeadline)-Date.now();assert(remaining>1000);
 const result=spawnSync(process.execPath,[CLI,...COMMON,...args],{cwd:ROOT,env:{...process.env,TEMP:'D:/Projects/isp-rails-tools/tmp',TMP:'D:/Projects/isp-rails-tools/tmp'},encoding:'utf8',windowsHide:true,shell:false,timeout:Math.min(30000,remaining),maxBuffer:2000000});
 if(result.error||result.status!==0){fs.writeFileSync(PRIVATE+'/neon-restore-cli-error.txt',String(result.stderr||'')+'\n'+String(result.stdout||''),{mode:0o600});throw Error('Neon operation failed')}
 const text=result.stdout.trim();if(!text)return{};try{return JSON.parse(text)}catch{if(text.startsWith('postgres'))return text;throw Error('Neon output invalid')}
}
function api(path,method='GET',fields=[]){assert(path.startsWith('/projects/'+PROJECT));return cli(['api',path,...(method==='GET'?[]:['-X',method]),...fields.flatMap(f=>['-F',f])]);}
const rows=(value,key)=>Array.isArray(value)?value:value[key];
async function completed(value){
 for(const operation of value.operations||[]){assert(typeof operation.id==='string'&&/^[a-zA-Z0-9-]+$/.test(operation.id));let done=false;
  for(let i=0;i<60&&Date.now()<(phase==='cleanup'?cleanupDeadline:actionDeadline);i++){const data=api('/projects/'+PROJECT+'/operations/'+operation.id),op=data.operation||data;if(op.status==='finished'||op.status==='skipped'){done=true;break}assert(!['failed','cancelled'].includes(op.status));await delay(2000)}assert(done);
 }
}
function fingerprint(mode){assert(actionDeadline-Date.now()>30000);const r=spawnSync(process.execPath,[ROOT+'/script/run-neon-fingerprint.mjs',mode],{cwd:ROOT,env:process.env,encoding:'utf8',windowsHide:true,timeout:Math.min(120000,actionDeadline-Date.now()),maxBuffer:2000000});if(r.status!==0){fs.writeFileSync(PRIVATE+'/neon-restore-verifier-error.txt',String(r.stdout)+'\n'+String(r.stderr),{mode:0o600});throw Error('Read-only fingerprint did not verify')}const item=JSON.parse(r.stdout.trim());assert(item.ok&&item.read_only&&item.matched&&item.actors===9&&item.registry===7);return item;}
async function main(){
 if(process.argv.length!==3||process.argv[2]!=='--execute'){console.log(JSON.stringify({executes:false,project:PROJECT,steps:['snapshot fixed LSN','restore separate branch without finalize','0.25CU300s suspend','verify read-only hashes and MFA','verify parent unchanged','delete exact created resources']}));return}
 save();
 try{
  const organization=JSON.parse(fs.readFileSync(PRIVATE+'/neon-organization-plan.json','utf8'));assert(organization.plan==='free');report.plan='free';
  const pre=api('/projects/'+PROJECT),project=pre.project||pre;assert(project.id===PROJECT&&project.region_id===REGION&&project.pg_version===18&&project.org_id==='org-purple-wave-74281967');
  beforeBranches=rows(cli(['branches','list','--project-id',PROJECT]),'branches');const snapshots=rows(cli(['snapshots','list','--project-id',PROJECT]),'snapshots');
  assert(Array.isArray(beforeBranches)&&beforeBranches.every(b=>b.name!==name)&&beforeBranches.length<10&&beforeBranches.some(b=>b.id===PARENT)&&Array.isArray(snapshots)&&snapshots.length===0);
  const parentData=cli(['branches','get',PARENT,'--project-id',PROJECT]),parent=parentData.branch||parentData;assert(parent.id===PARENT&&(parent.default===true||parent.primary===true)&&!parent.parent_id);
  beforeEndpoints=rows(api('/projects/'+PROJECT+'/branches/'+PARENT+'/endpoints'),'endpoints');assert(Array.isArray(beforeEndpoints));
  const baseline=JSON.parse(fs.readFileSync(PRIVATE+'/neon-restore-baseline.json','utf8'));assert(/^[0-9A-F]+\/[0-9A-F]+$/i.test(baseline.lsn)&&baseline.tables.users.count===9&&baseline.tables.membership_registry_entries.count===7);
  phase='snapshot';save();
  const snapshotData=cli(['snapshots','create','--project-id',PROJECT,'--branch',PARENT,'--name',name,'--lsn',baseline.lsn,'--expires-at',new Date(Date.now()+45*60000).toISOString()]);const snapshot=snapshotData.snapshot||snapshotData;
  assert(/^[a-zA-Z0-9-]{8,128}$/.test(snapshot.id||'')&&snapshot.name===name&&snapshot.source_branch_id===PARENT);snapshotId=snapshot.id;save();
  phase='restore-isolated';save();const restored=api('/projects/'+PROJECT+'/snapshots/'+snapshotId+'/restore','POST',['name='+name,'finalize_restore=false']);
  const child=restored.branch;assert(child&&/^br-[a-z0-9-]+$/.test(child.id)&&child.id!==PARENT&&!beforeBranches.some(b=>b.id===child.id)&&child.name===name&&child.default!==true&&child.primary!==true);branchId=child.id;save();await completed(restored);
  phase='isolated-compute';save();
  const preview=rows(api('/projects/'+PROJECT+'/branches/'+branchId+'/endpoints'),'endpoints');assert(Array.isArray(preview)&&preview.length<=1);
  let compute;
  if(preview.length){
    const existing=preview[0];assert(/^ep-[a-z0-9-]+$/.test(existing.id)&&existing.branch_id===branchId&&!beforeEndpoints.some(old=>old.id===existing.id)&&[0,300].includes(existing.suspend_timeout_seconds));endpointId=existing.id;save();report.automatic_preview_compute=true;
    const changes=[];if(Number(existing.autoscaling_limit_min_cu)!==0.25)changes.push('endpoint.autoscaling_limit_min_cu=0.25');if(Number(existing.autoscaling_limit_max_cu)!==0.25)changes.push('endpoint.autoscaling_limit_max_cu=0.25');
    compute=changes.length?api('/projects/'+PROJECT+'/endpoints/'+endpointId,'PATCH',changes):{endpoint:existing};
  }else{compute=api('/projects/'+PROJECT+'/endpoints','POST',['endpoint.branch_id='+branchId,'endpoint.type=read_write','endpoint.autoscaling_limit_min_cu=0.25','endpoint.autoscaling_limit_max_cu=0.25']);}
  let endpoint=compute.endpoint;assert(endpoint&&/^ep-[a-z0-9-]+$/.test(endpoint.id)&&endpoint.branch_id===branchId&&!beforeEndpoints.some(old=>old.id===endpoint.id));endpointId=endpoint.id;save();await completed(compute);
  const checked=api('/projects/'+PROJECT+'/endpoints/'+endpointId);endpoint=checked.endpoint||checked;
  assert(endpoint.branch_id===branchId&&Number(endpoint.autoscaling_limit_min_cu)===0.25&&Number(endpoint.autoscaling_limit_max_cu)===0.25&&[0,300].includes(endpoint.suspend_timeout_seconds));report.compute_limits={min_cu:0.25,max_cu:0.25};report.reported_suspend_seconds=endpoint.suspend_timeout_seconds;report.free_plan_effective_idle_seconds=300;
  const parentUrl=new URL(buildEnvironment().DATABASE_URL_UNPOOLED);
  const connection=cli(['connection-string',branchId,'--project-id',PROJECT,'--database-name','neondb','--role-name',decodeURIComponent(parentUrl.username),'--ssl','verify-full']);
  const url=typeof connection==='string'?connection:connection.uri||connection.connection_uri||connection.connectionString;
  const parsed=new URL(url);assert(parsed.hostname===endpoint.host&&parsed.hostname!==parentUrl.hostname&&!parsed.hostname.includes('-pooler.')&&parsed.pathname==='/neondb'&&parsed.searchParams.get('sslmode')==='verify-full');
  fs.writeFileSync(PRIVATE+'/neon-restore-target.json',JSON.stringify({project:PROJECT,branch_id:branchId,host:parsed.hostname,url},null,2),{mode:0o600});
  phase='verify';save();report.restored=fingerprint('verify');report.parent=fingerprint('parent');report.restore_verified_at=new Date().toISOString();report.database_restore='pass';
 }catch{
  report.failure_phase=phase;report.failure='Isolated restore did not complete; inspect private stage evidence';process.exitCode=1;
 }finally{
  phase='cleanup';save();
  try{
   // Discover only this unique operation after an ambiguous creation response.
   if(!snapshotId){const matches=rows(cli(['snapshots','list','--project-id',PROJECT]),'snapshots').filter(s=>s.name===name&&s.source_branch_id===PARENT);assert(matches.length<=1);snapshotId=matches[0]?.id||null;}
   if(!branchId){const matches=rows(cli(['branches','list','--project-id',PROJECT]),'branches').filter(b=>b.name===name&&b.id!==PARENT&&!beforeBranches.some(old=>old.id===b.id));assert(matches.length<=1);branchId=matches[0]?.id||null;}
   if(branchId){assert(/^br-[a-z0-9-]+$/.test(branchId));
    const found=cli(['branches','get',branchId,'--project-id',PROJECT]),branch=found.branch||found;assert(branch.id===branchId&&branch.name===name&&branch.id!==PARENT&&!beforeBranches.some(old=>old.id===branch.id));
    const attached=rows(api('/projects/'+PROJECT+'/branches/'+branchId+'/endpoints'),'endpoints');assert(Array.isArray(attached)&&attached.length<=1);
    for(const ep of attached){assert(/^ep-[a-z0-9-]+$/.test(ep.id)&&ep.branch_id===branchId&&!beforeEndpoints.some(old=>old.id===ep.id));await completed(api('/projects/'+PROJECT+'/endpoints/'+ep.id,'DELETE'));}
    await completed(api('/projects/'+PROJECT+'/branches/'+branchId,'DELETE'));
   }
   if(snapshotId){assert(/^[a-zA-Z0-9-]{8,128}$/.test(snapshotId));const matches=rows(cli(['snapshots','list','--project-id',PROJECT]),'snapshots').filter(s=>s.id===snapshotId);assert(matches.length===1&&matches[0].name===name&&matches[0].source_branch_id===PARENT);await completed(api('/projects/'+PROJECT+'/snapshots/'+snapshotId,'DELETE'));}
   const branches=rows(cli(['branches','list','--project-id',PROJECT]),'branches'),snapshots=rows(cli(['snapshots','list','--project-id',PROJECT]),'snapshots'),endpoints=rows(api('/projects/'+PROJECT+'/endpoints'),'endpoints');
   assert(!branches.some(b=>b.id===branchId||b.name===name)&&!snapshots.some(s=>s.id===snapshotId||s.name===name)&&!endpoints.some(e=>e.id===endpointId||e.branch_id===branchId));
   assert(beforeEndpoints.every(old=>endpoints.some(e=>e.id===old.id&&e.branch_id===old.branch_id&&e.host===old.host)));
   report.cleanup={restored_branch_absent:true,snapshot_absent:true,created_compute_absent:true,original_endpoints_preserved:true};
  }catch{report.cleanup_failure='Resource absence not confirmed; exact IDs retained privately';process.exitCode=1;}
  report.finished_at=new Date().toISOString();phase='finished';save();
  const publicReport={...report};delete publicReport.name;
  fs.writeFileSync(ROOT+'/audit/neon-restore-rehearsal.json',JSON.stringify(publicReport,null,2));console.log(JSON.stringify(publicReport));
 }
}
main().catch(()=>{console.error('Isolated restore prerequisites failed; no private values displayed');process.exitCode=1});
