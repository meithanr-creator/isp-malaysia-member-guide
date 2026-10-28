import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url)),hash=value=>createHash('sha256').update(value).digest('hex');
const path=new URL('../audit/private-acceptance/remaining-mobile-selector-matrix.json',import.meta.url),raw=fs.readFileSync(path),matrix=JSON.parse(raw);
const currentSource=()=>Object.fromEntries(Object.keys(matrix.harness_source_sha256).map(name=>[name,hash(fs.readFileSync(root+name))]));

// Offline admission grants selector readiness only. It cannot grant a hosted
// business-case PASS, authorize a run or replace the independent director review.
function admitOfflineSelectors(value,source){
 assert.equal(value.status,'OFFLINE_SELECTOR_ADMISSION_PASS_BACKEND_PENDING');
 assert.equal(value.backend_acceptance_proved,false);
 assert.deepEqual(value.harness_source_sha256,source);
 assert.equal(value.static_inventory.status,'STATIC_TEMPLATE_VERIFIED');
 assert.equal(value.static_inventory.cases.length,17);
 assert.equal(value.rendered_pages.length,22);
 assert.equal(hash(JSON.stringify(value.compiled_assets)),value.compiled_asset_catalog_sha256);
 const pages=new Map(value.rendered_pages.map(p=>[p.id,p.served_sha256]));
 for(const engine of ['webkit','chromium']){
  const evidence=value.engines[engine];
  assert.equal(evidence.status,'ACTUAL_OFFLINE_ENGINE_VERIFIED');
  assert.deepEqual(evidence.errors,[]);assert.equal(evidence.external_attempts,0);assert.equal(evidence.browser_absent,true);
  assert.equal(evidence.rows.length,139);assert.equal(new Set(evidence.rows.map(r=>r.contract.id)).size,139);
  assert.equal(evidence.rows.filter(r=>r.contract.required).length,135);
  assert.equal(evidence.rows.filter(r=>!r.contract.required).length,4);
  for(const row of evidence.rows){
   assert.equal(row.status,'ACTUAL_OFFLINE_ENGINE_VERIFIED');
   assert.equal(row.count,row.contract.expected);
   assert.equal(row.descriptor_sha256,hash(JSON.stringify(row.contract)));
   assert.equal(row.page_sha256,pages.get(row.contract.page));
   assert.ok(Object.values(evidence.receipts).some(r=>r.sha256===row.receipt_sha256));
   if(row.contract.changed_contract)assert.ok(evidence.selector_negatives.some(n=>n.id===row.contract.id&&n.status==='PASS_NONUNIQUE_REFUSED'));
  }
  for(const id of ['ORIGINAL-SAME-URL-RACE','SAME-URL-FRESH-RENDER','DISCOVER-SAME-PATH-REDIRECT'])assert.ok(evidence.timing_results.some(r=>r.id===id&&['PASS','REPRODUCED'].includes(r.status)));
  for(const id of ['WRONG-FORM-INITIATION','PREVIEW-OR-MISSING-FINAL-RENDER','TRANSIENT-PRIVATE-DOM-BEFORE-REDIRECT','WRONG-FORM-TIMEOUT-CLEANUP'])assert.ok(evidence.timing_negatives.some(r=>r.id===id&&r.status.startsWith('PASS_')));
  for(const id of ['PREVIEW-OR-MISSING-FINAL-RENDER','WRONG-FORM-TIMEOUT-CLEANUP'])assert.ok(evidence.timing_negatives.some(r=>r.id===id&&r.listeners_clean===true));
 }
 return true;
}

test('closed remaining selector matrix admits only exact tested source and measured engine completion',()=>{
 assert.equal(hash(raw),'973b4520fc3aca4f58ba7c9dab669c08087c30c72243e539a9f1cf08a1197e38');
 assert.equal(admitOfflineSelectors(matrix,currentSource()),true);
 for(const [name,expected]of Object.entries(matrix.product_source_sha256))assert.equal(hash(fs.readFileSync(root+name)),expected,name);
 for(const asset of matrix.compiled_assets)if(fs.existsSync(root+asset.path))assert.equal(hash(fs.readFileSync(root+asset.path)),asset.sha256,asset.path);
 const journey=fs.readFileSync(root+'script/virtual-mobile-journeys.mjs','utf8'),privacy=journey.indexOf("'Back after logout cannot render private member DOM'");
 assert.ok(privacy>0&&privacy<journey.indexOf("await page.waitForURL(url=>url.pathname==='/login'||url.pathname==='/');",privacy));
});

test('offline admission refuses any missing or unresolved required selector',()=>{
 for(const engine of ['webkit','chromium'])for(const kind of ['missing','unresolved']){
  const changed=structuredClone(matrix),rows=changed.engines[engine].rows,index=rows.findIndex(r=>r.contract.required);
  if(kind==='missing')rows.splice(index,1);else rows[index].status='UNRESOLVED';
  assert.throws(()=>admitOfflineSelectors(changed,currentSource()),engine+' '+kind);
 }
});

test('offline admission refuses source drift, stale descriptors and foreign rendered bytes',()=>{
 const foreign={...currentSource(),'script/virtual-mobile-journeys.mjs':'0'.repeat(64)};assert.throws(()=>admitOfflineSelectors(matrix,foreign));
 for(const key of ['descriptor_sha256','page_sha256']){const changed=structuredClone(matrix);changed.engines.webkit.rows[0][key]='0'.repeat(64);assert.throws(()=>admitOfflineSelectors(changed,currentSource()));}
});

test('offline admission refuses engine errors, external attempts, cleanup gaps or a backend PASS claim',()=>{
 for(const mutate of [m=>m.engines.webkit.errors.push('Synthetic page error'),m=>m.engines.chromium.external_attempts=1,m=>m.engines.webkit.browser_absent=false,m=>m.engines.webkit.timing_negatives.find(n=>n.id==='WRONG-FORM-TIMEOUT-CLEANUP').listeners_clean=false,m=>m.backend_acceptance_proved=true]){const changed=structuredClone(matrix);mutate(changed);assert.throws(()=>admitOfflineSelectors(changed,currentSource()));}
});
