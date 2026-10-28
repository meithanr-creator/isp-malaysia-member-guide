import test from 'node:test';
import assert from 'node:assert/strict';
import {safeDiagnostic} from './hosted-acceptance.mjs';
import {cleanTrace} from '../cloudflare/staging/diagnostics.js';
const id='00000000-0000-4000-8000-000000000001',deadline=2000000;
const row=()=>cleanTrace({id,revision:3,stage:'transport',outcome:'failed',started_at:1000,updated_at:1200,
 dispatched:true,response_received:false,status:null,operation_id:null,exception_class:'TypeError'},deadline);
test('collector accepts only exact canonical correlated metadata',()=>{
 const value=row();assert.deepEqual(safeDiagnostic(value,id,deadline),value);
 assert.equal(safeDiagnostic(value,'00000000-0000-4000-8000-000000000002',deadline),null);
 assert.equal(safeDiagnostic(value,id,deadline+1),null);
 assert.equal(safeDiagnostic({...value,message:'synthetic private data'},id,deadline),null);
 assert.equal(safeDiagnostic({...value,exception_class:'private credentials'},id,deadline),null);
 assert.equal(safeDiagnostic({...value,response_received:true,status:999},id,deadline),null);
});
test('unknown response remains unknown and cannot imply mutation rollback',()=>{
 const value=safeDiagnostic(row(),id,deadline);
 assert.equal(value.dispatched,true);assert.equal(value.response_received,false);assert.equal(value.status,null);
 assert.equal(safeDiagnostic(null,id,deadline),null);
 assert.equal(safeDiagnostic({error:'unavailable'},id,deadline),null);
});
