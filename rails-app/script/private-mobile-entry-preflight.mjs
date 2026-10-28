// Filesystem-only whole-entry admission. No provider, database, browser or writes.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {RESOURCE_CATALOG,IMAGE_RESOURCE_CATALOG,RESOURCE_SOURCES,RESOURCE_MODEL_SOURCES,RESOURCE_SOURCES_SHA256,RESOURCE_SOURCE_REFRESH,MOBILE_RESOURCE_MODEL,RESOURCE_MODEL_SHA256,PROFILE_RESOURCE_DEMAND,GLOBAL_RESOURCE_DEMAND,QUEUED_MOBILE_LIMITS} from './virtual-mobile-resources.mjs';
import {assertQueuedNextSelectorBinding} from './private-acceptance-mobile.mjs';
const ROOT='D:/Projects/isp-member-rails',sha=value=>createHash('sha256').update(value).digest('hex');
const local=file=>process.platform==='linux'?file.replace(/^D:\//,'/mnt/d/'):file;
export function mobileEntryReadFile(file){
 if(!file.startsWith(ROOT+'/')||file.slice(ROOT.length+1).split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Fixed entry-admission source path required');
 const target=local(file);for(let cursor=target;;cursor=path.dirname(cursor)){if(fs.lstatSync(cursor).isSymbolicLink())throw Error('Redirected entry-admission source refused');if(path.dirname(cursor)===cursor)break;}
 if(fs.realpathSync(target).replaceAll('\\','/').toLowerCase()!==target.toLowerCase()||!fs.statSync(target).isFile())throw Error('Fixed entry-admission file required');
 return fs.readFileSync(target);
}
export function inspectQueuedMobileEntryPreflight({readFile=mobileEntryReadFile,privateSourceFiles}={}){
 const failures=[],reads=new Map(),read=name=>{const raw=readFile(ROOT+'/'+name);reads.set(name,sha(raw));return raw;};
 const check=(name,run)=>{try{if(run()===false)throw Error(name);}catch(error){failures.push({check:name,error:String(error.message||error)});}};
 const m=MOBILE_RESOURCE_MODEL;
 check('sealed_demand_model',()=>RESOURCE_MODEL_SHA256==='2095aa8abf725ef2349a49ff89b7e934aeaf891cd8808f397d0dd50cd5248e85'&&sha(JSON.stringify(m))===RESOURCE_MODEL_SHA256);
 check('resource_catalog_tuple',()=>RESOURCE_CATALOG.length===m.static_files&&RESOURCE_CATALOG.reduce((n,e)=>n+e.bytes,0)===m.static_bytes&&sha(JSON.stringify(RESOURCE_CATALOG))===m.catalog_sha256);
 check('resource_source_tuple',()=>sha(JSON.stringify(RESOURCE_MODEL_SOURCES))===m.source_sha256&&sha(JSON.stringify(RESOURCE_SOURCES))===RESOURCE_SOURCES_SHA256&&RESOURCE_SOURCES_SHA256==='70fac42f94c8eb6a234753db678e0708dc7fce5b5eec1674d758b60183e23cff'&&RESOURCE_SOURCE_REFRESH.path==='script/virtual-mobile-journeys.mjs'&&RESOURCE_SOURCE_REFRESH.model_sha256==='0f273c84fb9a41c45643dbec13f0ae3944285bfdd6eee273ca6739c2dd5df787'&&RESOURCE_SOURCE_REFRESH.current_sha256==='e0b66d8a5d30f0ad012560b10a4798a84ed8745862f9583ac3b65621a384e4d1'&&RESOURCE_SOURCES.length===RESOURCE_MODEL_SOURCES.length&&RESOURCE_SOURCES.every((entry,i)=>JSON.stringify(entry)===JSON.stringify(RESOURCE_MODEL_SOURCES[i].path===RESOURCE_SOURCE_REFRESH.path?{...RESOURCE_MODEL_SOURCES[i],sha256:RESOURCE_SOURCE_REFRESH.current_sha256}:RESOURCE_MODEL_SOURCES[i])));
 check('image_catalog_tuple',()=>sha(JSON.stringify(IMAGE_RESOURCE_CATALOG))===m.image_catalog_sha256&&IMAGE_RESOURCE_CATALOG.every(image=>{const name=image.path.startsWith('public/assets/')?'tmp/neon-build/assets/'+image.path.slice(14):image.path,bound=RESOURCE_CATALOG.find(entry=>entry.path===name);return bound&&bound.bytes>=image.bytes;}));
 check('unchanged_request_and_transfer_model',()=>m.documents_per_profile===46&&m.cases.reduce((n,c)=>n+c.documents,0)===46&&PROFILE_RESOURCE_DEMAND.requests===9290&&PROFILE_RESOURCE_DEMAND.bytes===1881286352&&GLOBAL_RESOURCE_DEMAND.requests===21678&&GLOBAL_RESOURCE_DEMAND.bytes===3910684064&&QUEUED_MOBILE_LIMITS.profile_requests===10240&&QUEUED_MOBILE_LIMITS.gateway_requests===22000&&QUEUED_MOBILE_LIMITS.bytes===4294967296);
 for(const [kind,entries]of [['catalog',RESOURCE_CATALOG],['source',RESOURCE_SOURCES]])for(const entry of entries)check(kind+':'+entry.path,()=>{const raw=read(entry.path);return sha(raw)===entry.sha256&&(kind!=='catalog'||raw.length===entry.bytes);});
 check('frozen_selector_matrix_proof_binding_and_current_test',()=>assertQueuedNextSelectorBinding(file=>{if(!file.startsWith(ROOT+'/'))throw Error('Foreign selector dependency');return read(file.slice(ROOT.length+1));}));
 check('actual_unchanged_engine_preflight',()=>{const bound=JSON.parse(read('audit/private-acceptance/corrected-engine-preflight-bound.json'));return bound.status==='PASS'&&bound.proof?.status==='PASS'&&bound.proof.application_requests===0&&bound.proof.windows?.browser_absent===true&&bound.proof.linux?.browser_absent===true&&Object.keys(bound.source_sha256).sort().join(',')==='script/offline-browser-preflight.mjs,script/run-hosted-mobile-acceptance.mjs'&&Object.entries(bound.source_sha256).every(([name,digest])=>sha(read(name))===digest);});
 check('private_source_manifest_closure',()=>{const manifest=JSON.parse(read('cloudflare/acceptance/package-files.json'));if(!Array.isArray(privateSourceFiles)||JSON.stringify(manifest.slice().sort())!==JSON.stringify(privateSourceFiles.slice().sort())||new Set(manifest).size!==manifest.length||!manifest.includes('script/private-mobile-entry-preflight.mjs'))return false;for(const name of manifest)read(name);return true;});
 return {version:1,status:failures.length?'FAIL_OFFLINE_ENTRY_ADMISSION':'PASS_OFFLINE_ENTRY_ADMISSION',failures,checked_files:reads.size,source_sha256:Object.fromEntries([...reads].sort(([a],[b])=>a.localeCompare(b))),resource_model_sha256:RESOURCE_MODEL_SHA256,documents_per_profile:46,profile_demand:PROFILE_RESOURCE_DEMAND,global_demand:GLOBAL_RESOURCE_DEMAND,provider_requests:0,database_requests:0,browser_requests:0,filesystem_writes:0};
}
export function assertQueuedMobileEntryPreflight(options){const report=inspectQueuedMobileEntryPreflight(options);if(report.failures.length)throw Error('Offline mobile entry admission failed: '+report.failures.map(f=>f.check+' ('+f.error+')').join('; '));return report;}
