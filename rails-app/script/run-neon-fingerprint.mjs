import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {buildEnvironment} from './hosted-acceptance-operator.mjs';
const root='D:/Projects/isp-member-rails',privateRoot='D:/Projects/isp-rails-tools/isp-staging-private';
try{
 const mode=process.argv[2];if(process.argv.length!==3||!['capture','verify','parent'].includes(mode))throw Error();
 const result=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',root+'/script/rails.ps1','runner','script/neon-restore-fingerprint.rb',mode],{cwd:root,env:buildEnvironment(),windowsHide:true,encoding:'utf8',timeout:120000,maxBuffer:2000000});
 if(result.error||result.status!==0){fs.writeFileSync(privateRoot+'/neon-fingerprint-child-error.txt',String(result.stderr||'')+'\n'+String(result.stdout||''),{mode:0o600});throw Error();}
 const receipts=String(result.stdout).split(/\r?\n/).flatMap(line=>{try{const item=JSON.parse(line);return item.ok===true&&item.mode===mode?[item]:[]}catch{return[]}});
 if(receipts.length!==1)throw Error();console.log(JSON.stringify(receipts[0]));
}catch{console.error('Read-only Neon fingerprint failed; private details withheld');process.exitCode=1;}
