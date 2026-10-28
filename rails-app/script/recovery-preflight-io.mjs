// Fixed private D paths; imported without IO. This prepares/validates, never calls a provider.
import fs from 'node:fs';
import {resolve} from 'node:path';
import {leaseContext,validatePreparedRelease,LEASE2} from './staging-lease-context.mjs';
import {prepareRecovery,createJournal,sha256,verifyObjectObservation,RecoveryRefused} from './recovery-preflight.mjs';
const normalized=p=>resolve(p).replaceAll('\\','/').toLowerCase();
function fixed(path,directory=false,max=8*1024*1024){
 const stat=fs.lstatSync(path);
 if(stat.isSymbolicLink()||normalized(fs.realpathSync(path))!==normalized(path)||(directory?!stat.isDirectory():(!stat.isFile()||stat.size>max)))throw new RecoveryRefused('fixed_private_path');
 return path;
}
function source(path,max){return fs.readFileSync(fixed(path,false,max),'utf8');}
function exclusive(path,value){
 const fd=fs.openSync(path,'wx',0o600);
 try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
export function freshRecoveryPreflight(args,{write=false,verifyBackups=false}={}){
 if(process.platform!=='win32'||args.length!==4||args[0]!=='--lease'||args[1]!==LEASE2||args[2]!=='--operation'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(args[3]))throw new RecoveryRefused('explicit_fresh_lease_operation_required');
 const context=leaseContext(args[1]),operation=args[3],base=context.privateRoot+'/recovery/'+operation;
 for(const dir of ['D:/Projects/isp-rails-tools','D:/Projects/isp-rails-tools/isp-staging-private',context.privateRoot,context.privateRoot+'/recovery',base])fixed(dir,true);
 const manifestBytes=source(context.privateRoot+'/acceptance-fixtures.json');
 const preparedBytes=source(context.privateRoot+'/prepared-release.json',16384);
 validatePreparedRelease(JSON.parse(preparedBytes));
 const request=JSON.parse(source(base+'/request.json',2*1024*1024));
 if(request.operation_id!==operation||request.lease_id!==context.leaseId)throw new RecoveryRefused('request_route_binding');
 const checkpointInventoryBytes=request.object_manifest===null?null:source(base+'/checkpoint-inventory.json',2*1024*1024);
 const plan=prepareRecovery({request,manifestBytes,preparedBytes,checkpointInventoryBytes});
 if(write){
  if(fs.existsSync(base+'/prepared.json')||fs.existsSync(base+'/journal.json'))throw new RecoveryRefused('exclusive_preparation_no_replay');
  // If the second exclusive write fails, retain the first for investigation. Never overwrite/replay.
  exclusive(base+'/prepared.json',plan);exclusive(base+'/journal.json',createJournal(plan));
 }
 let checked=0;
 if(verifyBackups){
  const sealed=JSON.parse(source(base+'/prepared.json'));
  if(sealed.plan_sha256!==plan.plan_sha256||!plan.object_manifest)throw new RecoveryRefused('stale_preparation_or_missing_object_manifest');
  fixed(base+'/objects',true);
  for(const item of plan.object_manifest.objects){
   if(item.state!=='present')continue;
   const bytes=fs.readFileSync(fixed(base+'/'+item.backup_relative_path,false,30*1024*1024));
   verifyObjectObservation(item,{key:item.key,state:'present',length:bytes.length,sha256:sha256(bytes),metadata:item.metadata,backup_relative_path:item.backup_relative_path},{backup:true});
   checked++;
  }
  exclusive(base+'/backup-local-verification.json',{version:1,operation_id:operation,plan_sha256:plan.plan_sha256,observed_at:new Date().toISOString(),local_byte_hashes_checked:checked,provider_objects_observed:false,metadata_scope:'preserved_manifest_only',absent_keys_terminal_proof:false,status:'NOT RUN'});
 }
 return {ok:true,executes_provider_operations:false,executes_database_operations:false,lease_id:context.leaseId,operation_id:operation,plan_sha256:plan.plan_sha256,prepared:write,local_backup_files_checked:checked,actors:plan.fixture_ids.actors.length,registry:plan.fixture_ids.records.registry?.length??0,status:'NOT RUN',execution_enabled:false,blocking_dependencies:plan.blocking_dependencies};
}


