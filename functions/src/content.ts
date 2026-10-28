import { randomBytes, createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { FieldPath, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { admin, member, verified, db, bucket, now, expiry, collections, conflict, iso, draftRecord, exportJson, type Request } from './runtime.js';
import { obj, text, id, cursorId, integer, kind, sha, normalizeContent, attachmentIds, uploadLimit, email, TOPICS, type Kind, type ContentData } from './validation.js';

function parent(type:Kind, recordId:string) { if (type === 'discover' && !['1','2','3'].includes(recordId)) throw new HttpsError('invalid-argument','Discover has exactly three fixed positions.'); return db.doc(`${collections(type).draft}/${recordId}`); }
export function cleanAttachment(data:Record<string,any>): boolean {
  return data.finalizedAt instanceof Timestamp && data.scanStatus === 'clean' && typeof data.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(data.sha256)
    && typeof data.generation === 'string' && data.scan?.generation === data.generation && data.scan?.sha256 === data.sha256
    && typeof data.scan?.scannerId === 'string' && !!data.scan.scannerId && data.scan?.scannedAt instanceof Timestamp;
}
async function files(transaction:Transaction, type:Kind, recordId:string, data:ContentData, requireClean=false) {
  const refs = attachmentIds(type,data);
  const snapshots = refs.length ? await transaction.getAll(...refs.map(file=>db.doc(`contentAttachments/${file.id}`))) : [];
  return refs.map((file,index) => {
    const snapshot = snapshots[index]!, metadata = snapshot.data();
    if (!metadata || metadata.kind !== type || metadata.parentId !== recordId || metadata.role !== file.role) throw new HttpsError('failed-precondition','An attachment is missing or belongs to another draft.');
    uploadLimit(type,file.role,metadata.contentType);
    if (requireClean && !cleanAttachment(metadata)) throw new HttpsError('failed-precondition','An attachment is still awaiting its trusted safety scan. Publishing is blocked.');
    return {id:file.id,metadata,ref:snapshot.ref,clean:cleanAttachment(metadata)};
  });
}
export async function saveContentDraftHandler(request:Request) {
  const source = obj(request.data,['kind','id','expectedRevision','data']), type = kind(source.kind);
  const recordId = source.id === undefined ? randomBytes(8).toString('hex') : id(source.id);
  const expectedRevision = integer(source.expectedRevision), data = normalizeContent(type,source.data), ref = parent(type,recordId);
  return db.runTransaction(async transaction => {
    const actorUid = await admin(request,transaction), snapshot = await transaction.get(ref);
    const revision = snapshot.exists ? snapshot.get('revision') : 0;
    if (revision !== expectedRevision || !snapshot.exists && expectedRevision !== 0) conflict();
    await files(transaction,type,recordId,data);
    const nextRevision = revision + 1;
    transaction.set(ref,{data,revision:nextRevision,preview:null,updatedBy:actorUid,updatedAt:now(),...(!snapshot.exists ? {createdAt:now(),createdBy:actorUid,publishedRevision:null,publishedAt:null} : {})},{merge:true});
    return {id:recordId,revision:nextRevision};
  });
}
export async function previewContentDraftHandler(request:Request) {
  const source = obj(request.data,['kind','id','expectedRevision']), type = kind(source.kind), recordId=id(source.id), ref=parent(type,recordId), expectedRevision=integer(source.expectedRevision);
  const previewToken = randomBytes(32).toString('hex'), expiresAt=expiry(15);
  return db.runTransaction(async transaction=>{
    const actorUid=await admin(request,transaction), snapshot=await transaction.get(ref);
    if (!snapshot.exists || snapshot.get('revision') !== expectedRevision) conflict();
    const data=normalizeContent(type,snapshot.get('data'),true), attachments=await files(transaction,type,recordId,data);
    const attachmentStatus = attachments.every(file=>file.clean) ? 'clean' : 'pending';
    const bindings=attachments.map(file=>({id:file.id,generation:file.metadata.generation??null,sha256:file.metadata.sha256??null}));
    transaction.update(ref,{preview:{actorUid,revision:expectedRevision,digest:sha(JSON.stringify(data)),tokenHash:sha(previewToken),expiresAt,bindings},updatedAt:now()});
    return {id:recordId,revision:expectedRevision,data,attachmentStatus,previewToken,previewExpiresAt:iso(expiresAt)};
  });
}
export async function publishContentDraftHandler(request:Request) {
  const source=obj(request.data,['kind','id','expectedRevision','expectedPreviewToken']), type=kind(source.kind), recordId=id(source.id), expectedRevision=integer(source.expectedRevision);
  const token=text(source.expectedPreviewToken,64,true);
  if (!/^[a-f0-9]{64}$/u.test(token)) throw new HttpsError('invalid-argument','A valid preview receipt is required.');
  const ref=parent(type,recordId);
  return db.runTransaction(async transaction=>{
    const actorUid=await admin(request,transaction), snapshot=await transaction.get(ref), preview=snapshot.get('preview');
    if (!snapshot.exists || snapshot.get('revision')!==expectedRevision || !preview || preview.actorUid!==actorUid || preview.revision!==expectedRevision
      || preview.tokenHash!==sha(token) || !(preview.expiresAt instanceof Timestamp) || preview.expiresAt.toMillis()<=Date.now()) conflict();
    const data=normalizeContent(type,snapshot.get('data'),true);
    if (preview.digest!==sha(JSON.stringify(data))) conflict();
    const attachments=await files(transaction,type,recordId,data,true);
    const bindings=attachments.map(file=>({id:file.id,generation:file.metadata.generation??null,sha256:file.metadata.sha256??null}));
    if (JSON.stringify(bindings)!==JSON.stringify(preview.bindings)) conflict();
    const publishedAt=now();
    transaction.set(db.doc(`${collections(type).published}/${recordId}`),{revision:expectedRevision,data,publishedAt});
    transaction.update(ref,{preview:null,publishedRevision:expectedRevision,publishedAt,updatedAt:publishedAt,updatedBy:actorUid});
    for (const file of attachments) transaction.update(file.ref,{visibility:type==='publication'?'member':'public',publishedKind:type,publishedId:recordId,publishedRevision:expectedRevision});
    return {id:recordId,revision:expectedRevision,publishedAt:iso(publishedAt)};
  });
}
export async function listContentDraftsHandler(request:Request) {
  await admin(request);
  const source=obj(request.data,['kind','afterId']), type=kind(source.kind), after=source.afterId===undefined?null:cursorId(source.afterId);
  let query=db.collection(collections(type).draft).orderBy(FieldPath.documentId()).limit(25);
  if (after) query=query.startAfter(after);
  const snapshot=await query.get();
  return {items:snapshot.docs.map(draftRecord),nextCursor:snapshot.size===25?snapshot.docs.at(-1)!.id:null};
}
export async function prepareContentUploadHandler(request:Request) {
  const actorUid=await admin(request), source=obj(request.data,['kind','id','role','name','mimeType','size']), type=kind(source.kind), recordId=id(source.id);
  parent(type,recordId);
  const role=text(source.role,20,true), contentType=text(source.mimeType,80,true), size=integer(source.size), limit=uploadLimit(type,role,contentType);
  if (size<1 || size>limit) throw new HttpsError('invalid-argument','This attachment exceeds the permitted size.');
  const fileName=text(source.name,180,true,true);
  if (/[\\/]/u.test(fileName)) throw new HttpsError('invalid-argument','The file name must not contain a path.');
  const attachmentId=randomBytes(16).toString('hex'), storagePath=`contentUploads/${type}/${recordId}/${attachmentId}`, expiresAt=expiry(15);
  await db.doc(`contentAttachments/${attachmentId}`).create({kind:type,parentId:recordId,role,ownerUid:actorUid,bucket:bucket().name,storagePath,fileName,contentType,size,scanStatus:'pending',visibility:'private',createdAt:now(),uploadExpiresAt:expiresAt});
  return {attachmentId,bucket:bucket().name,storagePath,scanStatus:'pending',uploadExpiresAt:iso(expiresAt)};
}
export async function finalizeContentUploadHandler(request:Request) {
  await admin(request);
  const source=obj(request.data,['attachmentId']), attachmentId=id(source.attachmentId), ref=db.doc(`contentAttachments/${attachmentId}`), snapshot=await ref.get(), metadata=snapshot.data();
  if (!metadata) throw new HttpsError('not-found','The upload reservation was not found.');
  if (metadata.finalizedAt) return {attachmentId,scanStatus:metadata.scanStatus,generation:metadata.generation};
  if (!(metadata.uploadExpiresAt instanceof Timestamp) || metadata.uploadExpiresAt.toMillis()<=Date.now()) throw new HttpsError('failed-precondition','The upload reservation expired. Start the upload again.');
  const file=bucket().file(metadata.storagePath), [stored]=await file.getMetadata();
  if (!stored.generation || stored.contentType!==metadata.contentType || Number(stored.size)!==metadata.size || Number(stored.size)>uploadLimit(kind(metadata.kind),metadata.role,metadata.contentType)) throw new HttpsError('failed-precondition','The uploaded file did not match its reservation.');
  const exact=bucket().file(metadata.storagePath,{generation:stored.generation}), digest=createHash('sha256');
  for await (const chunk of exact.createReadStream()) digest.update(chunk);
  const hash=digest.digest('hex');
  // SDK uploads must never become bearer-token downloads. This metadata write does not change the object generation.
  await exact.setMetadata({metadata:{firebaseStorageDownloadTokens:null},cacheControl:'private, no-store'});
  await db.runTransaction(async transaction=>{
    await admin(request,transaction);
    const current=await transaction.get(ref);
    if (current.get('finalizedAt')) return;
    transaction.update(ref,{generation:stored.generation,sha256:hash,finalizedAt:now(),scanStatus:'pending',scan:null});
  });
  // No scanner is configured here. Only a trusted server worker may attest clean exact-generation/hash metadata.
  return {attachmentId,scanStatus:'pending',generation:stored.generation};
}
export async function getContentFileHandler(request:Request) {
  const source=obj(request.data,['kind','id','attachmentId']), type=kind(source.kind), recordId=id(source.id), attachmentId=id(source.attachmentId);
  const metadata=(await db.doc(`contentAttachments/${attachmentId}`).get()).data();
  if (!metadata || metadata.kind!==type || metadata.parentId!==recordId) throw new HttpsError('not-found','The attachment was not found.');
  const result=(delivery:'public-storage'|'authenticated')=>({attachmentId,bucket:metadata.bucket,storagePath:metadata.storagePath,generation:metadata.generation??null,contentType:metadata.contentType,fileName:metadata.fileName,size:metadata.size,sha256:metadata.sha256??null,scanStatus:metadata.scanStatus,delivery});
  // Published public bytes stay public even when a visitor has an unenrolled administrator claim.
  if (type!=='publication' && cleanAttachment(metadata)) {
    const published=await db.doc(`${collections(type).published}/${recordId}`).get();
    if (published.exists && attachmentIds(type,published.get('data')).some(file=>file.id===attachmentId)) return result('public-storage');
  }
  if (request.auth?.token.admin===true) {
    await admin(request);
    const draft=await db.doc(`${collections(type).draft}/${recordId}`).get();
    if (!draft.exists || !attachmentIds(type,draft.get('data')).some(file=>file.id===attachmentId)) throw new HttpsError('permission-denied','This file is not referenced by the current draft.');
    return result('authenticated');
  }
  if (type==='publication') {
    await member(request);
    const published=await db.doc(`${collections(type).published}/${recordId}`).get();
    if (published.exists && cleanAttachment(metadata) && attachmentIds(type,published.get('data')).some(file=>file.id===attachmentId)) return result('authenticated');
  }
  throw new HttpsError('permission-denied','The attachment is not available.');
}
export async function submitConsultationHandler(request:Request) {
  const source=obj(request.data,['category','subject','message','requestKey']), category=text(source.category,80,true), subject=text(source.subject,140,true), message=text(source.message,5000,true), requestKey=text(source.requestKey,36,true);
  if (!TOPICS.includes(category) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(requestKey)) throw new HttpsError('invalid-argument','A supported consultation category and UUID request key are required.');
  return db.runTransaction(async transaction=>{
    const uid=await member(request,transaction), recordId=sha(`${uid}:${requestKey}`), ref=db.doc(`consultations/${recordId}`), previous=await transaction.get(ref);
    if (previous.exists) {
      if (previous.get('category')!==category || previous.get('subject')!==subject || previous.get('message')!==message) throw new HttpsError('already-exists','That request key was already used for different enquiry details.');
      return {id:recordId,reference:previous.get('reference'),createdAt:iso(previous.get('createdAt')),status:'received'};
    }
    const owner=await transaction.get(db.doc(`members/${uid}`));
    const ownerName=text(owner.get('displayName'),80), ownerEmail=email(owner.get('email'));
    const createdAt=now(), reference=`ISP-Q${recordId.slice(0,12).toUpperCase()}`;
    transaction.create(ref,{ownerUid:uid,ownerName,ownerEmail,requestKey,category,subject,message,reference,createdAt,status:'received'});
    return {id:recordId,reference,createdAt:iso(createdAt),status:'received'};
  });
}
export async function saveEventInterestHandler(request:Request) {
  const source=obj(request.data,['eventId','name','email','company']), eventId=id(source.eventId), name=text(source.name,80,true), address=email(source.email), company=text(source.company,120);
  return db.runTransaction(async transaction=>{
    const uid=await member(request,transaction), published=await transaction.get(db.doc(`events/${eventId}`));
    if (!published.exists) throw new HttpsError('not-found','This event is not published.');
    const recordId=`${eventId}__${uid}`, ref=db.doc(`eventInterests/${recordId}`), existing=await transaction.get(ref);
    if (existing.exists) {
      if (existing.get('ownerUid') !== uid || existing.get('eventId') !== eventId) throw new HttpsError('already-exists','This interest identifier is unavailable.');
      return {id:recordId,...exportJson(existing.data()) as object};
    }
    const data={ownerUid:uid,eventId,name,email:address,company,eventRevision:published.get('revision'),eventSnapshot:published.get('data'),createdAt:now()};
    transaction.create(ref,data);
    return {id:recordId,...exportJson(data) as object};
  });
}
export async function withdrawEventInterestHandler(request:Request) {
  const source=obj(request.data,['eventId']), eventId=id(source.eventId);
  return db.runTransaction(async transaction=>{const uid=await member(request,transaction);transaction.delete(db.doc(`eventInterests/${eventId}__${uid}`));return {withdrawn:true};});
}
export async function listOwnHandler(request:Request, collectionName:'consultations'|'eventInterests') {
  const uid=await member(request), source=obj(request.data,['afterId']), after=source.afterId===undefined?null:cursorId(source.afterId);
  let query=db.collection(collectionName).where('ownerUid','==',uid).orderBy(FieldPath.documentId()).limit(25);
  if (after) query=query.startAfter(after);
  const snapshot=await query.get();
  return {items:snapshot.docs.map(row=>({id:row.id,...exportJson(row.data()) as object})),nextCursor:snapshot.size===25?snapshot.docs.at(-1)!.id:null};
}
export async function listAdminConsultationsHandler(request:Request) {
  await admin(request);
  const source=obj(request.data,['afterId']), after=source.afterId===undefined?null:cursorId(source.afterId);
  let query=db.collection('consultations').orderBy(FieldPath.documentId()).limit(25);
  if (after) query=query.startAfter(after);
  const snapshot=await query.get();
  return {items:snapshot.docs.map(row=>({id:row.id,...exportJson(row.data()) as object})),nextCursor:snapshot.size===25?snapshot.docs.at(-1)!.id:null};
}



