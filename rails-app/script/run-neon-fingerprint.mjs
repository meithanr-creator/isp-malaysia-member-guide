import fs from 'node:fs';
import {freshRecoveryPreflight} from './recovery-preflight-io.mjs';
import {selectLease,leaseContext,assertWritableLease,LEGACY_LEASE} from './staging-lease-context.mjs';
import {spawnSync} from 'node:child_process';
import {buildEnvironment} from './hosted-acceptance-operator.mjs';
const root='D:/Projects/isp-member-rails',privateRoot='D:/Projects/isp-rails-tools/isp-staging-private';
function legacyMain(){
try{
 if(selectLease()!==LEGACY_LEASE)throw Error();assertWritableLease(leaseContext(LEGACY_LEASE));
 const mode=process.argv[2];if(process.argv.length!==3||!['capture','verify','parent'].includes(mode))throw Error();
 const result=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',root+'/script/rails.ps1','runner','script/neon-restore-fingerprint.rb',mode],{cwd:root,env:buildEnvironment(),windowsHide:true,encoding:'utf8',timeout:120000,maxBuffer:2000000});
 if(result.error||result.status!==0){fs.writeFileSync(privateRoot+'/neon-fingerprint-child-error.txt',String(result.stderr||'')+'\n'+String(result.stdout||''),{mode:0o600});throw Error();}
 const receipts=String(result.stdout).split(/\r?\n/).flatMap(line=>{try{const item=JSON.parse(line);return item.ok===true&&item.mode===mode?[item]:[]}catch{return[]}});
 if(receipts.length!==1)throw Error();console.log(JSON.stringify(receipts[0]));
}catch{console.error('Read-only Neon fingerprint failed; private details withheld');process.exitCode=1;}

}
if(process.argv[2]==='--preflight'){
 try{console.log(JSON.stringify(freshRecoveryPreflight(process.argv.slice(3))));}
 catch{console.error('Fresh recovery fingerprint preflight refused; private details withheld.');process.exitCode=1;}
}else if(['capture-current','verify-current','parent-current'].includes(process.argv[2])){
 console.error('Current recovery fingerprint execution is not admitted: review the operation-owned target/runtime adapter first. Preflight and CI inventory SQL are available; restore_rollback remains NOT RUN.');process.exitCode=1;
}else legacyMain();


