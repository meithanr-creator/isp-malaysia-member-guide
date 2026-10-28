import test from 'node:test';
import assert from 'node:assert/strict';
import {DIAGNOSTIC_KEY,SEEN_KEY,ADMISSION_LIMIT,storeTrace,readTrace} from './diagnostics.js';
const deadline=2000000;
const id=n=>`00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
const trace=(n,changes={})=>({id:id(n),revision:1,stage:'startup',outcome:'pending',started_at:1000,updated_at:1000,dispatched:false,response_received:false,status:null,operation_id:null,exception_class:null,...changes});
function storage(){
 const values=new Map();let tail=Promise.resolve();
 return {values,async get(key){return structuredClone(values.get(key));},transaction(callback){
  const run=tail.then(async()=>{const writes=new Map();
   const txn={async get(key){return structuredClone(writes.has(key)?writes.get(key):values.get(key));},async put(key,value){writes.set(key,structuredClone(value));}};
   const result=await callback(txn);for(const[key,value]of writes)values.set(key,value);return result;
  });tail=run.catch(()=>{});return run;
 }};
}
test('only16 detailed traces survive; evicted request IDs cannot be admitted again',async()=>{
 const s=storage();await Promise.all(Array.from({length:48},(_,i)=>storeTrace(s,trace(i+1),{admit:true,deadline})));
 assert.equal(s.values.get(DIAGNOSTIC_KEY).length,16);
 assert.deepEqual(s.values.get(DIAGNOSTIC_KEY).map(v=>v.id),Array.from({length:16},(_,i)=>id(i+33)));
 assert.equal(await readTrace(s,id(1),deadline),null);
 assert.equal(await storeTrace(s,trace(1,{revision:2,dispatched:true}),{deadline}),false);
 assert.equal(await storeTrace(s,trace(1),{admit:true,deadline}),false);
 assert.equal(s.values.get(SEEN_KEY).length,48);
 assert.equal(s.values.get(DIAGNOSTIC_KEY).length,16);
});
test('duplicates do not change prior trace; updates preserve dispatch and receipt',async()=>{
 const s=storage();await storeTrace(s,trace(1),{admit:true,deadline});
 assert.equal(await storeTrace(s,trace(1,{dispatched:true}),{admit:true,deadline}),false);
 assert.equal((await readTrace(s,id(1),deadline)).dispatched,false);
 await storeTrace(s,trace(1,{revision:3,stage:'backend_http',outcome:'response',dispatched:true,response_received:true,status:500,operation_id:id(9),exception_class:'UploadOperation::StorageFailure'}),{deadline});
 await storeTrace(s,trace(1,{revision:2}),{deadline});
 await storeTrace(s,trace(1,{revision:4,stage:'lease',outcome:'failed',exception_class:'Error'}),{deadline});
 const row=await readTrace(s,id(1),deadline);assert.equal(row.dispatched,true);assert.equal(row.response_received,true);assert.equal(row.status,500);assert.equal(row.operation_id,id(9));assert.equal(row.exception_class,'UploadOperation::StorageFailure');
 assert.equal(await readTrace(s,id(1),deadline+1),null);
});
test('new unrecognized fields are discarded; malformed persisted evidence is preserved and refused',async()=>{
 const s=storage(),secret='synthetic-private-query-and-body';
 await storeTrace(s,trace(1,{path:secret,headers:{authorization:secret},message:secret,operation_id:'bad',exception_class:secret}),{admit:true,deadline});
 assert.equal(JSON.stringify(s.values.get(DIAGNOSTIC_KEY)).includes(secret),false);
 const bad=s.values.get(DIAGNOSTIC_KEY);bad[0].message=secret;s.values.set(DIAGNOSTIC_KEY,bad);
 const before=structuredClone(bad);
 await assert.rejects(readTrace(s,id(1),deadline),/Invalid diagnostic state/);
 await assert.rejects(storeTrace(s,trace(2),{admit:true,deadline}),/Invalid diagnostic state/);
 assert.deepEqual(s.values.get(DIAGNOSTIC_KEY),before);
});
test('invalid identifiers, stages and impossible responses cannot be admitted',async()=>{
 const s=storage();
 for(const changes of [{id:id(1)+'\n'},{id:'bad'},{stage:'private query'},{outcome:'unknown'},
   {response_received:true,status:500,dispatched:false},{response_received:true,status:999,dispatched:true}]){
  assert.equal(await storeTrace(s,trace(1,changes),{admit:true,deadline}),false);
 }
 assert.equal(s.values.size,0);
});
test('oversized and duplicate stored rings fail closed without erasing evidence',async()=>{
 const s=storage();await storeTrace(s,trace(1),{admit:true,deadline});const row=await readTrace(s,id(1),deadline);
 for(const rows of [[row,row],Array.from({length:17},()=>row)]){
  s.values.set(DIAGNOSTIC_KEY,structuredClone(rows));
  await assert.rejects(readTrace(s,id(1),deadline),/Invalid diagnostic state/);
  assert.deepEqual(s.values.get(DIAGNOSTIC_KEY),rows);
 }
});

test('admission memory is bounded and invalid historical IDs fail closed',async()=>{
 const s=storage();s.values.set(SEEN_KEY,Array.from({length:ADMISSION_LIMIT},(_,i)=>id(i+1)));
 assert.equal(await storeTrace(s,trace(ADMISSION_LIMIT+1),{admit:true,deadline}),false);
 assert.equal(s.values.has(DIAGNOSTIC_KEY),false);
 s.values.set(SEEN_KEY,[id(1),id(1)]);
 await assert.rejects(storeTrace(s,trace(2),{admit:true,deadline}),/Invalid diagnostic state/);
 assert.deepEqual(s.values.get(SEEN_KEY),[id(1),id(1)]);
});