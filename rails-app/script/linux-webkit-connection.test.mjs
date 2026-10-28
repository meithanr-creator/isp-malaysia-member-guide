import test from 'node:test';
import assert from 'node:assert/strict';
import {validServerId,validateLinuxWebKitConnection,closeLinuxWebKitConnection,boundedBrowserOperation} from './linux-webkit-connection.mjs';
const ID='9cbf15d1-2363-47a2-9c39-0ac8d8d27ca0',TOKEN='a'.repeat(64),NOW=Date.parse('2026-10-27T01:00:00.000Z');
const LEASE='rails-staging-2';
const DEADLINE=NOW+45*60000,START=NOW-1000,END=START+55*60000;
function connection(changes={}){return {version:2,lease_id:LEASE,private_root:'D:/Projects/isp-rails-tools/isp-staging-private/leases/'+LEASE,audit_root:'D:/Projects/isp-member-rails/audit/staging-2',server_id:ID,engine:'webkit',platform:'linux',arch:'x64',node_version:'24.21.0',playwright_version:'1.64.1',browser_revision:'2370',ws_endpoint:`ws://127.0.0.1:40251/${TOKEN}`,created_at:new Date(START).toISOString(),expires_at:new Date(END).toISOString(),server_pid_linux:1234,...changes};}
const validate=(p,changes={})=>validateLinuxWebKitConnection(p,{serverId:ID,leaseId:LEASE,deadline:DEADLINE,now:NOW,...changes});
test('pinned Linux WebKit server covers the entire bounded acceptance period',()=>{
 const p=connection(),v=validate(p);assert.equal(v.endpoint,p.ws_endpoint);assert.equal(v.platform,'linux');assert.equal(v.expires_at,END);assert.ok(Object.isFrozen(v));assert.deepEqual(p,connection());
});
test('connection metadata cannot substitute engine, platform, tool version or server identity',()=>{
 for(const changes of [{version:3},{server_id:'3d08453c-2c65-48ed-9360-4892a4867458'},{engine:'chromium'},{platform:'win32'},{arch:'arm64'},{node_version:'24.22.0'},{playwright_version:'1.64.0'},{browser_revision:'2369'},{server_pid_linux:0},{server_pid_linux:'1234'}])assert.throws(()=>validate(connection(changes)));
 assert.throws(()=>validate(connection(),{serverId:undefined}));assert.equal(validServerId(ID),true);
 for(const id of ['../escape',ID.toUpperCase(),'','9cbf15d1-2363-17a2-9c39-0ac8d8d27ca0'])assert.equal(validServerId(id),false);
});
test('only literal IPv4 loopback, bounded port and unguessable path are accepted',()=>{
 const endpoints=[`ws://localhost:40251/${TOKEN}`,`ws://0.0.0.0:40251/${TOKEN}`,`ws://127.0.0.1.evil.test:40251/${TOKEN}`,`ws://[::1]:40251/${TOKEN}`,`wss://127.0.0.1:40251/${TOKEN}`,`http://127.0.0.1:40251/${TOKEN}`,`ws://user:pass@127.0.0.1:40251/${TOKEN}`,`ws://127.0.0.1:1023/${TOKEN}`,`ws://127.0.0.1:99999/${TOKEN}`,`ws://127.0.0.1:40251/${TOKEN}?key=x`,`ws://127.0.0.1:40251/${TOKEN}#x`,`ws://127.0.0.1:40251/${TOKEN}/`,'ws://127.0.0.1:40251/short',`ws://127.0.0.1:40251/${TOKEN.toUpperCase()}`];
 for(const endpoint of endpoints)assert.throws(()=>validate(connection({ws_endpoint:endpoint})),{message:'Private Linux WebKit connection refused'});
 assert.doesNotThrow(()=>validate(connection({ws_endpoint:`ws://127.0.0.1:65535/${TOKEN}`})));
});
test('stale, future, noncanonical or too-short server lifetimes fail before connection',()=>{
 for(const changes of [{created_at:new Date(NOW+5001).toISOString()},{created_at:new Date(START).toISOString().replace('.000Z','Z')},{expires_at:new Date(NOW-1).toISOString()},{expires_at:new Date(START+55*60000+1).toISOString()},{expires_at:new Date(DEADLINE-1).toISOString()},{expires_at:'invalid'}])assert.throws(()=>validate(connection(changes)));
 for(const now of [NaN,Infinity,-1,NOW+0.5])assert.throws(()=>validate(connection(),{now}));
 assert.throws(()=>validate(connection(),{deadline:NOW+30000}));assert.throws(()=>validate(connection(),{deadline:END+1}));assert.throws(()=>validate(connection(),{now:END}));
});
test('missing and extra fields cannot turn a Linux process into a Windows watchdog claim',()=>{
 for(const p of [null,[],undefined,true])assert.throws(()=>validate(p));const missing=connection();delete missing.server_pid_linux;assert.throws(()=>validate(missing));assert.throws(()=>validate(connection({watchdog_pid:1234})));assert.throws(()=>validate(Object.create(connection())));
});
test('invalid private endpoints are never included in validator errors',()=>{
 for(const endpoint of [`ws://127.0.0.1:99999/${TOKEN}`,`https://secret:${TOKEN}@example.test/`]){
  try{validate(connection({ws_endpoint:endpoint}));assert.fail('Connection must be refused');}catch(e){assert.equal(e.message,'Private Linux WebKit connection refused');assert.equal(e.message.includes(TOKEN),false);}
 }
});

test('newline IDs and endpoints are refused',()=>{
 assert.equal(validServerId(ID+'\n'),false);assert.equal(validServerId(ID+'\r\n'),false);
 for(const suffix of ['\n','\r\n',' '])assert.throws(()=>validate(connection({ws_endpoint:connection().ws_endpoint+suffix})),{message:'Private Linux WebKit connection refused'});
});
test('stop is requested when protocol close hangs or rejects',async()=>{
 let stops=0;
 await assert.rejects(closeLinuxWebKitConnection(()=>new Promise(()=>{}),()=>{stops++;},10),{message:'Private Linux WebKit connection refused'});assert.equal(stops,1);
 await assert.rejects(closeLinuxWebKitConnection(()=>Promise.reject(Error('private endpoint')),()=>{stops++;},10),{message:'Private Linux WebKit connection refused'});assert.equal(stops,2);
 await closeLinuxWebKitConnection(()=>Promise.resolve(),()=>{stops++;},10);assert.equal(stops,3);
});

test('browser setup operations are bounded and suppress protocol details',async()=>{
 await assert.rejects(boundedBrowserOperation(()=>new Promise(()=>{}),10),{message:'Private Linux WebKit connection refused'});
 await assert.rejects(boundedBrowserOperation(()=>Promise.reject(Error('private endpoint')),10),{message:'Private Linux WebKit connection refused'});
 assert.equal(await boundedBrowserOperation(()=>Promise.resolve(42),10),42);
});

test('descriptors bind explicit fixed lease and both canonical private/audit roots',()=>{
 for(const leaseId of ['rails-staging-2','rails-staging-3']){
  const p=connection({lease_id:leaseId,private_root:'D:/Projects/isp-rails-tools/isp-staging-private/leases/'+leaseId,audit_root:'D:/Projects/isp-member-rails/audit/staging-'+leaseId.slice(-1)});
  const v=validate(p,{leaseId});assert.equal(v.lease_id,leaseId);assert.equal(v.private_root,p.private_root);assert.equal(v.audit_root,p.audit_root);
  for(const patch of [{lease_id:undefined},{private_root:'D:/wrong'},{audit_root:'D:/wrong'},{lease_id:'legacy-1'}])assert.throws(()=>validate({...p,...patch},{leaseId}));
 }
 for(const leaseId of [undefined,'legacy-1','rails-staging-4','rails-staging-3\\n'])assert.throws(()=>validate(connection(),{leaseId}));
});
