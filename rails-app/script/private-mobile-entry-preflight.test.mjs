// Actual filesystem admission and fail-closed entry tests. No provider/browser/DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {inspectQueuedMobileEntryPreflight,assertQueuedMobileEntryPreflight,mobileEntryReadFile} from './private-mobile-entry-preflight.mjs';
import {PRIVATE_SOURCE_FILES,readPrivateAcceptance} from './private-acceptance-context.mjs';
import {RESOURCE_CATALOG,RESOURCE_SOURCES,QUEUED_MOBILE_MODE} from './virtual-mobile-resources.mjs';
const ROOT='D:/Projects/isp-member-rails',available=fs.existsSync(ROOT+'/'+RESOURCE_CATALOG.find(e=>e.path.startsWith('tmp/')).path);
const options={privateSourceFiles:PRIVATE_SOURCE_FILES};
test('whole actual offline entry enumerates every catalog/source and immutable binding pin',{skip:!available},()=>{
 const result=inspectQueuedMobileEntryPreflight(options);
 assert.equal(result.checked_files,271);assert.deepEqual(result.failures,[]);assert.equal(result.status,'PASS_OFFLINE_ENTRY_ADMISSION');
 assert.equal(assertQueuedMobileEntryPreflight(options).status,'PASS_OFFLINE_ENTRY_ADMISSION');
});
test('actual production admission catches every selected source, catalog, proof and test drift',{skip:!available},()=>{
 for(const target of [RESOURCE_CATALOG[0].path,RESOURCE_SOURCES[0].path,'script/virtual-mobile-acceptance.mjs','audit/private-acceptance/remaining-mobile-selector-matrix.json','audit/private-acceptance/remaining-mobile-selector-proof.json','audit/private-acceptance/queued6-next-selector-binding.json','script/virtual-mobile-selector-contracts.test.mjs','script/run-hosted-mobile-acceptance.mjs','cloudflare/acceptance/package-files.json']){
  const result=inspectQueuedMobileEntryPreflight({...options,readFile:name=>{const raw=mobileEntryReadFile(name);return name===ROOT+'/'+target?Buffer.concat([raw,Buffer.from(' drift')]):raw;}});
  assert.ok(result.failures.some(f=>f.check!=='source:script/virtual-mobile-journeys.mjs'),target);
 }
});
test('private controller invokes filesystem validator before runtime, fixture or journal access',{skip:!available},()=>{
 const reads=[],packet='D:/Projects/isp-rails-tools/isp-staging-private/private-acceptance/packet.json';
 assert.throws(()=>readPrivateAcceptance({readFile:name=>{reads.push(name);if(name===packet)return Buffer.from(JSON.stringify({execution_mode:QUEUED_MOBILE_MODE}));const raw=mobileEntryReadFile(name);return name===ROOT+'/script/virtual-mobile-journeys.mjs'?Buffer.concat([raw,Buffer.from(' drift')]):raw;}}),/Offline mobile entry admission failed/);
 assert.deepEqual(reads.filter(name=>name.includes('/isp-staging-private/')),[packet]);
});
test('source manifest closure refuses missing admission module and duplicate entries',{skip:!available},()=>{
 const manifest=JSON.parse(mobileEntryReadFile(ROOT+'/cloudflare/acceptance/package-files.json'));
 for(const changed of [manifest.filter(n=>n!=='script/private-mobile-entry-preflight.mjs'),[...manifest,manifest[0]]]){
  const result=inspectQueuedMobileEntryPreflight({...options,readFile:name=>name===ROOT+'/cloudflare/acceptance/package-files.json'?Buffer.from(JSON.stringify(changed)):mobileEntryReadFile(name)});
  assert.ok(result.failures.some(f=>f.check==='private_source_manifest_closure'));
 }
});
