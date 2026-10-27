import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {LEASE3,ACCESS,argumentsFor,plan,main,childEnvironment,runReadHelper,validateDatabaseReceipt,validateStorageReceipt,invalidateReady,finishObservations} from './staging-access-observations.mjs';
const now=Date.parse('2026-10-27T12:00:40Z'),startedAt=now-40000,at=new Date(startedAt+1000).toISOString(),options={startedAt,now};
const database=()=>({version:1,kind:'postgresql-readonly-access',lease_id:LEASE3,observed_at:at,status:'PASS',read_only:true,transaction_read_only:'on',ssl_verified:true,tls_protocol:'TLSv1.3',tls_cipher:'TLS_AES_256_GCM_SHA384',project:ACCESS.project,host:ACCESS.host,database:ACCESS.database,pg_major:18,sslmode:'verify-full'});
const storage=()=>({version:1,kind:'r2-readonly-access',lease_id:LEASE3,observed_at:at,status:'PASS',read_only:true,tls_verified:true,authenticated_head_status:200,authenticated_list_status:200,anonymous_denied:true,anonymous_status:403,truncated:false,public_access_verified:true,private:true,access_verified:true,bucket:ACCESS.bucket,endpoint:ACCESS.endpoint,managed_public_enabled:false,custom_domains_disabled:true,custom_domains_complete:true,cf_managed_status:200,cf_custom_status:200,cf_managed_sha256:'a'.repeat(64),cf_custom_sha256:'b'.repeat(64),object_count:0});
const outcome=value=>({closed:true,exit_code:0,signal:null,failure:null,stdout:JSON.stringify(value)});
function memorySink(){
 const leaves=new Map([['database',{status:'PASS',old:true}],['storage',{status:'PASS',old:true}]]),archives=[];
 return {leaves,archives,archive:(kind,value)=>archives.push({kind,value}),replaceReady:(kind,value)=>leaves.set(kind,value)};
}
const local={DATABASE_URL_UNPOOLED:'postgresql://synthetic-user:synthetic-password@'+ACCESS.host+'/neondb?sslmode=verify-full',NEON_VERIFY_HOST:ACCESS.host,DB_SSLMODE:'verify-full'};
const r2={STORAGE_BUCKET:ACCESS.bucket,AWS_ACCESS_KEY_ID:'K'.repeat(32),AWS_SECRET_ACCESS_KEY:'S'.repeat(64)},credential={token:'T'.repeat(40)};

test('plan and import-facing API need no secret reads, I/O, network or capture',async()=>{
 let captures=0;const lines=[];const value=await main(['--plan'],{captureObservation:()=>{captures++;assert.fail('capture was invoked');},log:s=>lines.push(JSON.parse(s))});
 assert.equal(captures,0);assert.equal(lines.length,1);assert.equal(value.executes,false);assert.equal(value.secret_reads,0);assert.equal(value.network_requests,0);assert.equal(value.execution_authority,false);assert.deepEqual(value,plan());assert.equal(value.lease_id,LEASE3);
});
test('capture requires the one explicit lease3 command and never prints arbitrary arguments',()=>{
 assert.deepEqual(argumentsFor(['--capture','--lease',LEASE3]),{capture:true,leaseId:LEASE3});
 for(const args of [['--capture'],['--capture','--lease','rails-staging-2'],['--capture','--lease','rails-staging-4'],['--capture','--lease',LEASE3,'--token','PRIVATE-TEST-SECRET']]){
  try{argumentsFor(args);assert.fail('must refuse');}catch(e){assert.equal(e.message.includes('PRIVATE-TEST-SECRET'),false);}
 }
});
test('PostgreSQL PASS requires current actual read-only TLS and the exact fixed target',()=>{
 const value=validateDatabaseReceipt(database(),options);assert.equal(value.transaction_read_only,'on');assert.match(value.project_identity_basis,/not_a_server_reported_project_id/);
 for(const patch of [{status:'BLOCKED'},{read_only:false},{transaction_read_only:'off'},{ssl_verified:false},{tls_protocol:'TLSv1.1'},{tls_cipher:''},{host:'foreign.neon.tech'},{database:'other'},{project:'other-project'},{pg_major:17},{sslmode:'require'},{lease_id:'rails-staging-2'}])assert.throws(()=>validateDatabaseReceipt({...database(),...patch},options));
});
test('receipt age is measured from actual start, with no completion-time substitution',()=>{
 for(const observed_at of [new Date(startedAt-1).toISOString(),new Date(now+1).toISOString(),new Date(now-60001).toISOString(),'invalid'])assert.throws(()=>validateDatabaseReceipt({...database(),observed_at},options));
 assert.throws(()=>validateDatabaseReceipt(database(),{startedAt,now:now+60001}));
});
test('R2 authenticated access and S3 denial alone never prove the bucket private',()=>{
 const good=validateStorageReceipt(storage(),options);assert.equal(good.private,true);
 for(const patch of [{public_access_verified:false},{managed_public_enabled:true},{custom_domains_disabled:false},{custom_domains_complete:false},{cf_managed_status:403},{cf_custom_status:403},{cf_custom_sha256:'missing'},{cf_managed_sha256:undefined}])assert.throws(()=>validateStorageReceipt({...storage(),...patch},options));
});
test('anonymous denial accepts only the contract statuses and allowed XML authentication codes',()=>{
 for(const anonymous_status of [401,403])assert.equal(validateStorageReceipt({...storage(),anonymous_status},options).anonymous_status,anonymous_status);
 for(const authentication_error_code of ['InvalidArgument','InvalidRequest','AuthorizationHeaderMalformed','SignatureDoesNotMatch'])assert.equal(validateStorageReceipt({...storage(),anonymous_status:400,authentication_error_code},options).authentication_error_code,authentication_error_code);
 for(const patch of [{anonymous_status:200},{anonymous_status:404},{anonymous_status:400},{anonymous_status:400,authentication_error_code:'NoSuchBucket'},{anonymous_denied:false}])assert.throws(()=>validateStorageReceipt({...storage(),...patch},options));
});
test('truncation, non-successful authenticated calls and incomplete counts remain BLOCKED',()=>{
 for(const patch of [{truncated:true},{truncated:null},{authenticated_head_status:403},{authenticated_list_status:503},{object_count:1001},{object_count:-1},{access_verified:false},{tls_verified:false}])assert.throws(()=>validateStorageReceipt({...storage(),...patch},options));
});
test('receipt projection never publishes object names, rows, credentials or provider error bodies',()=>{
 const secret='PRIVATE-TEST-SECRET',db=validateDatabaseReceipt({...database(),rows:[secret],password:secret},options),store=validateStorageReceipt({...storage(),keys:[secret],domains:[secret],error_body:secret,token:secret},options);
 assert.equal(JSON.stringify({db,store}).includes(secret),false);
});
test('child environment is an allowlist; Cloudflare token goes only to storage and never arguments',()=>{
 const inherited={SystemRoot:'C:/Windows',PATH:'injected',RUBYOPT:'injected',RUBYLIB:'injected',PGHOST:'foreign',AWS_SESSION_TOKEN:'injected',NODE_OPTIONS:'injected',HTTP_PROXY:'injected',DEBUG:'*'};
 const db=childEnvironment('database',{local,inherited}),store=childEnvironment('storage',{r2,credential,inherited});
 for(const key of ['RUBYOPT','RUBYLIB','PGHOST','AWS_SESSION_TOKEN','NODE_OPTIONS','HTTP_PROXY','DEBUG']){assert.equal(db[key],undefined);assert.equal(store[key],undefined);}
 assert.equal(db.ISP_CF_METADATA_TOKEN,undefined);assert.equal(db.AWS_SECRET_ACCESS_KEY,undefined);assert.equal(store.DATABASE_URL_UNPOOLED,undefined);assert.equal(store.ISP_CF_METADATA_TOKEN,credential.token);assert.equal(db.PGSSLROOTCERT,ACCESS.ca);assert.equal(store.SSL_CERT_FILE,ACCESS.ca);assert.equal(db.TEMP,ACCESS.temp);assert.equal(db.ISP_STAGING_LEASE,LEASE3);assert.equal(store.ISP_STAGING_LEASE,LEASE3);assert.equal(store.AWS_EC2_METADATA_DISABLED,'true');
});
test('direct URL and bucket/credential overrides are rejected without fallback',()=>{
 for(const patch of [{NEON_VERIFY_HOST:'foreign.neon.tech'},{DB_SSLMODE:'require'},{DATABASE_URL_UNPOOLED:local.DATABASE_URL_UNPOOLED+'&hostaddr=1.2.3.4'},{DATABASE_URL_UNPOOLED:local.DATABASE_URL_UNPOOLED.replace('/neondb','/other')}])assert.throws(()=>childEnvironment('database',{local:{...local,...patch}}));
 assert.throws(()=>childEnvironment('storage',{r2:{...r2,STORAGE_BUCKET:'other'},credential}));assert.throws(()=>childEnvironment('storage',{r2,credential:undefined}));
});
test('ready leaves are invalidated before reads and archived PASS is published only after both actual passes',()=>{
 const sink=memorySink();invalidateReady(sink,'access_capture_in_progress',startedAt);assert.ok([...sink.leaves.values()].every(x=>x.status==='BLOCKED'));
 const result=finishObservations({database:outcome(database()),storage:outcome(storage())},sink,options);assert.equal(result.status,'PASS');assert.equal(result.process_cleanup,true);assert.equal(sink.archives.length,4);assert.ok([...sink.leaves.values()].every(x=>x.status==='PASS'&&!x.old));assert.equal(result.execution_authority,false);
});
test('missing R2 metadata permission archives failure and invalidates every old ready PASS',()=>{
 const sink=memorySink();const result=finishObservations({database:outcome(database()),storage:outcome({status:'BLOCKED',code:'r2_metadata_permission_required',error_body:credential.token})},sink,options);
 assert.equal(result.status,'BLOCKED');assert.equal(result.codes.storage,'r2_metadata_permission_required');assert.ok([...sink.leaves.values()].every(x=>x.status==='BLOCKED'));assert.equal(sink.archives.find(x=>x.kind==='storage').value.status,'FAIL');assert.equal(JSON.stringify(sink.archives).includes(credential.token),false);
});
test('stdout PASS cannot survive a failed exit, timeout or unverified process cleanup',()=>{
 for(const patch of [{closed:false},{exit_code:1},{signal:'SIGTERM'},{failure:'helper_timeout'},{stdout:'private malformed output'}]){
  const sink=memorySink(),result=finishObservations({database:{...outcome(database()),...patch},storage:outcome(storage())},sink,options);
  assert.equal(result.status,'BLOCKED');assert.ok([...sink.leaves.values()].every(x=>x.status==='BLOCKED'));assert.notEqual(sink.archives.find(x=>x.kind==='database').value.status,'PASS');
 }
});
test('archive or partial ready-write failures cannot leave a usable PASS pair',()=>{
 for(const mode of ['archive','refresh']){
  const sink=memorySink(),archive=sink.archive,replace=sink.replaceReady;invalidateReady(sink,'access_capture_in_progress',startedAt);
  sink.archive=(kind,value)=>{if(mode==='archive')throw Error('disk failure');archive(kind,value);};
  sink.replaceReady=(kind,value)=>{if(mode==='refresh'&&kind==='storage'&&value.status==='PASS')throw Error('disk failure');replace(kind,value);};
  assert.throws(()=>finishObservations({database:outcome(database()),storage:outcome(storage())},sink,options));assert.ok([...sink.leaves.values()].every(x=>x.status==='BLOCKED'));
 }
});
function fakeChild({closeOnKill=true}={}){
 const child=new EventEmitter();child.pid=123;child.stdout=new PassThrough();child.stderr=new PassThrough();child.kills=0;child.unref=()=>{child.unreferenced=true;};
 child.kill=()=>{child.kills++;if(closeOnKill)queueMicrotask(()=>child.emit('close',137,'SIGKILL'));return closeOnKill;};
 return child;
}
test('fixed Ruby child is hidden, shell-free, bounded and observed closed before success',async()=>{
 const child=fakeChild();let seen;const run=runReadHelper((exe,args,options)=>{seen={exe,args,options};queueMicrotask(()=>{child.stdout.write(JSON.stringify(database()));child.emit('close',0,null);});return child;},'database',{DATABASE_URL_UNPOOLED:local.DATABASE_URL_UNPOOLED},{readMs:20,cleanupMs:20});const value=await run;
 assert.equal(value.closed,true);assert.equal(value.exit_code,0);assert.equal(value.failure,null);assert.equal(seen.exe,ACCESS.ruby);assert.deepEqual(seen.args,['-rbundler/setup',ACCESS.root+'/script/staging-postgres-access.rb']);assert.equal(seen.options.shell,false);assert.equal(seen.options.windowsHide,true);assert.equal(JSON.stringify(seen.args).includes('synthetic-password'),false);
});
test('hanging read is killed and a pre-exit PASS remains failed evidence',async()=>{
 const child=fakeChild();const value=await runReadHelper(()=>{queueMicrotask(()=>child.stdout.write(JSON.stringify(database())));return child;},'database',{}, {readMs:5,cleanupMs:20});
 assert.equal(child.kills,1);assert.equal(value.closed,true);assert.equal(value.failure,'helper_timeout');const sink=memorySink();assert.equal(finishObservations({database:value,storage:outcome(storage())},sink,options).status,'BLOCKED');
});
test('cleanup is bounded and unobserved child absence is never claimed as PASS',async()=>{
 const child=fakeChild({closeOnKill:false});const value=await runReadHelper(()=>child,'storage',{}, {readMs:5,cleanupMs:5});assert.equal(value.closed,false);assert.equal(value.failure,'helper_process_cleanup_unverified');assert.equal(child.unreferenced,true);
});
test('actual CLI --plan remains inert and --capture without the explicit lease is refused',()=>{
 const file=fileURLToPath(new URL('./staging-access-observations.mjs',import.meta.url)),r=spawnSync(process.execPath,[file,'--plan'],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(r.status,0,r.stderr);const value=JSON.parse(r.stdout);assert.equal(value.executes,false);assert.equal(value.secret_reads,0);assert.equal(value.network_requests,0);assert.equal(value.execution_authority,false);
 const refused=spawnSync(process.execPath,[file,'--capture'],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(refused.status,1);assert.match(refused.stderr,/fixed_capture_command_required/);
});

const RUBY_CHECKS="load ARGV.shift\nm = StagingStorageAccess\ncount = 0\ncheck = ->(ok) { raise \"Pure metadata assertion failed\" unless ok; count += 1 }\ndef refuses(kind)\n  begin\n    yield\n  rescue kind\n    return true\n  end\n  raise \"Expected pure metadata refusal\"\nend\ncheck.call(m.private_routes!({\"enabled\"=>false},{\"domains\"=>[]}))\ncheck.call(m.private_routes!({\"enabled\"=>false},{\"domains\"=>[{\"domain\"=>\"disabled.example.invalid\",\"enabled\"=>false}]}))\ncheck.call(refuses(m::PublicAccessEnabled) { m.private_routes!({\"enabled\"=>true},{\"domains\"=>[]}) })\ncheck.call(refuses(m::PublicAccessEnabled) { m.private_routes!({\"enabled\"=>false},{\"domains\"=>[{\"domain\"=>\"public.example.invalid\",\"enabled\"=>true}]}) })\ncheck.call(refuses(m::MetadataIncomplete) { m.private_routes!({\"enabled\"=>false},{}) })\ncheck.call(refuses(m::MetadataIncomplete) { m.private_routes!({\"enabled\"=>false},{\"domains\"=>[{\"domain\"=>\"incomplete.example.invalid\"}]}) })\n[401,403].each { |status| check.call(m.anonymous_denial(status: status,body:\"\")[0]) }\nm::AUTH_CODES.each { |code| check.call(m.anonymous_denial(status: 400,body:\"<Error><Code>\"+code+\"</Code><Message>Authentication signature required</Message></Error>\")[0]) }\ncheck.call(!m.anonymous_denial(status: 400,body:\"<Error><Code>InvalidArgument</Code><Message>Invalid query parameter</Message></Error>\")[0])\ncheck.call(!m.anonymous_denial(status: 200,body:\"\")[0])\ncheck.call(!m.anonymous_denial(status: 404,body:\"<Code>NoSuchBucket</Code>\")[0])\nenvelope = {\"success\"=>true,\"errors\"=>[],\"messages\"=>[],\"result\"=>{\"enabled\"=>false}}\ncheck.call(m.metadata(status: 200,body:JSON.generate(envelope)) == {\"enabled\"=>false})\ncheck.call(refuses(m::MetadataPermission) { m.metadata(status: 403,body:\"private provider body\") })\ncheck.call(refuses(m::MetadataIncomplete) { m.metadata(status: 200,body:JSON.generate(envelope.merge(\"result_info\"=>{\"page\"=>2}))) })\ncheck.call(refuses(m::MetadataIncomplete) { m.metadata(status: 200,body:JSON.generate(envelope.merge(\"success\"=>false))) })\ncheck.call(refuses(m::MetadataIncomplete) { m.metadata(status: 200,body:JSON.generate(envelope.merge(\"errors\"=>[{\"code\"=>10000}]))) })\nclass FakeReadOnlyHTTP\n  attr_accessor :use_ssl,:verify_mode,:verify_hostname,:ca_file,:min_version,:open_timeout,:read_timeout\n  def start\n    raise \"TLS configuration missing\" unless use_ssl && verify_mode == OpenSSL::SSL::VERIFY_PEER && verify_hostname && ca_file == StagingStorageAccess::CA\n    yield self\n  end\n  def request(_request)\n    response = Object.new\n    def response.code = \"200\"\n    def response.[](_key) = nil\n    def response.read_body\n      yield \"x\" * (StagingStorageAccess::BODY_BOUND + 1)\n    end\n    yield response\n  end\nend\noriginal_new = Net::HTTP.method(:new)\nbegin\n  Net::HTTP.define_singleton_method(:new) { |*_args| FakeReadOnlyHTTP.new }\n  check.call(refuses(m::MetadataIncomplete) { m.get(URI(\"https://api.cloudflare.com/client/v4/fixed-test\")) })\nensure\n  Net::HTTP.define_singleton_method(:new,original_new)\nend\n\n[true,false].each do |with_length|\n  response = Seahorse::Client::Http::Response.new\n  request = Object.new\n  request.define_singleton_method(:context) { Struct.new(:http_response).new(response) }\n  request.define_singleton_method(:send_request) do\n    response.signal_headers(200,with_length ? {\"content-length\"=>\"11\"} : {})\n    response.signal_data(\"x\"*11)\n  end\n  client = Object.new\n  client.define_singleton_method(:build_request) { |*_args| request }\n  check.call(refuses(m::MetadataIncomplete) { m.bounded_s3(client,:list_objects_v2,{bucket:\"synthetic\"},10) })\n  check.call(response.body.size <= 10)\nend\n\nputs JSON.generate(status:\"PASS\",assertions:count,network_requests:0,secret_reads:0)\n";

test('actual Ruby privacy parser rejects public, incomplete, denied or oversized metadata without network',()=>{
 const helper=fileURLToPath(new URL('./staging-storage-access.rb',import.meta.url)),ruby=process.platform==='win32'?ACCESS.ruby:'ruby',env={};
 for(const key of ['SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','PATH','Path','HOME','USERPROFILE','GEM_HOME','GEM_PATH','BUNDLE_GEMFILE','BUNDLE_PATH','BUNDLE_USER_HOME','TEMP','TMP'])if(process.env[key]!==undefined)env[key]=process.env[key];
 if(process.platform==='win32')Object.assign(env,{GEM_HOME:ACCESS.gems,GEM_PATH:ACCESS.gems,BUNDLE_GEMFILE:ACCESS.root+'/Gemfile',BUNDLE_USER_HOME:'D:/Projects/isp-rails-tools/bundle-home',TEMP:ACCESS.temp,TMP:ACCESS.temp});
 const r=spawnSync(ruby,['-rbundler/setup','-e',RUBY_CHECKS,helper],{cwd:fileURLToPath(new URL('../',import.meta.url)),env,shell:false,windowsHide:true,encoding:'utf8',timeout:30000});
 assert.equal(r.status,0,r.stderr);const value=JSON.parse(r.stdout);assert.equal(value.status,'PASS');assert.ok(value.assertions>=20);assert.equal(value.network_requests,0);assert.equal(value.secret_reads,0);
});

const PG_HOST_CHECKS="load ARGV.shift\nhost = StagingPostgresAccess::HOST\ncases = [\n  [host,true],\n  [host+\",\"+host,true],\n  [host+\",\"+host+\",\"+host,true],\n  [\"\",false],\n  [\",\"+host,false],\n  [host+\",\",false],\n  [host+\",,\"+host,false],\n  [host+\",\"+host+\",\",false],\n  [\"foreign.neon.tech\",false],\n  [host+\",foreign.neon.tech\",false],\n  [\"foreign.neon.tech,\"+host,false],\n  [host+\", \"+host,false],\n  [host+10.chr,false],\n  [nil,false],\n  [false,false],\n  [true,false],\n  [123,false],\n  [[host],false]\n]\ncases.each do |value,expected|\n  raise \"Connected host normalization mismatch\" unless StagingPostgresAccess.hosts_match?(value) == expected\nend\nputs JSON.generate(status:\"PASS\",assertions:cases.length,connections:0,secret_reads:0)\n";

test('actual Ruby connected-host normalization accepts only nonempty repetitions of the fixed host',()=>{
 const helper=fileURLToPath(new URL('./staging-postgres-access.rb',import.meta.url)),ruby=process.platform==='win32'?ACCESS.ruby:'ruby',env={};
 for(const key of ['SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','PATH','Path','HOME','USERPROFILE','GEM_HOME','GEM_PATH','BUNDLE_GEMFILE','BUNDLE_PATH','BUNDLE_USER_HOME','TEMP','TMP'])if(process.env[key]!==undefined)env[key]=process.env[key];
 if(process.platform==='win32')Object.assign(env,{GEM_HOME:ACCESS.gems,GEM_PATH:ACCESS.gems,BUNDLE_GEMFILE:ACCESS.root+'/Gemfile',BUNDLE_USER_HOME:'D:/Projects/isp-rails-tools/bundle-home',TEMP:ACCESS.temp,TMP:ACCESS.temp});
 const r=spawnSync(ruby,['-rbundler/setup','-e',PG_HOST_CHECKS,helper],{cwd:fileURLToPath(new URL('../',import.meta.url)),env,shell:false,windowsHide:true,encoding:'utf8',timeout:30000});
 assert.equal(r.status,0,r.stderr);const value=JSON.parse(r.stdout);assert.equal(value.status,'PASS');assert.equal(value.assertions,18);assert.equal(value.connections,0);assert.equal(value.secret_reads,0);
});
