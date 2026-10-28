import { createHash } from 'node:crypto';
import { HttpsError, type Request as HttpRequest } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import { admin, member, verified, auth, db, bucket, collections, type Request } from './runtime.js';
import { cleanAttachment } from './content.js';
import { obj, id, kind, attachmentIds, uploadLimit } from './validation.js';

export const DOWNLOAD_ORIGINS=['https://isp-planter-app.web.app','https://isp-planter-app.firebaseapp.com'];
export const MAX_DOWNLOAD_BYTES=25*1024*1024;
export interface DownloadDescriptor {
  attachmentId:string;storagePath:string;generation:string;contentType:string;fileName:string;size:number;sha256:string;
}
// This service performs the full member/registry guard that cannot fit within Storage's two Firestore-lookup limit.
export async function authorizeDownload(request:Request, raw:unknown):Promise<DownloadDescriptor> {
  verified(request);
  const source=obj(raw,['kind','id','attachmentId']),type=kind(source.kind),recordId=id(source.id),attachmentId=id(source.attachmentId);
  const metadata=(await db.doc(`contentAttachments/${attachmentId}`).get()).data();
  if(!metadata || metadata.kind!==type || metadata.parentId!==recordId)throw new HttpsError('not-found','The attachment was not found.');
  if(!cleanAttachment(metadata))throw new HttpsError('failed-precondition','This file is awaiting its trusted safety scan.');
  const isAdmin=request.auth!.token.admin===true;
  if(isAdmin)await admin(request);else if(type==='publication')await member(request);
  const parentCollection=isAdmin?collections(type).draft:collections(type).published;
  const parent=await db.doc(`${parentCollection}/${recordId}`).get();
  if(!parent.exists || !attachmentIds(type,parent.get('data')).some(file=>file.id===attachmentId))throw new HttpsError('permission-denied','This file is not referenced by the current accessible record.');
  const storagePath=`contentUploads/${type}/${recordId}/${attachmentId}`;
  const size=metadata.size,limit=uploadLimit(type,metadata.role,metadata.contentType);
  if(metadata.bucket!==bucket().name || metadata.storagePath!==storagePath || !Number.isSafeInteger(size) || size<1 || size>limit || size>MAX_DOWNLOAD_BYTES)throw new HttpsError('failed-precondition','The stored file does not match its approved limits.');
  return {attachmentId,storagePath,generation:metadata.generation,contentType:metadata.contentType,fileName:metadata.fileName,size,sha256:metadata.sha256};
}
export function disposition(file:Pick<DownloadDescriptor,'contentType'|'fileName'>):string {
  const mode=file.contentType==='application/pdf'?'attachment':'inline';
  const name=typeof file.fileName==='string'?file.fileName.slice(0,180):'download';
  const fallback=name.replace(/[^\x20-\x7e]|["\\/]/gu,'_')||'download';
  const encoded=encodeURIComponent(name).replace(/['()*]/gu,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${mode}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
export async function verifiedBody(source:AsyncIterable<Buffer>,file:Pick<DownloadDescriptor,'size'|'sha256'>):Promise<Buffer> {
  if(!Number.isSafeInteger(file.size) || file.size<1 || file.size>MAX_DOWNLOAD_BYTES)throw new HttpsError('resource-exhausted','This file exceeds the download limit.');
  const bytes=Buffer.allocUnsafe(file.size),hash=createHash('sha256');let offset=0;
  for await(const chunk of source) {
    if(!Buffer.isBuffer(chunk) || offset+chunk.length>file.size)throw new HttpsError('failed-precondition','The file size did not match its approved version.');
    chunk.copy(bytes,offset);offset+=chunk.length;hash.update(chunk);
  }
  if(offset!==file.size || hash.digest('hex')!==file.sha256)throw new HttpsError('failed-precondition','The file did not match its approved integrity check.');
  return bytes;
}
function errorResponse(response:Response,error:unknown) {
  if(response.headersSent){response.destroy();return;}
  for(const name of ['Content-Length','Content-Disposition','Content-Type','X-ISP-File-Generation','X-ISP-File-SHA256'])response.removeHeader(name);
  const code=error instanceof HttpsError?error.code:'internal';
  const statuses:Record<string,number>={'unauthenticated':401,'permission-denied':403,'invalid-argument':400,'not-found':404,'failed-precondition':409,'resource-exhausted':413,'unavailable':503};
  const message=error instanceof HttpsError?error.message:'This file could not be downloaded. Please try again.';
  response.status(statuses[code]??500).set({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}).json({error:{code,message}});
}
export async function downloadContentFileHandler(request:HttpRequest,response:Response):Promise<void> {
  if(request.method!=='GET'){response.status(405).set('Allow','GET').json({error:{code:'invalid-argument',message:'Use GET to download a file.'}});return;}
  try {
    const header=request.headers.authorization;
    if(typeof header!=='string' || header.length>16384 || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/iu.test(header))throw new HttpsError('unauthenticated','A current sign-in token is required in the Authorization header.');
    let decoded;
    try {decoded=await auth.verifyIdToken(header.slice(7),true);}catch{throw new HttpsError('unauthenticated','Please sign in again before downloading this file.');}
    const identity={auth:{uid:decoded.uid,token:decoded},data:request.query} as Request;
    const file=await authorizeDownload(identity,request.query),object=bucket().file(file.storagePath,{generation:file.generation}),[metadata]=await object.getMetadata();
    if(metadata.generation!==file.generation || Number(metadata.size)!==file.size || metadata.contentType!==file.contentType || metadata.contentEncoding && metadata.contentEncoding!=='identity')throw new HttpsError('failed-precondition','The stored file no longer matches the approved version.');
    // Gen2 permits32MB non-streaming but only10MB streaming. Verify at most25MiB before sending one binary response.
    const body=await verifiedBody(object.createReadStream({decompress:false,validation:'crc32c'}),file);
    response.status(200).set({
      'Content-Type':file.contentType,'Content-Length':String(file.size),'Content-Disposition':disposition(file),
      'Cache-Control':'private, no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'none'; sandbox",'Referrer-Policy':'no-referrer',
      'X-ISP-File-Generation':file.generation,'X-ISP-File-SHA256':file.sha256,
      'Access-Control-Expose-Headers':'X-ISP-File-Generation, X-ISP-File-SHA256, Content-Disposition, Content-Length, Content-Type',
    });
    response.send(body);
  }catch(error){errorResponse(response,error);}
}


