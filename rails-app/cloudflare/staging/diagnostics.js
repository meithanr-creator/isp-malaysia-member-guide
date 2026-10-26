import {validUuid,className} from '../src/diagnostics.js';
export const DIAGNOSTIC_KEY='isp:staging:diagnostics:v1';
export const DIAGNOSTIC_LIMIT=16;
export const SEEN_KEY='isp:staging:diagnostic-admissions:v1';
export const ADMISSION_LIMIT=1024;
class DiagnosticStateError extends Error {}
const STAGES=new Set(['startup','application_readiness','backend_http','transport','lease']);
const OUTCOMES=new Set(['pending','failed','response']);
const FIELDS=['version','id','deadline','revision','stage','outcome','started_at','updated_at','elapsed_ms','dispatched','response_received','status','operation_id','exception_class'];
export function cleanTrace(value,deadline){
 if(!value||!validUuid(value.id)||!STAGES.has(value.stage)||!OUTCOMES.has(value.outcome)||
   !Number.isSafeInteger(value.revision)||value.revision<0||
   !Number.isSafeInteger(value.started_at)||value.started_at<0||
   !Number.isSafeInteger(value.updated_at)||value.updated_at<value.started_at||
   !Number.isSafeInteger(deadline)||deadline<=0||
   typeof value.dispatched!=='boolean'||typeof value.response_received!=='boolean')return null;
 const received=value.response_received;
 const status=received&&Number.isInteger(value.status)&&value.status>=100&&value.status<=599?value.status:null;
 if(received&&(!value.dispatched||status===null))return null;
 return {version:1,id:value.id,deadline,revision:value.revision,stage:value.stage,outcome:value.outcome,
   started_at:value.started_at,updated_at:value.updated_at,elapsed_ms:Math.min(600000,value.updated_at-value.started_at),
   dispatched:value.dispatched,response_received:received,status,
   operation_id:validUuid(value.operation_id)?value.operation_id:null,exception_class:className(value.exception_class)};
}
function checkedRows(stored){
 if(stored===undefined)return [];
 if(!Array.isArray(stored)||stored.length>DIAGNOSTIC_LIMIT)throw new DiagnosticStateError('Invalid diagnostic state');
 const seen=new Set();
 return stored.map(row=>{
   const clean=cleanTrace(row,row?.deadline);
   if(!clean||Object.keys(row).length!==FIELDS.length||!FIELDS.every(key=>Object.hasOwn(row,key)&&row[key]===clean[key])||seen.has(clean.id))throw new DiagnosticStateError('Invalid diagnostic state');
   seen.add(clean.id);return clean;
 });
}
export async function storeTrace(storage,trace,{admit=false,deadline}={}){
 const clean=cleanTrace(trace,deadline);if(!clean)return false;
 return storage.transaction(async txn=>{
   const stored=await txn.get(DIAGNOSTIC_KEY),rows=checkedRows(stored);
   const remembered=await txn.get(SEEN_KEY);
   if(remembered===undefined&&stored!==undefined)throw new DiagnosticStateError('Invalid diagnostic state');
   const seen=remembered??[];
   if(!Array.isArray(seen)||seen.length>ADMISSION_LIMIT||!seen.every(validUuid)||new Set(seen).size!==seen.length||rows.some(row=>!seen.includes(row.id)))throw new DiagnosticStateError('Invalid diagnostic state');
   const index=rows.findIndex(row=>row.id===clean.id);
   if(admit){
    if(seen.includes(clean.id)||seen.length>=ADMISSION_LIMIT)return false;
    await txn.put(SEEN_KEY,[...seen,clean.id]);
    await txn.put(DIAGNOSTIC_KEY,[...rows,clean].slice(-DIAGNOSTIC_LIMIT));return true;
   }
   if(index<0||rows[index].deadline!==deadline)return false;
   const previous=rows[index];if(clean.revision<=previous.revision)return true;
   clean.dispatched ||= previous.dispatched;
   if(previous.response_received){clean.response_received=true;clean.status=previous.status;clean.operation_id=previous.operation_id;clean.exception_class=previous.exception_class;}
   rows[index]=clean;await txn.put(DIAGNOSTIC_KEY,rows);return true;
 });
}
export async function readTrace(storage,id,deadline){
 if(!validUuid(id))return null;
 return checkedRows(await storage.get(DIAGNOSTIC_KEY)).find(row=>row.id===id&&row.deadline===deadline)||null;
}
