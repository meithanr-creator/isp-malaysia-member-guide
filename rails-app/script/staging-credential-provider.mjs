// Fixed-path credential selection only. Importing never reads credentials or contacts a provider.
import {lstatSync,realpathSync,readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {OAUTH_PATH,PRIVATE_ROOT,parseOAuthToml} from './cloudflare-staging-ops.mjs';
import {LEASE2,LEASE3,leaseContext} from './staging-lease-context.mjs';
export const STAGING_PROVIDER_PATH='D:/Projects/isp-rails-tools/isp-staging-private/leases/rails-staging-2/provision-credential-provider.json';
export const STAGING_API_TOKEN_PATH=`${PRIVATE_ROOT}/deployment-token.json`;
export const STAGING_OAUTH_PATH=OAUTH_PATH;
const defaultIO={lstatSync,realpathSync,readFileSync};
const fail=()=>{throw Error('Staging credential provider unavailable or invalid; no fallback or refresh attempted.');};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const normalized=value=>resolve(value).replaceAll('\\','/').toLowerCase();
function canonicalExpiry(value) {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))return fail();
 const time=Date.parse(value),normalizedValue=value.replace(/(?:\.(\d{1,3}))?Z$/,(_,fraction)=>'.'+(fraction??'').padEnd(3,'0')+'Z');
 if(!Number.isFinite(time)||new Date(time).toISOString()!==normalizedValue)return fail();
 return new Date(time).toISOString();
}
function lifetime(expiresAt,{now=Date.now(),requiredUntil=now}={}) {
 if(!Number.isFinite(now)||!Number.isFinite(requiredUntil))return fail();
 const canonical=canonicalExpiry(expiresAt);
 if(Date.parse(canonical)<=Math.max(now,requiredUntil))return fail();
 return canonical;
}
export function validateCredentialProvider(value) {
 if(!object(value)||Object.keys(value).length!==2||value.version!==1||!['oauth','api-token'].includes(value.kind))return fail();
 return Object.freeze({version:1,kind:value.kind});
}
export function parseOAuthCredential(source,options={}) {
 try {
  const prefix=String(source).split(/^\s*\[/m,1)[0];
  if([...prefix.matchAll(/^\s*oauth_token\s*=/gm)].length!==1||[...prefix.matchAll(/^\s*expiration_time\s*=/gm)].length!==1)return fail();
  const token=parseOAuthToml(source);
  const matches=[...prefix.matchAll(/^\s*expiration_time\s*=\s*("(?:[^"\\\r\n]|\\.)*"|'[^'\r\n]*')\s*(?:#.*)?$/gm)];
  if(matches.length!==1)return fail();
  const quoted=matches[0][1],expiry=quoted[0]==='"'?JSON.parse(quoted):quoted.slice(1,-1);
  return Object.freeze({kind:'oauth',token,expires_at:lifetime(expiry,options),token_id:null});
 }catch{return fail();}
}
export function parseApiCredential(value) {
 if(!object(value)||!Object.keys(value).every(key=>['CLOUDFLARE_API_TOKEN','saved_at'].includes(key))||
  typeof value.CLOUDFLARE_API_TOKEN!=='string'||!/^[A-Za-z0-9._~+/-]{32,4096}={0,2}$/.test(value.CLOUDFLARE_API_TOKEN))return fail();
 // Local capture metadata never establishes provider expiry or token identity.
 return Object.freeze({kind:'api-token',token:value.CLOUDFLARE_API_TOKEN,expires_at:null,token_id:null});
}
export function validateVerifiedApiCredential(credential,verification,options={}) {
 if(!object(credential)||credential.kind!=='api-token'||typeof credential.token!=='string'||
  !object(verification)||verification.status!=='active'||!/^[a-f0-9]{32}$/i.test(verification.id??''))return fail();
 const now=options.now??Date.now();
 if(verification.not_before!=null&&Date.parse(canonicalExpiry(verification.not_before))>now)return fail();
 return Object.freeze({...credential,expires_at:lifetime(verification.expires_on,{...options,now}),token_id:verification.id});
}
function readFixed(path,io,maximum) {
 try {
  const parent=dirname(path),parentStat=io.lstatSync(parent),stat=io.lstatSync(path);
  if(!parentStat.isDirectory()||parentStat.isSymbolicLink()||!stat.isFile()||stat.isSymbolicLink()||
   !Number.isSafeInteger(stat.size)||stat.size<1||stat.size>maximum||
   normalized(io.realpathSync(parent))!==normalized(parent)||normalized(io.realpathSync(path))!==normalized(path))return fail();
  return io.readFileSync(path,'utf8');
 }catch{return fail();}
}
export function credentialProviderPath(leaseId=LEASE2){if(leaseId!==LEASE2&&leaseId!==LEASE3)return fail();return leaseContext(leaseId).credentialSelector;}
export function readStagingCredential({now=Date.now(),requiredUntil=now,io=defaultIO,leaseId=LEASE2}={}) {
 try {
  const selected=validateCredentialProvider(JSON.parse(readFixed(credentialProviderPath(leaseId),io,4096).replace(/^\uFEFF/,'')));
  if(selected.kind==='oauth')return parseOAuthCredential(readFixed(STAGING_OAUTH_PATH,io,65536),{now,requiredUntil});
  return parseApiCredential(JSON.parse(readFixed(STAGING_API_TOKEN_PATH,io,16384).replace(/^\uFEFF/,'')));
 }catch{return fail();}
}
