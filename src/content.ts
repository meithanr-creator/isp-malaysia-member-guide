import { getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { collection, doc, documentId, getDocFromServer, getDocsFromServer, getFirestore, limit, orderBy, query, startAfter, type QueryConstraint } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getBlob, getMetadata, getStorage, ref, uploadBytes } from 'firebase/storage';
import { sessionResultIsCurrent, type Session } from './firebase';
import type { AttachmentView, ContentDraft, ContentKind, ContentPreview, ContentProjection, Consultation, DiscoverData, EventData, FileSelection, Interest, PublicationData, RegistryPreview, RegistryProgress, RegistryEntry } from './ContentPages';

export interface ContentPage<T> { items: T[]; nextCursor: string | null }
type Scope = 'admin' | 'member' | 'public';
export type ContentData = EventData | DiscoverData | PublicationData;
function app() { const current = getApp(); if (current.options.projectId !== 'isp-planter-app') throw Error('The content connection is unavailable.'); return current; }
function check(session: Session | null, scope: Scope) {
  app();
  if (session && !sessionResultIsCurrent(session)) throw Error('Your sign-in changed. Reload this page before continuing.');
  if (scope === 'public') return;
  if (!session || session.status !== 'ready' || !session.user || getAuth(app()).currentUser?.uid !== session.user.uid || !(scope === 'admin' ? session.adminAccess : session.memberAccess)) throw Error('Access is not available for this account.');
}
function normalize(value: unknown): unknown {
  if (value && typeof value === 'object') {
    if ('toDate' in value && typeof value.toDate === 'function') return value.toDate().toISOString();
    if (Array.isArray(value)) return value.map(normalize);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  }
  return value;
}
function displayError(error: unknown): Error {
  const candidate = error as { code?: string; message?: string };
  if (['functions/invalid-argument', 'functions/failed-precondition', 'functions/already-exists', 'functions/permission-denied', 'functions/not-found', 'functions/resource-exhausted'].includes(candidate?.code || '')) return Error(candidate.message || 'This request could not be completed.');
  return Error('We could not confirm that request. Reload before trying again.');
}
async function call<T>(name: string, input: object, session: Session | null, scope: Scope): Promise<T> {
  check(session, scope);
  try {
    const result = await httpsCallable<object, T>(getFunctions(app(), 'asia-southeast1'), name, { timeout: 120000 })(input);
    check(session, scope);
    return result.data;
  } catch (error) {
    check(session, scope);
    throw displayError(error);
  }
}
const draftCollections = { event: 'eventDrafts', discover: 'discoverDrafts', publication: 'publicationDrafts' } as const;
const publishedCollections = { event: 'events', discover: 'discover', publication: 'publications' } as const;

export async function listPublished<T>(kind: ContentKind, afterId: string | null, session: Session | null): Promise<ContentPage<ContentProjection<T>>> {
  const scope = kind === 'publication' ? 'member' : 'public'; check(session, scope);
  const constraints: QueryConstraint[] = [orderBy(documentId()), ...(afterId ? [startAfter(afterId)] : []), limit(kind === 'discover' ? 3 : 25)];
  const snapshot = await getDocsFromServer(query(collection(getFirestore(app()), publishedCollections[kind]), ...constraints));
  check(session, scope);
  return { items: snapshot.docs.map(row => ({ id: row.id, ...normalize(row.data()) as object }) as ContentProjection<T>), nextCursor: kind !== 'discover' && snapshot.size === 25 ? snapshot.docs.at(-1)!.id : null };
}
export async function getPublished<T>(kind: ContentKind, id: string, session: Session | null): Promise<ContentProjection<T>> {
  const scope = kind === 'publication' ? 'member' : 'public'; check(session, scope);
  const row = await getDocFromServer(doc(getFirestore(app()), publishedCollections[kind], id)); check(session, scope);
  if (!row.exists()) throw Error('This published item is unavailable.');
  return { id: row.id, ...normalize(row.data()) as object } as ContentProjection<T>;
}
export function listDrafts<T>(kind: ContentKind, afterId: string | null, session: Session) {
  return call<ContentPage<ContentDraft<T>>>('listContentDrafts', { kind, ...(afterId ? { afterId } : {}) }, session, 'admin');
}
export async function getDraft<T>(kind: ContentKind, id: string, session: Session): Promise<ContentDraft<T>> {
  check(session, 'admin'); const row = await getDocFromServer(doc(getFirestore(app()), draftCollections[kind], id)); check(session, 'admin');
  if (!row.exists()) throw Error('This draft is unavailable.');
  const value = normalize(row.data()) as Record<string, unknown>, preview = value.preview as { revision?: number } | null;
  return { id: row.id, ...value, previewRevision: preview?.revision ?? null } as ContentDraft<T>;
}
export function previewDraft<T>(kind: ContentKind, record: ContentDraft<T>, session: Session) {
  return call<ContentPreview<T>>('previewContentDraft', { kind, id: record.id, expectedRevision: record.revision }, session, 'admin');
}
export function publishDraft<T>(kind: ContentKind, preview: ContentPreview<T>, session: Session) {
  return call<{ id: string; revision: number; publishedAt: string }>('publishContentDraft', { kind, id: preview.id, expectedRevision: preview.revision, expectedPreviewToken: preview.previewToken }, session, 'admin');
}
export async function saveDraft<T extends ContentData>(kind: ContentKind, record: ContentDraft<T>, data: T, uploads: FileSelection[], session: Session): Promise<ContentDraft<T>> {
  let saved = await call<{ id: string; revision: number }>('saveContentDraft', { kind, id: record.id, expectedRevision: record.revision, data }, session, 'admin');
  if (!uploads.length) return { ...record, ...saved, data, previewRevision: null };
  const updated = { ...data } as ContentData;
  try {
    for (const upload of uploads) {
      check(session, 'admin');
      const ticket = await call<{ attachmentId: string; bucket: string; storagePath: string; scanStatus: 'pending' }>('prepareContentUpload', { kind, id: saved.id, role: upload.role, name: upload.file.name, mimeType: upload.file.type, size: upload.file.size }, session, 'admin');
      if (ticket.bucket !== app().options.storageBucket || ticket.storagePath !== 'contentUploads/' + kind + '/' + saved.id + '/' + ticket.attachmentId) throw Error('The file connection is unavailable.');
      await uploadBytes(ref(getStorage(app()), ticket.storagePath), upload.file, { contentType: upload.file.type, cacheControl: 'private, no-store, max-age=0' });
      check(session, 'admin');
      await call('finalizeContentUpload', { attachmentId: ticket.attachmentId }, session, 'admin');
      if (kind === 'event') {
        if (upload.role === 'image') (updated as EventData).images = [...(updated as EventData).images, ticket.attachmentId];
        else if (upload.role === 'brochure') (updated as EventData).brochure = ticket.attachmentId;
      } else if (kind === 'publication') {
        if (upload.role === 'cover') (updated as PublicationData).cover = ticket.attachmentId;
        else if (upload.role === 'pdf') (updated as PublicationData).pdf = ticket.attachmentId;
      } else (updated as DiscoverData).image = ticket.attachmentId;
    }
    saved = await call('saveContentDraft', { kind, id: saved.id, expectedRevision: saved.revision, data: updated }, session, 'admin');
  } catch (error) {
    check(session, 'admin');
    throw Error('Draft text was saved, but the file change was not confirmed. Reload this draft before retrying. ' + displayError(error).message);
  }
  return { ...record, ...saved, data: updated as T, previewRevision: null };
}
interface FileMetadata { delivery: 'public-storage' | 'authenticated'; attachmentId: string; bucket: string; storagePath: string; generation: string | null; contentType: string; fileName: string; size: number; sha256: string | null; scanStatus: 'pending' | 'clean' | 'rejected' }
async function fileMetadata(kind: ContentKind, id: string, attachmentId: string, session: Session | null) {
  return call<FileMetadata>('getContentFile', { kind, id, attachmentId }, session, session?.adminAccess ? 'admin' : kind === 'publication' ? 'member' : 'public');
}
async function checkedBlob(kind: ContentKind, id: string, metadata: FileMetadata, session: Session | null): Promise<Blob> {
  if (metadata.scanStatus !== 'clean' || !metadata.generation || !metadata.sha256 || !/^[a-f0-9]{64}$/.test(metadata.sha256) || metadata.bucket !== app().options.storageBucket || metadata.storagePath !== 'contentUploads/' + kind + '/' + id + '/' + metadata.attachmentId || metadata.size < 1 || metadata.size > 25 * 1024 * 1024) throw Error('This file has not received server approval.');
  check(session, 'public');
  if (!['public-storage', 'authenticated'].includes(metadata.delivery) || (metadata.delivery === 'public-storage' && kind === 'publication')) throw Error('This file delivery route is unavailable.');
  const user = getAuth(app()).currentUser; let blob: Blob;
  if (metadata.delivery === 'public-storage') {
    const object = ref(getStorage(app()), metadata.storagePath), before = await getMetadata(object);
    if (String(before.generation) !== String(metadata.generation)) throw Error('This file changed after approval.');
    blob = await getBlob(object, 25 * 1024 * 1024);
    const after = await getMetadata(object);
    if (String(after.generation) !== String(metadata.generation)) throw Error('This file changed after approval.');
  } else {
    if (!user) throw Error('Sign in to open this member file.');
    const token = await user.getIdToken(); check(session, 'public');
    const target = new URL('https://asia-southeast1-isp-planter-app.cloudfunctions.net/downloadContentFile');
    target.searchParams.set('kind', kind); target.searchParams.set('id', id); target.searchParams.set('attachmentId', metadata.attachmentId);
    const response = await fetch(target, { method: 'GET', headers: { Authorization: 'Bearer ' + token }, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(60000) });
    check(session, 'public');
    if (response.status !== 200 || !response.body || response.headers.get('X-ISP-File-Generation') !== metadata.generation || response.headers.get('X-ISP-File-SHA256') !== metadata.sha256 || response.headers.get('Content-Type')?.split(';')[0] !== metadata.contentType) { await response.body?.cancel(); throw Error('This file is unavailable or no longer matches its approved version.'); }
    const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
    try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > metadata.size || size > 25 * 1024 * 1024) throw Error('The file exceeded its approved size.'); chunks.push(new Uint8Array(part.value)); } }
    catch (error) { await reader.cancel().catch(() => {}); throw error; }
    blob = new Blob(chunks, { type: metadata.contentType });
  }
  const bytes = await blob.arrayBuffer(), digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(value => value.toString(16).padStart(2, '0')).join('');
  check(session, 'public');
  if (blob.size !== metadata.size || digest !== metadata.sha256) throw Error('The downloaded file did not match its approved version.');
  return blob;
}
export async function loadAttachments(kind: ContentKind, id: string, ids: string[], session: Session | null): Promise<{ files: Record<string, AttachmentView>; release: () => void }> {
  const files: Record<string, AttachmentView> = {}, urls: string[] = [];
  try {
    for (const attachmentId of [...new Set(ids)].slice(0, kind === 'event' ? 4 : kind === 'publication' ? 2 : 1)) {
      try {
        const metadata = await fileMetadata(kind, id, attachmentId, session);
        const file: AttachmentView = { id: attachmentId, name: metadata.fileName, size: metadata.size, scanStatus: metadata.scanStatus };
        if (metadata.scanStatus === 'clean' && metadata.contentType.startsWith('image/')) { file.objectUrl = URL.createObjectURL(await checkedBlob(kind, id, metadata, session)); urls.push(file.objectUrl); }
        files[attachmentId] = file;
      } catch {
        if (session && !sessionResultIsCurrent(session)) throw Error('Your sign-in changed.');
        files[attachmentId] = { id: attachmentId, name: 'File unavailable' };
      }
    }
    return { files, release: () => urls.forEach(url => URL.revokeObjectURL(url)) };
  } catch (error) { urls.forEach(url => URL.revokeObjectURL(url)); throw error; }
}
export async function downloadContentFile(kind: ContentKind, id: string, attachmentId: string, session: Session | null): Promise<void> {
  const metadata = await fileMetadata(kind, id, attachmentId, session), blob = await checkedBlob(kind, id, metadata, session);
  check(session, 'public');
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = metadata.fileName; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function listConsultations(admin: boolean, afterId: string | null, session: Session) {
  return call<ContentPage<Consultation>>(admin ? 'listAdminConsultations' : 'listMyConsultations', afterId ? { afterId } : {}, session, admin ? 'admin' : 'member');
}
export async function getConsultation(id: string, admin: boolean, session: Session): Promise<Consultation> {
  const scope = admin ? 'admin' : 'member'; check(session, scope);
  const row = await getDocFromServer(doc(getFirestore(app()), 'consultations', id)); check(session, scope);
  if (!row.exists()) throw Error('This enquiry is unavailable.');
  return { id: row.id, ...normalize(row.data()) as object } as Consultation;
}
export function submitConsultation(data: { category: string; subject: string; message: string; requestKey: string }, session: Session) { return call<{ id: string; reference: string; createdAt: string; status: 'received' }>('submitConsultation', data, session, 'member'); }
export function listInterests(afterId: string | null, session: Session) { return call<ContentPage<Interest>>('listMyEventInterests', afterId ? { afterId } : {}, session, 'member'); }
export async function getInterest(eventId: string, session: Session): Promise<Interest | null> {
  check(session, 'member'); const row = await getDocFromServer(doc(getFirestore(app()), 'eventInterests', eventId + '__' + session.user!.uid)); check(session, 'member');
  return row.exists() ? { id: row.id, ...normalize(row.data()) as object } as Interest : null;
}
export function saveInterest(eventId: string, values: { name: string; email: string; company: string }, session: Session) { return call<Interest>('saveEventInterest', { eventId, ...values }, session, 'member'); }
export function withdrawInterest(eventId: string, session: Session) { return call<{ withdrawn: true }>('withdrawEventInterest', { eventId }, session, 'member'); }
export function previewRegistry(csv: string, session: Session) { return call<RegistryPreview>('previewRegistryImport', { csv }, session, 'admin'); }
export function getRegistryPreview(previewId: string, afterRow: number | null, session: Session) { return call<RegistryPreview>('getRegistryImportPreview', { previewId, ...(afterRow ? { afterRow } : {}) }, session, 'admin'); }
export function confirmRegistry(preview: RegistryPreview, session: Session) { return call<RegistryProgress>('confirmRegistryImport', { previewId: preview.previewId, digest: preview.digest, registryVersion: preview.registryVersion }, session, 'admin'); }

export function listRegistry(afterId: string | null, session: Session) { return call<ContentPage<RegistryEntry> & {activeVersion: string | null; revision: number}>('listRegistry', afterId ? {afterId} : {}, session, 'admin'); }
