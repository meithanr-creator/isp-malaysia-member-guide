import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SOURCE_PATHS, assertSourceClosure, assertSourcePath } from './source-closure.mjs';
import { retentionPlan } from './manifest.mjs';
const watchdogUrl = new URL('./watchdog.mjs', import.meta.url).href;
const root = fileURLToPath(new URL('../', import.meta.url));
test('watchdog hard-stops a stalled SDK promise without COMPLETE or lease release', () => {
  const code = 'import {startProcessWatchdog} from '+JSON.stringify(watchdogUrl)+'; startProcessWatchdog(()=> "auth-export",40); try {await new Promise(()=>{}); console.log("COMPLETE");} finally {console.log("lease-release");}';
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', code], { encoding:'utf8', timeout:3000 });
  assert.equal(child.status,124); assert.equal(child.signal,null); assert.equal(child.stdout,'');
  const result=JSON.parse(child.stderr.trim()); assert.equal(result.code,'JOB_DEADLINE_REACHED'); assert.equal(result.leaseRetained,true); assert.equal(result.jobSucceeded,false); assert.equal(result.remoteExportMayContinue,true);
});
test('completed work disarms watchdog and does not wait or exit as failure', () => {
  const code='import {startProcessWatchdog} from '+JSON.stringify(watchdogUrl)+'; const guard=startProcessWatchdog(()=>"finished",40); if(guard.remaining()<=0)throw Error("deadline"); guard.stop(); console.log("done");';
  const child=spawnSync(process.execPath,['--input-type=module','--eval',code],{encoding:'utf8',timeout:3000});
  assert.equal(child.status,0); assert.equal(child.stdout.trim(),'done'); assert.equal(child.stderr,'');
});
test('rebuild archive covers exact existing inputs and rejects private or missing files', async () => {
  assertSourceClosure(SOURCE_PATHS);
  for(const path of SOURCE_PATHS) assert.equal((await fs.stat(new URL('../'+path,import.meta.url))).isFile(),true,path);
  for(const required of ['index.html','tsconfig.json','functions/tsconfig.json','.firebaserc','storage-cors.json','public/backup-info.css','public/backup-connect.html','scanner/Dockerfile','scanner/requirements.txt','scanner/scanner.py','scanner/mirror.py','backup/watchdog.mjs']) assert.ok(SOURCE_PATHS.includes(required),required);
  assert.throws(()=>assertSourceClosure(SOURCE_PATHS.slice(1))); assert.throws(()=>assertSourceClosure([...SOURCE_PATHS,'audit/private/credentials.json']));
  for(const privatePath of ['.env','.env.production','.env.example','audit/drive-consent.json','scanner/local-credentials.json','functions/node_modules/x.js']) assert.throws(()=>assertSourcePath(privatePath));
  const ignore=await fs.readFile(new URL('./Dockerfile.dockerignore',import.meta.url),'utf8');
  const included=ignore.split(/\r?\n/).filter(line=>line.startsWith('!')&&!line.endsWith('/')).map(line=>line.slice(1)).sort();
  assert.deepEqual(included,[...SOURCE_PATHS].sort());
  const docker=await fs.readFile(new URL('./Dockerfile',import.meta.url),'utf8');
  for(const prefix of ['src/','public/','functions/','scanner/','infra/','backup/']) assert.ok(docker.includes(prefix+' /app/source/'+prefix),prefix);
  assert.match(docker,/COPY.*index.html tsconfig.json .firebaserc.*storage-cors.json/);
  const job=await fs.readFile(new URL('./job.mjs',import.meta.url),'utf8');
  assert.match(job,/assertSourcePath\(relative\)/); assert.match(job,/assertSourceClosure\(files.map/); assert.doesNotMatch(job,/Promise.race/);
  assert.ok(job.indexOf('startProcessWatchdog(() => currentPhase)')<job.indexOf("import('google-auth-library')"));
});
test('retention preserves 30 unique dates despite duplicate COMPLETE manifests', () => {
 const rows=Array.from({length:35},(_,i)=>({id:'day-'+i,appProperties:{kind:'manifest',status:'COMPLETE',date:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10)}}));
 rows.push(...Array.from({length:40},(_,i)=>({id:'duplicate-'+i,appProperties:{kind:'manifest',status:'COMPLETE',date:rows[34].appProperties.date}})));
 rows.push({id:'partial',appProperties:{kind:'manifest',status:'PARTIAL',date:'2027-01-01'}});
 const plan=retentionPlan(rows); assert.equal(plan.retainedDates.length,30); assert.equal(plan.manifestIdsToTrash.length,5); assert.equal(plan.manifestIdsToTrash.some(id=>id.startsWith('duplicate-')),false); assert.equal(plan.manifestIdsToTrash.includes('partial'),false); assert.deepEqual(plan.payloadIdsToDelete,[]);
 assert.throws(()=>retentionPlan([...rows,{id:'invalid',appProperties:{kind:'manifest',status:'COMPLETE',date:'2026-02-31'}}]));
});
