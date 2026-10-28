// Immutable observation byte identity; no filesystem or network access.
import {createHash} from 'node:crypto';
export function immutableObservationProof(raw,retainedRaw){
 if(!(raw instanceof Uint8Array)||raw.byteLength<1||raw.byteLength>16777216)throw Error('Bounded raw observation bytes required');
 const source=Buffer.from(raw);
 if(retainedRaw!==undefined&&(!(retainedRaw instanceof Uint8Array)||!source.equals(Buffer.from(retainedRaw))))throw Error('Immutable observation proof differs; preserve the original capture');
 const retained=retainedRaw===undefined?source:Buffer.from(retainedRaw);
 return {sha256:createHash('sha256').update(retained).digest('hex'),length:retained.length};
}

export function reconcileObservationCases({state,raw,inventory,seal,rulesMatch,leaseId,now=Date.now()}){
 if(state.lease_id!==leaseId)throw Error('Checkpoint lease identity mismatch');
 immutableObservationProof(raw);
 const observation=JSON.parse(Buffer.from(raw).toString('utf8').replace(/^\uFEFF/,''));
 const captured=Date.parse(observation.captured_at);
 if(observation.version!==1||observation.lease_id!==leaseId||observation.run_marker!==state.run_marker||JSON.stringify(observation.target)!==JSON.stringify(state.target)||!Number.isFinite(captured)||captured>now+5000)return 0;
 let changed=0;
 for(const entry of Object.values(state.cases)){
  if(entry.http!=='PASS'||entry.status!=='BLOCKED'||!entry.db?.length)continue;
  const cutoff=Date.parse(entry.observed_after);if(!Number.isFinite(cutoff)||captured<cutoff)continue;
  const batch=inventory[entry.id]?.[0];if(!/^[a-z-]+$/.test(batch||''))throw Error('Exact case batch required');
  const matched=rulesMatch(observation,entry.db);
  // Seal and read back the SAME bytes before changing any case disposition.
  const proof=seal(entry.id,batch,raw),expected=immutableObservationProof(raw);
  if(proof.sha256!==expected.sha256||proof.length!==expected.length||typeof proof.file!=='string')throw Error('Retained observation identity mismatch');
  entry.status=matched?'PASS':'FAIL';entry.db_observed_at=observation.captured_at;entry.observation_sha256=proof.sha256;entry.observation_file=proof.file;
  entry.reason=matched?undefined:'Independent persisted-state assertion failed';
  entry.assertions.push(matched?'Fresh independent persisted-state assertions matched':'Fresh independent persisted-state assertions failed');changed++;
 }
 return changed;
}