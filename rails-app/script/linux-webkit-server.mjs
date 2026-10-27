import fs from 'node:fs';
import {dirname} from 'node:path';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {validServerId,validateLinuxWebKitConnection} from './linux-webkit-connection.mjs';
import {LEASE2,LEASE3,leaseContext,assertLeaseMutationAllowed} from './staging-lease-context.mjs';
const TOOLS='/mnt/d/Projects/isp-rails-tools/virtual-browser-tools';
const NODE='/mnt/d/Projects/isp-rails-tools/node24-linux/node';
const BROWSERS='/mnt/d/Projects/isp-rails-tools/virtual-browsers-linux';
const DEPS='/mnt/d/Projects/isp-rails-tools/linux-browser-libs';
const LIBS=DEPS+'/root/usr/lib/x86_64-linux-gnu',WPE=BROWSERS+'/webkit-2370/minibrowser-wpe';
const guard=ok=>{if(!ok)throw Error('Linux WebKit server refused');};
function existingDirectory(p){const s=fs.lstatSync(p);guard(s.isDirectory()&&!s.isSymbolicLink()&&fs.realpathSync(p)===p);}
function directory(p,fresh=false){existingDirectory(dirname(p));try{fs.mkdirSync(p,{mode:0o700});}catch(e){guard(!fresh&&e.code==='EEXIST');}existingDirectory(p);}
function durable(p,v){const fd=fs.openSync(p,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(v,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
let server,phase='prerequisites';
async function main(){
 const args=process.argv.slice(2);guard(args.length===4&&args[0]==='--lease'&&[LEASE2,LEASE3].includes(args[1])&&args[2]==='--id'&&validServerId(args[3]));const leaseId=args[1],id=args[3],context=leaseContext(leaseId);
 assertLeaseMutationAllowed(context);const PRIVATE=context.privateRoot.replace(/^D:/,'/mnt/d');
 guard(process.platform==='linux'&&process.arch==='x64'&&process.versions.node==='24.21.0'&&fs.realpathSync(process.execPath)===NODE);
 const release=fs.readFileSync('/etc/os-release','utf8');guard(/^ID=ubuntu$/m.test(release)&&/^VERSION_ID="24\.04"$/m.test(release));
 existingDirectory(PRIVATE);directory(PRIVATE+'/linux-webkit');const run=`${PRIVATE}/linux-webkit/${id}`;directory(run,true);
 for(const name of ['tmp','cache','config','data','runtime','artifacts','downloads','traces'])directory(`${run}/${name}`,true);
 const proof=JSON.parse(fs.readFileSync(DEPS+'/verification.json','utf8'));guard(proof.elf_files_checked>=198&&Array.isArray(proof.ldd_failures)&&proof.ldd_failures.length===0&&proof.dlopen_exit_code===0&&proof.dlopen_output==='[]'&&proof.home_preserved===true);
 const executable=WPE+'/bin/MiniBrowser';guard(fs.lstatSync(executable).isFile()&&!fs.lstatSync(executable).isSymbolicLink()&&fs.realpathSync(executable)===executable);
 const overrides={PATH:'/usr/bin:/bin',LANG:'C.UTF-8',TMPDIR:`${run}/tmp`,TMP:`${run}/tmp`,TEMP:`${run}/tmp`,XDG_CACHE_HOME:`${run}/cache`,XDG_CONFIG_HOME:`${run}/config`,XDG_DATA_HOME:`${run}/data`,XDG_RUNTIME_DIR:`${run}/runtime`,PLAYWRIGHT_BROWSERS_PATH:BROWSERS,LD_LIBRARY_PATH:WPE+'/lib:'+WPE+'/sys/lib:'+LIBS+':'+LIBS+'/libproxy:'+DEPS+'/root/usr/lib:'+BROWSERS+'/webkit-2370/minibrowser-gtk/lib:'+BROWSERS+'/webkit-2370/minibrowser-gtk/sys/lib',WEBKIT_EXEC_PATH:WPE+'/bin',WEBKIT_INJECTED_BUNDLE_PATH:WPE+'/lib',WEBKIT_INSPECTOR_RESOURCES_PATH:WPE+'/share',WEBKIT_FORCE_COMPLEX_TEXT:'1',GIO_EXTRA_MODULES:LIBS+'/gio/modules',GSETTINGS_SCHEMA_DIR:DEPS+'/root/usr/share/glib-2.0/schemas',GSETTINGS_BACKEND:'memory',XDG_DATA_DIRS:DEPS+'/root/usr/share:/usr/local/share:/usr/share',GST_REGISTRY_1_0:run+'/cache/gstreamer-registry.bin',MESA_SHADER_CACHE_DIR:run+'/cache'};
 for(const key of Object.keys(process.env))if(key!=='HOME')delete process.env[key];
 Object.assign(process.env,overrides);const env={...process.env};process.chdir(run);
 const require=createRequire(TOOLS+'/package.json');guard(require('playwright/package.json').version==='1.64.1');
 const catalog=JSON.parse(fs.readFileSync(TOOLS+'/node_modules/playwright-core/browsers.json','utf8'));guard(catalog.browsers.some(b=>b.name==='webkit'&&b.revision==='2370'));
 const {webkit}=require('playwright');guard(webkit.executablePath().startsWith(BROWSERS+'/webkit-2370/'));
 const born=Date.now(),expires=born+55*60000;phase='launch';
 server=await webkit.launchServer({executablePath:executable,headless:true,host:'127.0.0.1',port:0,wsPath:randomBytes(32).toString('hex'),timeout:60000,env,artifactsDir:`${run}/artifacts`,downloadsPath:`${run}/downloads`,tracesDir:`${run}/traces`});
 const connection={version:2,lease_id:leaseId,private_root:context.privateRoot,audit_root:context.auditRoot,server_id:id,engine:'webkit',platform:process.platform,arch:process.arch,node_version:process.versions.node,playwright_version:'1.64.1',browser_revision:'2370',ws_endpoint:server.wsEndpoint(),created_at:new Date(born).toISOString(),expires_at:new Date(expires).toISOString(),server_pid_linux:process.pid};
 validateLinuxWebKitConnection(connection,{serverId:id,leaseId,deadline:expires});phase='private_connection';durable(`${run}/connection.json`,connection);
 console.log(JSON.stringify({status:'ready',lease_id:leaseId,server_id:id,expires_at:connection.expires_at,platform:'linux',playwright_version:'1.64.1'}));phase='serving';
 await new Promise(resolve=>{
  let stopping=false,poll,expiry;
  const cleanup=()=>{clearInterval(poll);clearTimeout(expiry);process.off('SIGINT',stop);process.off('SIGTERM',stop);process.off('SIGHUP',stop);};
  const stop=()=>{
   if(stopping)return;stopping=true;cleanup();const hard=setTimeout(()=>{void server.kill().catch(()=>{});},5000);
   void server.close().catch(()=>{process.exitCode=1;return server.kill();}).catch(()=>{process.exitCode=1;}).finally(()=>{clearTimeout(hard);resolve();});
  };
  poll=setInterval(()=>{
   try{const p=`${run}/stop`;let stat;try{stat=fs.lstatSync(p);}catch(e){if(e.code==='ENOENT')return;throw e;}
    guard(stat.isFile()&&!stat.isSymbolicLink()&&fs.realpathSync(p)===p&&stat.size<=64&&fs.readFileSync(p,'utf8')===id+'\n');stop();
   }catch{process.exitCode=1;stop();}
  },500);
  expiry=setTimeout(stop,Math.max(1,expires-Date.now()));server.once('close',()=>{if(!stopping)process.exitCode=1;cleanup();resolve();});
  process.once('SIGINT',stop);process.once('SIGTERM',stop);process.once('SIGHUP',stop);
  if(server.process().exitCode!==null||server.process().signalCode!==null){process.exitCode=1;stop();}
 });
}
main().catch(async()=>{if(server)await server.kill().catch(()=>{});console.error(JSON.stringify({error:'Linux WebKit server refused or failed; private endpoint suppressed',phase}));process.exitCode=1;});
