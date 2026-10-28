import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Transaction, type DocumentSnapshot } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getAuth } from 'firebase-admin/auth';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { id, sha, type Kind } from './validation.js';

if (!getApps().length) initializeApp();
export const db = getFirestore();
export const auth = getAuth();
export const bucket = () => getStorage().bucket();
export type Request = CallableRequest<unknown>;
export const now = () => Timestamp.now();
export const expiry = (minutes: number) => Timestamp.fromMillis(Date.now() + minutes * 60_000);
export const collections = (kind: Kind) => ({draft: kind === 'event' ? 'eventDrafts' : kind === 'discover' ? 'discoverDrafts' : 'publicationDrafts',published:kind === 'event' ? 'events' : kind === 'discover' ? 'discover' : 'publications'});
export function verified(request: Request): string {
  if (!request.auth || request.auth.token.email_verified !== true) throw new HttpsError('permission-denied', 'A verified sign-in is required.');
  return request.auth.uid;
}
export async function admin(request: Request, transaction?: Transaction): Promise<string> {
  const uid = verified(request), token = request.auth!.token;
  if (token.admin !== true || token.firebase?.sign_in_second_factor !== 'totp') throw new HttpsError('permission-denied','Administrator access with an authenticator is required.');
  const ref = db.doc(`staff/${uid}`), snapshot = transaction ? await transaction.get(ref) : await ref.get();
  if (!snapshot.exists || snapshot.get('active') !== true) throw new HttpsError('permission-denied','Active staff access is required.');
  return uid;
}
export async function member(request: Request, transaction?: Transaction): Promise<string> {
  const uid = verified(request), ref = db.doc(`members/${uid}`);
  const snapshot = transaction ? await transaction.get(ref) : await ref.get();
  if (!snapshot.exists || snapshot.get('status') !== 'approved') throw new HttpsError('permission-denied','An approved membership is required.');
  const stateRef = db.doc('registryState/current'), state = transaction ? await transaction.get(stateRef) : await stateRef.get();
  const version = state.get('activeVersion');
  if (version !== undefined && version !== null && typeof version !== 'string') throw new HttpsError('permission-denied','The membership eligibility state is invalid.');
  if (typeof version === 'string' && version) {
    const reference = snapshot.get('membershipReference'), key = snapshot.get('registryKey');
    if (typeof reference !== 'string' || typeof key !== 'string' || key !== sha(reference.trim())) throw new HttpsError('permission-denied','The membership must be paired with the eligibility registry.');
    const rowRef = db.doc(`memberRegistryVersions/${id(version)}/entries/${id(key)}`), row = transaction ? await transaction.get(rowRef) : await rowRef.get();
    if (!row.exists || row.get('status') !== 'eligible' || row.get('accessSuspended') === true || row.get('memberReference') !== reference
      || row.get('email') !== snapshot.get('email') || row.get('email') !== request.auth!.token.email?.toLowerCase()) throw new HttpsError('permission-denied','Current membership eligibility is required.');
  }
  return uid;
}
export function conflict(): never { throw new HttpsError('failed-precondition','This record changed. Reload it and create a fresh preview.'); }
export function iso(value: unknown): string | null { return value instanceof Timestamp ? value.toDate().toISOString() : null; }
export function publicRecord(snapshot: DocumentSnapshot) {
  const data = snapshot.data()!;
  return {id:snapshot.id,revision:data.revision,data:data.data,publishedAt:iso(data.publishedAt)};
}
export function draftRecord(snapshot: DocumentSnapshot) {
  const data = snapshot.data()!;
  return {id:snapshot.id,revision:data.revision,data:data.data,previewRevision:data.preview?.revision ?? null,publishedRevision:data.publishedRevision ?? null,publishedAt:iso(data.publishedAt)};
}
export function exportJson(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(exportJson);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,exportJson(item)]));
  return value;
}

