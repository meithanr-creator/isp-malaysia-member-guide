// Prepare only private bindings; never arm the runtime window or enable traffic.
import fs from 'node:fs';
import {parseEnv} from 'node:util';
import {verifiedNeonUrl,PRIVATE_ROOT,PROJECT_ROOT} from './cloudflare-staging-ops.mjs';
const read=name=>JSON.parse(fs.readFileSync(PRIVATE_ROOT+'/'+name,'utf8'));
try {
 const generated=read('runtime.json'),r2=read('r2.json');
 if(generated.ISP_STAGING_START_AT||generated.ISP_STAGING_EXPIRES_AT)throw Error('Already armed');
 const values={};
 for(const key of ['SECRET_KEY_BASE','ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY','ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY','ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT','ISP_STAGING_KEY']){
  if(!new RegExp('^[a-f0-9]{'+(key==='SECRET_KEY_BASE'?128:64)+'}$').test(generated[key]||''))throw Error('Key shape');values[key]=generated[key];
 }
 if(new Set(Object.values(values)).size!==5||r2.STORAGE_BUCKET!=='isp-staging-private'||!/^\w{16,256}$/.test(r2.AWS_ACCESS_KEY_ID||'')||!/^\w{32,256}$/.test(r2.AWS_SECRET_ACCESS_KEY||''))throw Error('Storage/key shape');
 const local=parseEnv(fs.readFileSync(PROJECT_ROOT+'/.env.local','utf8'));
 Object.assign(values,{DATABASE_URL:verifiedNeonUrl(local),STORAGE_BUCKET:'isp-staging-private',AWS_REGION:'auto',AWS_ACCESS_KEY_ID:r2.AWS_ACCESS_KEY_ID,AWS_SECRET_ACCESS_KEY:r2.AWS_SECRET_ACCESS_KEY,STORAGE_ENDPOINT:'https://a9720867333b64a4f8ee70cdfd673eb9.r2.cloudflarestorage.com',STORAGE_FORCE_PATH_STYLE:'true',MAIL_FROM:'staging@planterapp.co'});
 fs.writeFileSync(PRIVATE_ROOT+'/worker-secrets.json',JSON.stringify(values,null,2),{mode:0o600});
 console.log(JSON.stringify({prepared:true,key_count:Object.keys(values).length,timestamps_armed:false,activation:false}));
}catch{console.error('Private staging bindings could not be prepared; no credentials displayed.');process.exitCode=1;}
