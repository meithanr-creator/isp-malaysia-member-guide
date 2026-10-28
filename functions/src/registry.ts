import { randomBytes } from 'node:crypto';
import { FieldPath, Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { admin, db, auth, bucket, now, expiry, iso, conflict, type Request } from './runtime.js';
import { obj, text, id, integer, email, sha, parseRegistryCsv, classifyRegistry, type RegistryEntry, type RegistryRow } from './validation.js';

const CHUNK=100;
interface AccountState {accounts:Map<string,{uid:string;admin:boolean;membershipReference:string|null}>; fingerprint:string;memberRefs:DocumentReference[];memberStamps:Record<string,string>}
interface PreviewPayload {rows:RegistryRow[];accountFingerprint:string;memberStamps:Record<string,string>}
function memberStamp(data:Record<string,any>|undefined) {return sha(JSON.stringify(data?{email:data.email??null,status:data.status??null,membershipReference:data.membershipReference??null,registryKey:data.registryKey??null}:null));}
async function accountState(rows:RegistryRow[]):Promise<AccountState> {
  const addresses=[...new Set(rows.map(row=>row.email).filter(value=>{try{return email(value)===value;}catch{return false;}}))].sort();
  const accounts:AccountState['accounts']=new Map(), users:Record<string,unknown>[] = [], memberRefs:DocumentReference[]=[], memberStamps:Record<string,string>={};
  const memberByEmail=new Map<string,Record<string,any>>();
  for(let offset=0;offset<addresses.length;offset+=30) {
    const snapshot=await db.collection('members').where('email','in',addresses.slice(offset,offset+30)).get();
    for(const row of snapshot.docs) {
      const data=row.data();
      if(memberByEmail.has(data.email)) throw new HttpsError('failed-precondition','Duplicate account email records must be corrected before import.');
      memberByEmail.set(data.email,{uid:row.id,...data});memberRefs.push(row.ref);memberStamps[row.id]=memberStamp(data);
    }
  }
  for(let offset=0;offset<addresses.length;offset+=100) {
    const result=await auth.getUsers(addresses.slice(offset,offset+100).map(address=>({email:address})));
    const staff=result.users.length?await db.getAll(...result.users.map(user=>db.doc(`staff/${user.uid}`))):[];
    for(let index=0;index<result.users.length;index++) {
      const user=result.users[index]!, address=user.email?.toLowerCase();if(!address)continue;
      const member=memberByEmail.get(address), isAdmin=user.customClaims?.admin===true || staff[index]?.exists===true;
      accounts.set(address,{uid:user.uid,admin:isAdmin,membershipReference:member?.uid===user.uid?member.membershipReference??null:null});
      users.push({uid:user.uid,email:address,disabled:user.disabled,admin:isAdmin,membershipReference:member?.uid===user.uid?member.membershipReference??null:null});
    }
  }
  // A Firestore account without an Auth identity is also a pairing conflict, not a new account to activate.
  for(const [address,member] of memberByEmail) if(!accounts.has(address)) accounts.set(address,{uid:member.uid,admin:false,membershipReference:member.membershipReference??null});
  return {accounts,fingerprint:sha(JSON.stringify({users:users.sort((a,b)=>String(a.uid).localeCompare(String(b.uid))),memberStamps:Object.fromEntries(Object.entries(memberStamps).sort())})),memberRefs,memberStamps};
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
  return {previewId,digest:data.digest,registryVersion:data.registryVersion,expiresAt:iso(data.expiresAt),state:data.state,...(['processing','confirmed'].includes(data.state)?{progress:result(previewId,data)}:{}),counts:data.counts,errors:payload.rows.flatMap(row=>row.errors.map(error=>`Row ${row.rowNumber}: ${error}`)).slice(0,100),rows:rows.map(({accessSuspended:_,...row})=>row),nextCursor:offset+rows.length<payload.rows.length?offset+rows.length:null};
}
async function readPayload(metadata:Record<string,any>):Promise<PreviewPayload> {
  const file=bucket().file(metadata.storagePath,{generation:metadata.storageGeneration});
  const [bytes]=await file.download();
  if(bytes.length>12*1024*1024 || sha(bytes.toString('utf8'))!==metadata.payloadDigest) throw new HttpsError('failed-precondition','The private preview did not match its stored digest. Upload the CSV again.');
  const payload=JSON.parse(bytes.toString('utf8')) as PreviewPayload;
  if(!Array.isArray(payload.rows) || payload.rows.length>5000) throw new HttpsError('failed-precondition','The private preview is invalid.');
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
  const actorUid=await admin(request), source=obj(request.data,['csv']), rows=parseRegistryCsv(source.csv), stateRef=db.doc('registryState/current'), before=await stateRef.get();
  const baseVersion=typeof before.get('activeVersion')==='string'?before.get('activeVersion') as string:null, registryVersion=before.get('revision')??0;
  const [existing,accounts]=await Promise.all([registryEntries(baseVersion),accountState(rows)]), classification=classifyRegistry(rows,existing,accounts.accounts);
  const digest=sha(JSON.stringify(rows.map(({errors:_,accessSuspended:__,...row})=>row))), previewId=randomBytes(16).toString('hex'), expiresAt=expiry(15);
  const payload:PreviewPayload={rows,accountFingerprint:accounts.fingerprint,memberStamps:accounts.memberStamps}, serialized=JSON.stringify(payload), storagePath=`registryPreviews/${previewId}/preview.json`, file=bucket().file(storagePath);
  await file.save(serialized,{resumable:false,contentType:'application/json',preconditionOpts:{ifGenerationMatch:0},metadata:{cacheControl:'private, no-store'}});
  const [stored]=await file.getMetadata();
  const data={actorUid,state:classification.errors.length?'invalid':'ready',counts:classification.counts,digest,registryVersion,baseVersion,baseCount:existing.length,expiresAt,createdAt:now(),storagePath,storageGeneration:stored.generation,payloadDigest:sha(serialized)};
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
      transaction.create(db.doc(`memberRegistryVersions/${targetVersion}`),{state:'staging',actorUid,previewId,baseVersion:data.baseVersion,baseRegistryVersion:registryVersion,expectedCount:data.baseCount+data.counts.add,createdAt:now()});
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

