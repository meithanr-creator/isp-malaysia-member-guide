import fs from 'node:fs';
import {resolve} from 'node:path';
const VERSION='1.64.1',REVISION='2370',MAX_MS=55*60000;
import {LEASE2,LEASE3,leaseContext} from './staging-lease-context.mjs';
export function browserContext(leaseId){
 if(leaseId==='rails-private-acceptance')return {leaseId,privateRoot:'D:/Projects/isp-rails-tools/isp-staging-private/private-acceptance',auditRoot:'D:/Projects/isp-member-rails/audit/private-acceptance'};
 return leaseContext(leaseId);
}
const FIELDS=['version','lease_id','private_root','audit_root','server_id','engine','platform','arch','node_version','playwright_version','browser_revision','ws_endpoint','created_at','expires_at','server_pid_linux'];
const refused=()=>{throw Error('Private Linux WebKit connection refused');};
const guard=ok=>{if(!ok)refused();};
export function validServerId(v){return typeof v==='string'&&v.length===36&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);}
function instant(v){guard(typeof v==='string');const n=Date.parse(v);guard(Number.isFinite(n)&&new Date(n).toISOString()===v);return n;}
export function validateLinuxWebKitConnection(p,{serverId,leaseId,deadline,now=Date.now()}={}){
 guard(p!==null&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).length===FIELDS.length&&FIELDS.every(k=>Object.hasOwn(p,k)));
 guard([LEASE2,LEASE3,'rails-private-acceptance'].includes(leaseId));const context=browserContext(leaseId);
 guard(p.lease_id===leaseId&&p.private_root===context.privateRoot&&p.audit_root===context.auditRoot);
 guard(validServerId(serverId)&&p.server_id===serverId&&p.version===2&&p.engine==='webkit'&&p.platform==='linux'&&p.arch==='x64'&&p.node_version==='24.21.0'&&p.playwright_version===VERSION&&p.browser_revision===REVISION);
 guard(Number.isSafeInteger(p.server_pid_linux)&&p.server_pid_linux>0);
 const match=typeof p.ws_endpoint==='string'&&p.ws_endpoint.trim()===p.ws_endpoint&&p.ws_endpoint.match(/^ws:\/\/127\.0\.0\.1:([1-9][0-9]{3,4})\/[a-f0-9]{64}$/);
 guard(match&&Number(match[1])>=1024&&Number(match[1])<=65535);
 const start=instant(p.created_at),end=instant(p.expires_at);
 guard(Number.isSafeInteger(now)&&now>=0&&Number.isSafeInteger(deadline)&&start<=now+5000&&end>start&&end-start<=MAX_MS&&now<end&&deadline>now+30000&&deadline<=end);
 return Object.freeze({lease_id:leaseId,private_root:context.privateRoot,audit_root:context.auditRoot,endpoint:p.ws_endpoint,expires_at:end,server_id:serverId,platform:'linux',playwright_version:VERSION,browser_revision:REVISION});
}
const norm=p=>resolve(p).replaceAll('\\','/').toLowerCase();
function fixed(p,directory=false){const s=fs.lstatSync(p);guard(!s.isSymbolicLink()&&norm(fs.realpathSync(p))===norm(p)&&(directory?s.isDirectory():s.isFile()));return p;}
export function readLinuxWebKitConnection({leaseId,privateRoot,deadline,serverId=process.env.ISP_LINUX_WEBKIT_SERVER_ID}={}){
 try{
  guard([LEASE2,LEASE3,'rails-private-acceptance'].includes(leaseId));const context=browserContext(leaseId);
  guard(process.platform==='win32'&&privateRoot===context.privateRoot&&validServerId(serverId));
  const directory=`${context.privateRoot}/linux-webkit/${serverId}`;fixed(directory,true);
  const file=fixed(`${directory}/connection.json`);guard(fs.statSync(file).size<=8192);
  const parsed=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  return {connection:validateLinuxWebKitConnection(parsed,{serverId,leaseId,deadline}),directory};
 }catch{refused();}
}
function requestStop(directory,serverId){
 fixed(directory,true);const file=`${directory}/stop`;
 try{fs.writeFileSync(file,serverId+'\n',{flag:'wx',mode:0o600});}
 catch(e){guard(e.code==='EEXIST');fixed(file);guard(fs.readFileSync(file,'utf8')===serverId+'\n');}
}
export async function boundedBrowserOperation(operation,timeoutMs=15000){
 guard(typeof operation==='function'&&Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=30000);let timer;
 try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Private browser operation timed out')),timeoutMs);})]);}
 catch{refused();}finally{clearTimeout(timer);}
}
export async function closeLinuxWebKitConnection(close,stop,timeoutMs=5000){
 guard(typeof close==='function'&&typeof stop==='function'&&Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=5000);
 let timer,failed=false;
 try{await Promise.race([Promise.resolve().then(close),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Private close timed out')),timeoutMs);})]);}
 catch{failed=true;}finally{clearTimeout(timer);try{stop();}catch{failed=true;}}
 guard(!failed);
}
export async function connectLinuxWebKit(webkit,options={}){
 let descriptor,browser,stage='metadata';
 try{
  guard(webkit.name()==='webkit');descriptor=readLinuxWebKitConnection(options);
  stage='connect';browser=await webkit.connect(descriptor.connection.endpoint,{timeout:Math.min(15000,options.deadline-Date.now())});
  stage='identity';guard(browser.browserType().name()==='webkit'&&Date.now()<options.deadline&&Date.now()<descriptor.connection.expires_at);
  const close=browser.close.bind(browser);
  browser.close=closeOptions=>closeLinuxWebKitConnection(()=>close(closeOptions),()=>requestStop(descriptor.directory,descriptor.connection.server_id));
  return browser;
 }catch(error){
  if(descriptor)try{fs.writeFileSync(descriptor.directory+'/connection-failure.json',JSON.stringify({stage,error:String(error?.stack||error)},null,2),{flag:'wx',mode:0o600});}catch{}
  if(descriptor)try{requestStop(descriptor.directory,descriptor.connection.server_id);}catch{}
  if(browser)await closeLinuxWebKitConnection(()=>browser.close(),()=>{}).catch(()=>{});
  refused();
 }
}
