import { randomBytes } from 'node:crypto';
import { FieldPath, Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { admin, db, auth, bucket, now, expiry, iso, conflict, type Request } from './runtime.js';
import { obj, text, id, integer, email, sha, parseRegistryCsv, classifyRegistry, type RegistryEntry, type RegistryRow } from './validation.js';

const CHUNK=100;
interface AccountFact {uid:string;admin:boolean;membershipReference:string|null;unlinkedAuthOnly?:boolean;identityConflict?:boolean}
interface AccountState {accounts:Map<string,AccountFact>;fingerprint:string;memberRefs:DocumentReference[];memberStamps:Record<string,string>;bindingRefs:DocumentReference[];bindingStamps:Record<string,string>}
interface PreviewPayload {rows:RegistryRow[];restoreSuspended:boolean;accountFingerprint:string;memberStamps:Record<string,string>;bindingStamps:Record<string,string>}
function memberStamp(data:Record<string,any>|undefined) {return sha(JSON.stringify(data?{email:data.email??null,status:data.status??null,membershipReference:data.membershipReference??null,registryKey:data.registryKey??null}:null));}
function bindingStamp(data:Record<string,any>|undefined) {return sha(JSON.stringify(data?{uid:data.uid??null,email:data.email??null,memberReference:data.memberReference??null}:null));}
async function accountState(rows:RegistryRow[]):Promise<AccountState> {
  const addresses=[...new Set(rows.map(row=>row.email).filter(value=>{try{return email(value)===value;}catch{return false;}}))].sort();
  const references=[...new Set(rows.map(row=>row.memberReference).filter(value=>!!value && value.length<=80 && !/[\u0000-\u001f\u007f]/u.test(value)))].sort();
  const accounts:AccountState['accounts']=new Map(),members=new Map<string,{ref:DocumentReference;data:Record<string,any>|undefined}>(),bindings=new Map<string,{ref:DocumentReference;data:Record<string,any>|undefined}>();
  const byEmail=new Map<string,{uid:string;data:Record<string,any>}[]>(),byReference=new Map<string,{uid:string;data:Record<string,any>}[]>();
  async function findProfiles(field:'email'|'membershipReference',values:string[],index:Map<string,{uid:string;data:Record<string,any>}[]>) {
    for(let offset=0;offset<values.length;offset+=30) {
      const snapshot=await db.collection('members').where(field,'in',values.slice(offset,offset+30)).limit(61).get();
      if(snapshot.size>60)throw new HttpsError('failed-precondition','Conflicting account records must be reconciled before import.');
      for(const row of snapshot.docs){const data=row.data(),value=data[field];members.set(row.id,{ref:row.ref,data});index.set(value,[...(index.get(value)??[]),{uid:row.id,data}]);}
    }
  }
  await Promise.all([findProfiles('email',addresses,byEmail),findProfiles('membershipReference',references,byReference)]);
  for(const matches of byEmail.values())if(matches.length>1)throw new HttpsError('failed-precondition','Duplicate account email records must be corrected before import.');
  const users=[];
  for(let offset=0;offset<addresses.length;offset+=100)users.push(...(await auth.getUsers(addresses.slice(offset,offset+100).map(address=>({email:address})))).users);
  const profilesByUid=new Map<string,Record<string,any>|undefined>(),staffIds=new Set<string>();
  for(let offset=0;offset<users.length;offset+=100) {
    const batch=users.slice(offset,offset+100);
    const [profiles,staff]=await Promise.all([
      db.getAll(...batch.map(user=>db.doc(`members/${user.uid}`))),db.getAll(...batch.map(user=>db.doc(`staff/${user.uid}`))),
    ]);
    for(const profile of profiles){const data=profile.data();profilesByUid.set(profile.id,data);members.set(profile.id,{ref:profile.ref,data});}
    for(const person of staff)if(person.exists)staffIds.add(person.id);
  }
  for(let offset=0;offset<references.length;offset+=100) {
    const snapshots=await db.getAll(...references.slice(offset,offset+100).map(reference=>db.doc(`registryBindings/${sha(reference)}`)));
    for(const binding of snapshots)bindings.set(binding.id,{ref:binding.ref,data:binding.data()});
  }
  const proposed=new Map(rows.map(row=>[row.email,row.memberReference])),userFacts:Record<string,unknown>[]=[];
  for(const user of users) {
    const address=user.email?.trim().toLowerCase();if(!address)continue;
    const reference=proposed.get(address)??'',profile=profilesByUid.get(user.uid),binding=bindings.get(sha(reference))?.data;
    const sameEmail=byEmail.get(address)??[],sameReference=byReference.get(reference)??[];
    const isAdmin=user.customClaims?.admin===true || staffIds.has(user.uid);
    const bindingConflict=!!binding && (binding.uid!==user.uid || binding.email!==address || binding.memberReference!==reference);
    const legacyConflict=[...sameEmail,...sameReference].some(candidate=>candidate.uid!==user.uid);
    const passwordIdentity=user.providerData.some(provider=>provider.providerId==='password');
    const unlinkedAuthOnly=!isAdmin && passwordIdentity && !profile && !sameEmail.length && !sameReference.length && !bindingConflict;
    const identityConflict=bindingConflict || legacyConflict || !!profile && profile.email!==address;
    accounts.set(address,{uid:user.uid,admin:isAdmin,membershipReference:profile?.email===address?profile.membershipReference??null:null,unlinkedAuthOnly,identityConflict});
    userFacts.push({uid:user.uid,email:address,emailVerified:user.emailVerified,disabled:user.disabled,admin:isAdmin,providers:user.providerData.map(provider=>provider.providerId).sort(),unlinkedAuthOnly,identityConflict});
  }
  // An orphaned/different-UID profile is not a genuine unlinked signup and cannot gain eligibility through this exception.
  for(const row of rows)if(!accounts.has(row.email)) {
    const profiles=[...(byEmail.get(row.email)??[]),...(byReference.get(row.memberReference)??[])],binding=bindings.get(sha(row.memberReference))?.data;
    if(profiles.length || binding && (binding.email!==row.email || binding.memberReference!==row.memberReference))accounts.set(row.email,{uid:profiles[0]?.uid??String(binding?.uid??''),admin:false,membershipReference:null,unlinkedAuthOnly:false,identityConflict:true});
  }
  const memberStamps=Object.fromEntries([...members].sort(([a],[b])=>a.localeCompare(b)).map(([uid,row])=>[uid,memberStamp(row.data)]));
  const bindingStamps=Object.fromEntries([...bindings].sort(([a],[b])=>a.localeCompare(b)).map(([key,row])=>[key,bindingStamp(row.data)]));
  return {accounts,fingerprint:sha(JSON.stringify({users:userFacts.sort((a,b)=>String(a.uid).localeCompare(String(b.uid))),memberStamps,bindingStamps})),memberRefs:[...members.values()].map(row=>row.ref),memberStamps,bindingRefs:[...bindings.values()].map(row=>row.ref),bindingStamps};
}
async function registryEntries(version:string|null):Promise<RegistryEntry[]> {
  if(!version)return [];
  const rows:RegistryEntry[]=[];let cursor:string|null=null;
  for(;;) {
    let query=db.collection(`memberRegistryVersions/${id(version)}/entries`).orderBy(FieldPath.documentId()).limit(250);
    if(cursor)query=query.startAfter(cursor);
    const snapshot=await query.get();
    for(const row of snapshot.docs)rows.push(row.data() as RegistryEntry);
    if(snapshot.size<250)break;
    cursor=snapshot.docs.at(-1)!.id;
  }
  return rows;
}
function summary(previewId:string, data:Record<string,any>, payload:PreviewPayload, offset=0) {
  const rows=payload.rows.slice(offset,offset+25);
  return {previewId,digest:data.digest,registryVersion:data.registryVersion,restoreSuspended:data.restoreSuspended===true,expiresAt:iso(data.expiresAt),state:data.state,...(['processing','confirmed'].includes(data.state)?{progress:result(previewId,data)}:{}),counts:data.counts,errors:payload.rows.flatMap(row=>row.errors.map(error=>`Row ${row.rowNumber}: ${error}`)).slice(0,100),rows:rows.map(({accessSuspended:_,...row})=>row),nextCursor:offset+rows.length<payload.rows.length?offset+rows.length:null};
}
export function registryPreviewDigest(rows:RegistryRow[],restoreSuspended:boolean):string {
  return sha(JSON.stringify({restoreSuspended,rows:rows.map(({errors:_,accessSuspended:__,...row})=>row)}));
}
async function readPayload(metadata:Record<string,any>):Promise<PreviewPayload> {
  const file=bucket().file(metadata.storagePath,{generation:metadata.storageGeneration});
  const [bytes]=await file.download();
  if(bytes.length>12*1024*1024 || sha(bytes.toString('utf8'))!==metadata.payloadDigest) throw new HttpsError('failed-precondition','The private preview did not match its stored digest. Upload the CSV again.');
  const payload=JSON.parse(bytes.toString('utf8')) as PreviewPayload;
  if(!Array.isArray(payload.rows) || payload.rows.length>5000 || !payload.memberStamps || !payload.bindingStamps || typeof payload.restoreSuspended!=='boolean' || payload.restoreSuspended!==metadata.restoreSuspended
    || registryPreviewDigest(payload.rows,payload.restoreSuspended)!==metadata.digest) throw new HttpsError('failed-precondition','The private preview intent did not match. Create a fresh preview.');
  return payload;
}
function result(previewId:string,data:Record<string,any>) {
  return {previewId,state:data.state==='confirmed'?'confirmed':'processing',phase:data.state==='confirmed'?'complete':data.phase,processed:(data.copied??0)+(data.applied??0),total:(data.baseCount??0)+(data.counts?.total??0),...(data.state==='confirmed'?{activeVersion:data.targetVersion}:{}),counts:data.counts};
}
function verifyConfirmation(metadata:Record<string,any>, actorUid:string,digest:string,version:number) {
  if(metadata.actorUid!==actorUid) throw new HttpsError('permission-denied','This preview belongs to another administrator.');
  if(metadata.digest!==digest || metadata.registryVersion!==version) throw new HttpsError('failed-precondition','Confirmation did not match the exact reviewed preview.');
}
export async function previewRegistryImportHandler(request:Request) {
  const actorUid=await admin(request), source=obj(request.data,['csv','restoreSuspended']);
  if(source.restoreSuspended!==undefined && typeof source.restoreSuspended!=='boolean')throw new HttpsError('invalid-argument','restoreSuspended must be an explicit boolean.');
  const restoreSuspended=source.restoreSuspended===true, rows=parseRegistryCsv(source.csv), stateRef=db.doc('registryState/current'), before=await stateRef.get();
  const baseVersion=typeof before.get('activeVersion')==='string'?before.get('activeVersion') as string:null, registryVersion=before.get('revision')??0;
  const [existing,accounts]=await Promise.all([registryEntries(baseVersion),accountState(rows)]), classification=classifyRegistry(rows,existing,accounts.accounts,restoreSuspended);
  const digest=registryPreviewDigest(rows,restoreSuspended), previewId=randomBytes(16).toString('hex'), expiresAt=expiry(15);
  const payload:PreviewPayload={rows,restoreSuspended,accountFingerprint:accounts.fingerprint,memberStamps:accounts.memberStamps,bindingStamps:accounts.bindingStamps}, serialized=JSON.stringify(payload), storagePath=`registryPreviews/${previewId}/preview.json`, file=bucket().file(storagePath);
  await file.save(serialized,{resumable:false,contentType:'application/json',preconditionOpts:{ifGenerationMatch:0},metadata:{cacheControl:'private, no-store'}});
  const [stored]=await file.getMetadata();
  const data={actorUid,restoreSuspended,state:classification.errors.length?'invalid':'ready',counts:classification.counts,digest,registryVersion,baseVersion,baseCount:existing.length,expiresAt,createdAt:now(),storagePath,storageGeneration:stored.generation,payloadDigest:sha(serialized)};
  try {
    await db.runTransaction(async transaction=>{
      await admin(request,transaction);
      const current=await transaction.get(stateRef);
      if((current.get('revision')??0)!==registryVersion || (current.get('activeVersion')??null)!==baseVersion) conflict();
      transaction.create(db.doc(`memberRegistryPreviews/${previewId}`),data);
    });
  } catch(error) {await file.delete({ignoreNotFound:true});throw error;}
  return summary(previewId,data,payload);
}
export async function getRegistryImportPreviewHandler(request:Request) {
  const actorUid=await admin(request), source=obj(request.data,['previewId','afterRow']), previewId=id(source.previewId), offset=source.afterRow===undefined?0:integer(source.afterRow);
  const metadata=(await db.doc(`memberRegistryPreviews/${previewId}`).get()).data();
  if(!metadata)throw new HttpsError('not-found','The private preview was not found.');
  if(metadata.actorUid!==actorUid)throw new HttpsError('permission-denied','This preview belongs to another administrator.');
  if(metadata.state!=='processing' && metadata.state!=='confirmed' && metadata.expiresAt.toMillis()<=Date.now())throw new HttpsError('failed-precondition','This preview expired. Upload the CSV again.');
  return summary(previewId,metadata,await readPayload(metadata),offset);
}
export async function confirmRegistryImportHandler(request:Request) {
  const actorUid=await admin(request), source=obj(request.data,['previewId','digest','registryVersion']), previewId=id(source.previewId), digest=text(source.digest,64,true), registryVersion=integer(source.registryVersion);
  if(!/^[a-f0-9]{64}$/u.test(digest))throw new HttpsError('invalid-argument','A valid preview digest is required.');
  const ref=db.doc(`memberRegistryPreviews/${previewId}`), stateRef=db.doc('registryState/current');
  let snapshot=await ref.get(), metadata=snapshot.data();
  if(!metadata)throw new HttpsError('not-found','The private preview was not found.');
  verifyConfirmation(metadata,actorUid,digest,registryVersion);
  if(metadata.state==='confirmed')return result(previewId,metadata);
  if(metadata.state==='invalid')throw new HttpsError('failed-precondition','Correct the invalid rows and upload a fresh CSV.');
  const payload=await readPayload(metadata);
  if(metadata.state==='ready') {
    if(metadata.expiresAt.toMillis()<=Date.now())throw new HttpsError('failed-precondition','This preview expired. Upload the CSV again.');
    const accounts=await accountState(payload.rows);
    if(accounts.fingerprint!==payload.accountFingerprint)throw new HttpsError('failed-precondition','Account pairing changed after this preview. Upload the CSV again.');
    const targetVersion=`registry_${previewId}`;
    await db.runTransaction(async transaction=>{
      await admin(request,transaction);
      const [fresh,state]=await transaction.getAll(ref,stateRef), data=fresh!.data()!;
      verifyConfirmation(data,actorUid,digest,registryVersion);
      if(data.state==='processing' || data.state==='confirmed')return;
      if(data.state!=='ready' || data.expiresAt.toMillis()<=Date.now())throw new HttpsError('failed-precondition','This preview expired or is not ready.');
      if((state!.get('revision')??0)!==registryVersion || (state!.get('activeVersion')??null)!==data.baseVersion)conflict();
      transaction.update(ref,{state:'processing',targetVersion,phase:data.baseVersion?'copy':'apply',cursor:null,copied:0,applied:0,step:0,startedAt:now(),resumeExpiresAt:expiry(24*60)});
      transaction.create(db.doc(`memberRegistryVersions/${targetVersion}`),{state:'staging',actorUid,previewId,baseVersion:data.baseVersion,baseRegistryVersion:registryVersion,restoreSuspended:data.restoreSuspended,restoredSuspensions:data.counts.restoredSuspensions,expectedCount:data.baseCount+data.counts.add,createdAt:now()});
    });
    snapshot=await ref.get();metadata=snapshot.data()!;
  }
  if(metadata.state==='confirmed')return result(previewId,metadata);
  if(metadata.state!=='processing' || !(metadata.resumeExpiresAt instanceof Timestamp) || metadata.resumeExpiresAt.toMillis()<=Date.now())throw new HttpsError('failed-precondition','This import can no longer resume. Nothing from its staged version is active.');
  const step=metadata.step, targetVersion=id(metadata.targetVersion), versionRef=db.doc(`memberRegistryVersions/${targetVersion}`);
  let phase=metadata.phase, cursor=metadata.cursor, copied=metadata.copied, applied=metadata.applied;
  const writes:{key:string;data:RegistryEntry}[]=[];
  if(phase==='copy') {
    let query=db.collection(`memberRegistryVersions/${id(metadata.baseVersion)}/entries`).orderBy(FieldPath.documentId()).limit(CHUNK);
    if(cursor)query=query.startAfter(cursor);
    const page=await query.get();
    for(const row of page.docs)writes.push({key:row.id,data:row.data() as RegistryEntry});
    copied+=page.size;cursor=page.docs.at(-1)?.id??cursor;
    if(page.size<CHUNK || copied===metadata.baseCount)phase='apply';
  } else if(phase==='apply') {
    const page=payload.rows.slice(applied,applied+CHUNK);
    for(const row of page)writes.push({key:sha(row.memberReference),data:{name:row.name,email:row.email,memberReference:row.memberReference,status:row.status,accessSuspended:row.accessSuspended===true}});
    applied+=page.length;
    if(applied===payload.rows.length)phase='activate';
  } else if(phase!=='activate')throw new HttpsError('failed-precondition','The import stage is invalid.');
  if(metadata.phase==='activate') {
    const accounts=await accountState(payload.rows);
    if(accounts.fingerprint!==payload.accountFingerprint)throw new HttpsError('failed-precondition','Account pairing changed while staging. Nothing from this staged version is active. Upload a new CSV.');
    return db.runTransaction(async transaction=>{
      await admin(request,transaction);
      const [fresh,state,version]=await transaction.getAll(ref,stateRef,versionRef), data=fresh!.data()!;
      verifyConfirmation(data,actorUid,digest,registryVersion);
      if(data.state==='confirmed')return result(previewId,data);
      if(data.step!==step)return result(previewId,data);
      if(data.state!=='processing' || data.phase!=='activate' || data.copied!==data.baseCount || data.applied!==payload.rows.length
        || !version!.exists || version!.get('state')!=='staging' || data.resumeExpiresAt.toMillis()<=Date.now())throw new HttpsError('failed-precondition','The staged version is incomplete or expired.');
      if((state!.get('revision')??0)!==registryVersion || (state!.get('activeVersion')??null)!==data.baseVersion)conflict();
      // Bind all existing relevant account security fields to this final transaction. Auth identities are rechecked immediately above.
      for(let offset=0;offset<accounts.memberRefs.length;offset+=100) {
        const members=await transaction.getAll(...accounts.memberRefs.slice(offset,offset+100));
        for(const account of members)if(memberStamp(account.data())!==payload.memberStamps[account.id])throw new HttpsError('failed-precondition','Account pairing changed while staging. Nothing from this staged version is active.');
      }
      for(let offset=0;offset<accounts.bindingRefs.length;offset+=100) {
        const bindings=await transaction.getAll(...accounts.bindingRefs.slice(offset,offset+100));
        for(const binding of bindings)if(bindingStamp(binding.data())!==payload.bindingStamps[binding.id])throw new HttpsError('failed-precondition','A membership binding changed while staging. Nothing from this staged version is active.');
      }
      const confirmedAt=now();
      transaction.set(stateRef,{activeVersion:targetVersion,revision:registryVersion+1,updatedAt:confirmedAt,updatedBy:actorUid});
      transaction.update(versionRef,{state:'active',entryCount:data.baseCount+data.counts.add,activatedAt:confirmedAt});
      transaction.update(ref,{state:'confirmed',phase:'complete',confirmedAt,step:step+1});
      return result(previewId,{...data,state:'confirmed',phase:'complete'});
    });
  }
  return db.runTransaction(async transaction=>{
    await admin(request,transaction);
    const [fresh,state]=await transaction.getAll(ref,stateRef), data=fresh!.data()!;
    verifyConfirmation(data,actorUid,digest,registryVersion);
    if(data.state==='confirmed' || data.step!==step)return result(previewId,data);
    if(data.state!=='processing' || data.resumeExpiresAt.toMillis()<=Date.now())throw new HttpsError('failed-precondition','The staging period expired. Nothing from this staged version is active.');
    if((state!.get('revision')??0)!==registryVersion || (state!.get('activeVersion')??null)!==data.baseVersion)conflict();
    for(const row of writes)transaction.set(db.doc(`memberRegistryVersions/${targetVersion}/entries/${row.key}`),row.data);
    const next={phase,cursor,copied,applied,step:step+1,updatedAt:now()};transaction.update(ref,next);
    return result(previewId,{...data,...next});
  });
}
export async function listRegistryHandler(request:Request) {
  await admin(request);const source=obj(request.data,['afterId']),after=source.afterId===undefined?null:id(source.afterId),state=await db.doc('registryState/current').get(),activeVersion=state.get('activeVersion');
  if(!activeVersion)return {items:[],nextCursor:null,activeVersion:null,revision:state.get('revision')??0};
  let query=db.collection(`memberRegistryVersions/${id(activeVersion)}/entries`).orderBy(FieldPath.documentId()).limit(25);if(after)query=query.startAfter(after);
  const page=await query.get();return {items:page.docs.map(row=>({id:row.id,...row.data()})),nextCursor:page.size===25?page.docs.at(-1)!.id:null,activeVersion,revision:state.get('revision')};
}




