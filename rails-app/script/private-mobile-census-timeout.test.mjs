import test from 'node:test';
import assert from 'node:assert/strict';
import {observeCensus,cleanupObservation,CENSUS_LIMITS} from './private-mobile-cleanup.mjs';

const empty={complete:true,present:[],relevant:[]},targets={windows:[],linux:[],issues:[]};
const delayed=['-e','setTimeout(()=>process.stdout.write(JSON.stringify({complete:true,present:[],relevant:[]})),150)'];
test('local census timeout stays incomplete, while an adequately bounded observation proves full absence',()=>{
 const short=observeCensus(process.execPath,delayed,Date.now()+1000,{maxMs:40});
 assert.equal(short.complete,false);assert.equal(short.diagnostics.error_code,'ETIMEDOUT');assert.equal(short.diagnostics.outcome,'command_incomplete');
 assert.equal(cleanupObservation(targets,empty,short).status,'FAIL');
 const observed=observeCensus(process.execPath,delayed,Date.now()+2000,{maxMs:1000});
 assert.equal(observed.complete,true);assert.equal(observed.diagnostics.exit_code,0);assert.equal(observed.diagnostics.outcome,'observed');assert.equal(cleanupObservation(targets,empty,observed).status,'PASS');
 assert.equal(CENSUS_LIMITS.windows_ms,5000);assert.equal(CENSUS_LIMITS.linux_ms,20000);assert.equal(CENSUS_LIMITS.total_ms,30000);
});
test('outer deadline, malformed output and nonzero census exit preserve safe failure diagnostics',()=>{
 const expired=observeCensus(process.execPath,delayed,Date.now()-1,{maxMs:1000});assert.equal(expired.diagnostics.outcome,'deadline_reached');assert.equal(expired.complete,false);
 const outer=observeCensus(process.execPath,delayed,Date.now()+40,{maxMs:1000});assert.equal(outer.complete,false);assert.ok(outer.diagnostics.limit_ms<=40);
 const invalid=observeCensus(process.execPath,['-e','process.stdout.write("invalid")'],Date.now()+1000,{maxMs:1000});assert.equal(invalid.diagnostics.outcome,'invalid_json');assert.equal(invalid.diagnostics.parse_error_class,'SyntaxError');
 const failed=observeCensus(process.execPath,['-e','process.stderr.write("synthetic local error");process.exitCode=2'],Date.now()+1000,{maxMs:1000});assert.equal(failed.diagnostics.exit_code,2);assert.ok(failed.diagnostics.stderr_bytes>0);assert.equal(failed.complete,false);assert.equal(Object.hasOwn(failed.diagnostics,'stderr'),false);
 for(const observation of [expired,outer,invalid,failed])assert.equal(cleanupObservation(targets,empty,observation).status,'FAIL');
});
