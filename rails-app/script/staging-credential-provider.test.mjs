import test from 'node:test';
import assert from 'node:assert/strict';
import {dirname} from 'node:path';
import {credentialProviderPath,STAGING_PROVIDER_PATH,STAGING_API_TOKEN_PATH,STAGING_OAUTH_PATH,validateCredentialProvider,parseOAuthCredential,parseApiCredential,validateVerifiedApiCredential,readStagingCredential} from './staging-credential-provider.mjs';
const NOW=Date.parse('2026-10-27T00:00:00Z'),EXPIRY='2026-10-27T01:00:00.000Z',TOKEN='synthetic_unit_token_never_a_real_credential_1234567890';
const options={now:NOW,requiredUntil:NOW+30*60000};
const oauth=(expiry=EXPIRY)=>`oauth_token = "${TOKEN}"\nexpiration_time = "${expiry}"\nrefresh_token = "ignored-never-returned"\n[unrelated]\noauth_token = "nested-ignored"\n`;
function fixture(kind='oauth',leaseId='rails-staging-2'){
 const reads=[],files=new Map([[credentialProviderPath(leaseId),JSON.stringify({version:1,kind})],[STAGING_OAUTH_PATH,oauth()],[STAGING_API_TOKEN_PATH,JSON.stringify({CLOUDFLARE_API_TOKEN:TOKEN,saved_at:'untrusted-local-metadata'})]]);
 const parents=new Set([...files.keys()].map(dirname));
 const io={lstatSync:path=>{
  if(!parents.has(path)&&!files.has(path))throw Error('Synthetic missing file');
  return {isDirectory:()=>parents.has(path),isFile:()=>files.has(path),isSymbolicLink:()=>false,size:files.has(path)?Buffer.byteLength(files.get(path)):0};
 },realpathSync:path=>path,readFileSync:path=>{reads.push(path);if(!files.has(path))throw Error('Synthetic missing file');return files.get(path);}};
 return {reads,files,io};
}

test('fixed selector accepts only exact version and original supported provider kind',()=>{
 assert.deepEqual(validateCredentialProvider({version:1,kind:'oauth'}),{version:1,kind:'oauth'});
 assert.deepEqual(validateCredentialProvider({version:1,kind:'api-token'}),{version:1,kind:'api-token'});
 for(const value of [null,[],{}, {kind:'oauth'},{version:2,kind:'oauth'}, {version:1,kind:'environment'},
  {version:1,kind:'oauth',path:'D:/another-project/token'}, {version:1,kind:'oauth',fallback:true}])assert.throws(()=>validateCredentialProvider(value));
});

test('OAuth strict top-level token and actual expiry survive without refresh token or scope changes',()=>{
 const parsed=parseOAuthCredential(oauth(),options);
 assert.deepEqual(parsed,{kind:'oauth',token:TOKEN,expires_at:EXPIRY,token_id:null});
 assert.equal(Object.isFrozen(parsed),true);assert.equal(JSON.stringify(parsed).includes('ignored-never-returned'),false);
 const literal=parseOAuthCredential(`oauth_token = '${TOKEN}' # token\nexpiration_time = '2026-10-27T01:00:00Z' # expiry\n`,options);
 assert.equal(literal.expires_at,EXPIRY);
});

test('OAuth missing nested-only duplicate malformed and expired metadata all fail generically',()=>{
 const invalid=[`oauth_token = "${TOKEN}"\n`,
  `oauth_token = "${TOKEN}"\n[table]\nexpiration_time = "${EXPIRY}"\n`,

  `oauth_token = "${TOKEN}"\noauth_token = malformed\nexpiration_time = "${EXPIRY}"\n`,
  `oauth_token = "${TOKEN}"\nexpiration_time = "${EXPIRY}"\nexpiration_time = broken\n`,
  oauth('2026-02-30T01:00:00Z'),oauth('2026-10-27T01:00:00+00:00'),oauth('2026-10-26T23:59:59Z')];

 for(const source of invalid)assert.throws(()=>parseOAuthCredential(source,options),error=>!error.message.includes(TOKEN)&&!error.message.includes('ignored-never-returned'));
 assert.throws(()=>parseOAuthCredential(oauth(),{now:NOW,requiredUntil:Date.parse(EXPIRY)}));
 assert.throws(()=>parseOAuthCredential(oauth(),{now:NOW,requiredUntil:Date.parse(EXPIRY)+1}));
});

test('API local capture returns no invented expiry or identity and rejects alternate source fields',()=>{
 assert.deepEqual(parseApiCredential({CLOUDFLARE_API_TOKEN:TOKEN,saved_at:'local-capture-only'}),{kind:'api-token',token:TOKEN,expires_at:null,token_id:null});
 for(const value of [null,{}, {CLOUDFLARE_API_TOKEN:'short'}, {CLOUDFLARE_API_TOKEN:TOKEN+' '},
  {CLOUDFLARE_API_TOKEN:TOKEN,expires_at:EXPIRY},{CLOUDFLARE_API_TOKEN:TOKEN,path:'another-project'}])assert.throws(()=>parseApiCredential(value));
});

test('actual API verification must be active current and valid through the required cleanup deadline',()=>{
 const credential=parseApiCredential({CLOUDFLARE_API_TOKEN:TOKEN});
 const verified={id:'1'.repeat(32),status:'active',expires_on:EXPIRY,not_before:'2026-10-26T23:00:00Z'};
 assert.deepEqual(validateVerifiedApiCredential(credential,verified,options),{...credential,expires_at:EXPIRY,token_id:'1'.repeat(32)});
 for(const changes of [{status:'expired'},{id:'other-project'}, {expires_on:null}, {expires_on:'2026-10-27T00:10:00Z'},
  {not_before:'2026-10-27T00:01:00Z'}, {expires_on:'2026-02-30T00:00:00Z'}])assert.throws(()=>validateVerifiedApiCredential(credential,{...verified,...changes},options));
 assert.throws(()=>validateVerifiedApiCredential({kind:'oauth',token:TOKEN},verified,options));
});

test('reader touches only selected fixed OAuth source and never reads the unused API key',()=>{
 const f=fixture('oauth');const value=readStagingCredential({...options,io:f.io});
 assert.equal(value.kind,'oauth');assert.deepEqual(f.reads,[STAGING_PROVIDER_PATH,STAGING_OAUTH_PATH]);
});

test('reader touches only selected original API capture and never reads OAuth source',()=>{
 const f=fixture('api-token');const value=readStagingCredential({...options,io:f.io});
 assert.equal(value.kind,'api-token');assert.equal(value.expires_at,null);
 assert.deepEqual(f.reads,[STAGING_PROVIDER_PATH,STAGING_API_TOKEN_PATH]);
});

test('missing invalid or redirected selector never falls back to any credential',()=>{
 for(const selector of [null,'not-json',JSON.stringify({version:1,kind:'other'}),JSON.stringify({version:1,kind:'oauth',fallback:true})]){
  const f=fixture();if(selector===null)f.files.delete(STAGING_PROVIDER_PATH);else f.files.set(STAGING_PROVIDER_PATH,selector);
  assert.throws(()=>readStagingCredential({...options,io:f.io}));
  assert.equal(f.reads.includes(STAGING_OAUTH_PATH),false);assert.equal(f.reads.includes(STAGING_API_TOKEN_PATH),false);
 }
 const f=fixture();f.io.realpathSync=path=>path===STAGING_PROVIDER_PATH?'D:/another-project/provider.json':path;
 assert.throws(()=>readStagingCredential({...options,io:f.io}));assert.deepEqual(f.reads,[]);
});

test('expired selected OAuth never falls back to a usable unrelated API credential',()=>{
 const f=fixture('oauth');f.files.set(STAGING_OAUTH_PATH,oauth('2026-10-26T23:59:59Z'));
 assert.throws(()=>readStagingCredential({...options,io:f.io}));
 assert.deepEqual(f.reads,[STAGING_PROVIDER_PATH,STAGING_OAUTH_PATH]);
});

test('selected credential symlinks redirected parents or oversized files are refused before secret read',()=>{
 for(const mode of ['symlink','parent','size']){
  const f=fixture('oauth'),original=f.io.lstatSync;
  f.io.lstatSync=path=>{const stat=original(path);if(path!==STAGING_OAUTH_PATH)return stat;
   return {...stat,isSymbolicLink:()=>mode==='symlink',size:mode==='size'?70000:stat.size};};
  if(mode==='parent')f.io.realpathSync=path=>path===dirname(STAGING_OAUTH_PATH)?'D:/another-project':path;
  assert.throws(()=>readStagingCredential({...options,io:f.io}));
  assert.deepEqual(f.reads,[STAGING_PROVIDER_PATH]);
 }
});

test('explicit lease3 uses only its fixed selector and never falls back to lease2',()=>{
 const selector=credentialProviderPath('rails-staging-3');assert.equal(credentialProviderPath(),STAGING_PROVIDER_PATH);assert.match(selector,/rails-staging-3\/provision-credential-provider.json$/);
 const f=fixture('api-token','rails-staging-3');assert.equal(readStagingCredential({...options,io:f.io,leaseId:'rails-staging-3'}).kind,'api-token');assert.deepEqual(f.reads,[selector,STAGING_API_TOKEN_PATH]);
 const missing=fixture('oauth','rails-staging-3');missing.files.delete(selector);missing.files.set(STAGING_PROVIDER_PATH,JSON.stringify({version:1,kind:'oauth'}));assert.throws(()=>readStagingCredential({...options,io:missing.io,leaseId:'rails-staging-3'}));assert.deepEqual(missing.reads,[]);
 for(const leaseId of ['legacy-1','../rails-staging-3','rails-staging-4']){const bad=fixture();assert.throws(()=>readStagingCredential({...options,io:bad.io,leaseId}));assert.deepEqual(bad.reads,[]);}
});
