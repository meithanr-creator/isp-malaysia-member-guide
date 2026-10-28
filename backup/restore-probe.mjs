import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  PROJECT, DATABASE, SOURCE_BUCKET, STAGING_BUCKET, BACKUP_SERVICE_ACCOUNT, OWNER, FOLDER, APP_TAG,
  requireThat, sha256, encode, parseDriveSecret, assertPrivateDriveFile, assertDriveScopes, sourceKey,
} from './manifest.mjs';
import { startProcessWatchdog } from './watchdog.mjs';

const MAX_BYTES = 64 * 1024 * 1024, MAX_FILES = 128, MAX_REQUESTS = 350;
const IMPORT_POLLS = 60, FIXED_HTTP_CALLS = 9;
export function restoreHttpAdmission(exportFiles) {
  // Each export and the one file probe require metadata, media and metadata reread.
  // Nine fixed calls cover owner/folder/manifest, three target reads, import start and probe read.
  const required = 3 * (exportFiles + 1) + FIXED_HTTP_CALLS + IMPORT_POLLS;
  requireThat(Number.isSafeInteger(exportFiles) && exportFiles > 0 && exportFiles <= MAX_FILES && required <= MAX_REQUESTS, 'RESTORE_HTTP_ENVELOPE_EXCEEDED');
  return required;
}
const FILE_FIELDS = 'id,size,md5Checksum,sha256Checksum,parents,owners(emailAddress),permissions(type,role,emailAddress),shared,trashed,appProperties';
const ACK = 'RESTORE_OWNED_PROBE_TO_DISPOSABLE_DATABASE_ONLY';
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(value);
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function exactKeys(value, keys, code) { requireThat(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(','), code); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export function verifyProbeFields(fields, expected) { requireThat(JSON.stringify(canonical(fields)) === JSON.stringify(canonical(expected)), 'OWNED_PROBE_TYPED_VALUES_MISMATCH'); }
export function validateReceipt(receipt, now = Date.now()) {
  exactKeys(receipt, ['version','scope','receiptId','project','database','acknowledgement','issuedAt','expiresAt','rulesDenyClientsVerified','authorizedBudgetUsd','sourceVersion','manifest','expectedExportFiles','expectedExportBytes','file','probe'], 'RESTORE_RECEIPT_FIELDS_INVALID');
  requireThat(receipt.version === 1 && receipt.scope === 'isp-owned-restore-proof' && receipt.project === PROJECT && receipt.acknowledgement === ACK && receipt.rulesDenyClientsVerified === true && receipt.authorizedBudgetUsd === 0.4, 'RESTORE_OWNER_ADMISSION_REQUIRED');
  requireThat(/^\d{8}-[a-f0-9]{8}$/.test(receipt.receiptId || '') && receipt.database === 'isp-restore-proof-' + receipt.receiptId && receipt.database !== DATABASE, 'NAMED_PROOF_DATABASE_REQUIRED');
  const issued = Date.parse(receipt.issuedAt), expires = Date.parse(receipt.expiresAt);
  requireThat(Number.isFinite(issued) && Number.isFinite(expires) && issued <= now && now < expires && expires - issued <= 7200000 && expires > issued, 'RESTORE_RECEIPT_EXPIRED');
  requireThat(/^[a-f0-9]{40}$/.test(receipt.sourceVersion || ''), 'RESTORE_SOURCE_VERSION_INVALID');
  exactKeys(receipt.manifest, ['driveId','sha256'], 'RESTORE_MANIFEST_PIN_INVALID');
  requireThat(validId(receipt.manifest.driveId) && validHash(receipt.manifest.sha256), 'RESTORE_MANIFEST_PIN_INVALID');
  requireThat(Number.isSafeInteger(receipt.expectedExportFiles) && receipt.expectedExportFiles > 0 && receipt.expectedExportFiles <= MAX_FILES && Number.isSafeInteger(receipt.expectedExportBytes) && receipt.expectedExportBytes > 0 && receipt.expectedExportBytes <= MAX_BYTES, 'RESTORE_EXPORT_BOUND_INVALID');
  exactKeys(receipt.file, ['driveId','bucket','name','generation','sha256','size'], 'OWNED_FILE_RECEIPT_INVALID');
  requireThat(validId(receipt.file.driveId) && receipt.file.bucket === SOURCE_BUCKET && receipt.file.name === 'backupRestoreProbes/' + receipt.receiptId + '.bin' && /^[0-9]+$/.test(receipt.file.generation || '') && validHash(receipt.file.sha256) && Number.isSafeInteger(receipt.file.size) && receipt.file.size > 0 && receipt.file.size <= 1048576 && receipt.expectedExportBytes + receipt.file.size <= MAX_BYTES, 'OWNED_FILE_RECEIPT_INVALID');
  exactKeys(receipt.probe, ['documentPath','expectedFields'], 'OWNED_PROBE_RECEIPT_INVALID');
  requireThat(receipt.probe.documentPath === 'backupRestoreProbes/' + receipt.receiptId, 'OWNED_PROBE_PATH_REQUIRED');
  const fields = receipt.probe.expectedFields;
  exactKeys(fields?.marker, ['stringValue'], 'OWNED_PROBE_MARKER_TIME_INVALID');
  exactKeys(fields?.sampleTime, ['timestampValue'], 'OWNED_PROBE_MARKER_TIME_INVALID');
  exactKeys(fields, ['proofKind','receiptId','marker','sampleNumber','sampleFlag','sampleNull','sampleTime'], 'OWNED_PROBE_FIELDS_REQUIRED');
  const expected = { proofKind: {stringValue:'isp-owned-restore-proof-v1'}, receiptId: {stringValue:receipt.receiptId}, marker: fields.marker, sampleNumber: {integerValue:'7'}, sampleFlag: {booleanValue:true}, sampleNull: {nullValue:null}, sampleTime: fields.sampleTime };
  requireThat(validHash(fields.marker?.stringValue + fields.marker?.stringValue) && !/^0+$/.test(fields.marker.stringValue) && typeof fields.sampleTime?.timestampValue === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(fields.sampleTime.timestampValue) && Number.isFinite(Date.parse(fields.sampleTime.timestampValue)), 'OWNED_PROBE_MARKER_TIME_INVALID');
  verifyProbeFields(fields, expected);
  return receipt;
}
export function restoreSelection(manifest, receipt) {
  requireThat(manifest?.version === 1 && manifest.kind === APP_TAG && manifest.status === 'COMPLETE' && manifest.source?.project === PROJECT && manifest.source.database === DATABASE && manifest.source.storageBucket === SOURCE_BUCKET && manifest.sourceVersion === receipt.sourceVersion && manifest.destination?.folderId === FOLDER && manifest.destination.ownerEmail === OWNER && manifest.destination.private === true, 'COMPLETE_PINNED_BACKUP_REQUIRED');
  requireThat(manifest.firestore?.complete === true && manifest.firestore.collectionGroups === 'all' && manifest.firestore.operation?.startsWith('projects/' + PROJECT + '/databases/' + DATABASE + '/operations/'), 'COMPLETE_MANAGED_EXPORT_REQUIRED');
  const prefix = 'gs://' + STAGING_BUCKET + '/';
  requireThat(typeof manifest.firestore.outputUriPrefix === 'string' && manifest.firestore.outputUriPrefix.startsWith(prefix), 'EXPORT_SOURCE_BUCKET_INVALID');
  const sourcePrefix = manifest.firestore.outputUriPrefix.slice(prefix.length).replace(/\/$/, '') + '/';
  requireThat(/^firestore\/\d{4}-\d\d-\d\d\/(?:[A-Za-z0-9_.-]+\/){1,4}$/.test(sourcePrefix) && !sourcePrefix.split('/').some(part => part === '.' || part === '..'), 'EXPORT_SOURCE_PREFIX_INVALID');
  const basename = sourcePrefix.split('/').at(-2), targetPrefix = 'restore-proofs/' + receipt.receiptId + '/firestore/' + basename + '/';
  requireThat(Array.isArray(manifest.artifacts), 'MANIFEST_ARTIFACTS_INVALID');
  const exports = manifest.artifacts.filter(item => item.category === 'firestore-export');
  requireThat(exports.length === receipt.expectedExportFiles && exports.length === manifest.firestore.outputFiles && new Set(exports.map(item => item.driveId)).size === exports.length && new Set(exports.map(item => item.source?.name)).size === exports.length, 'EXPORT_FILE_COUNT_MISMATCH');
  restoreHttpAdmission(exports.length);
  let total = 0;
  const files = exports.map(item => {
    requireThat(item.verified === true && validId(item.driveId) && validHash(item.sha256) && /^[a-f0-9]{32}$/.test(item.md5 || '') && Number.isSafeInteger(item.size) && item.size >= 0 && item.size <= MAX_BYTES && item.source?.bucket === STAGING_BUCKET && item.source.name.startsWith(sourcePrefix) && /^[0-9]+$/.test(item.source.generation || ''), 'EXPORT_ARTIFACT_INVALID');
    const relative = item.source.name.slice(sourcePrefix.length);
    requireThat(relative && !relative.split('/').some(part => !part || part === '.' || part === '..') && !/[\\\u0000-\u001f\u007f]/.test(relative), 'EXPORT_ARTIFACT_PATH_INVALID');
    total += item.size; requireThat(total <= MAX_BYTES, 'EXPORT_BYTES_EXCEEDED');
    return { artifact: item, target: targetPrefix + relative };
  });
  requireThat(total === receipt.expectedExportBytes && files.filter(item => item.target === targetPrefix + basename + '.overall_export_metadata').length === 1, 'EXPORT_BYTES_OR_METADATA_MISMATCH');
  const probe = manifest.artifacts.filter(item => item.category === 'storage-object' && item.driveId === receipt.file.driveId);
  requireThat(probe.length === 1, 'OWNED_FILE_ARTIFACT_MISSING');
  const file = probe[0], source = file.source;
  requireThat(file.verified === true && source?.bucket === receipt.file.bucket && source.name === receipt.file.name && source.generation === receipt.file.generation && file.sha256 === receipt.file.sha256 && file.size === receipt.file.size && /^[a-f0-9]{32}$/.test(file.md5 || '') && !files.some(item => item.artifact.driveId === file.driveId), 'OWNED_FILE_ARTIFACT_MISMATCH');
  return { files, file, fileTarget: 'restore-proofs/' + receipt.receiptId + '/file/' + receipt.receiptId + '.bin', inputUriPrefix: prefix + targetPrefix.replace(/\/$/, ''), controlPrefix: 'restore-proofs/' + receipt.receiptId + '/control/' };
}
export function verifyArtifactMetadata(metadata, artifact) {
  assertPrivateDriveFile(metadata);
  requireThat(metadata.id === artifact.driveId && metadata.appProperties?.app === APP_TAG && metadata.appProperties?.key === sourceKey(artifact.source) && metadata.appProperties?.sha256 === artifact.sha256 && metadata.appProperties?.generation === artifact.source.generation && metadata.md5Checksum === artifact.md5 && Number(metadata.size) === artifact.size && (!metadata.sha256Checksum || metadata.sha256Checksum === artifact.sha256), 'DRIVE_ARTIFACT_PROVENANCE_MISMATCH');
}
export async function restore(receiptPath) {
  requireThat(process.versions.node.split('.')[0] === '22' && process.env.CLOUD_RUN_JOB && process.env.CLOUD_RUN_EXECUTION && process.env.CLOUD_RUN_TASK_COUNT === '1' && process.env.CLOUD_RUN_TASK_INDEX === '0' && process.env.CLOUD_RUN_TASK_ATTEMPT === '0' && !process.env.GOOGLE_APPLICATION_CREDENTIALS, 'ATTACHED_SINGLE_TASK_RESTORE_REQUIRED');
  let phase = 'restore-admission', requests = 0;
  const watchdog = startProcessWatchdog(() => phase, 600000);
  try {
    const receiptBytes = await fs.readFile(receiptPath); requireThat(receiptBytes.length <= 16384, 'RESTORE_RECEIPT_TOO_LARGE');
    const receipt = validateReceipt(JSON.parse(receiptBytes)), secret = parseDriveSecret(process.env.ISP_DRIVE_BACKUP || '');
    const [{GoogleAuth, OAuth2Client},{Storage},{createHash}] = await Promise.all([import('google-auth-library'),import('@google-cloud/storage'),import('node:crypto')]);
    const google = new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']}), adc = await google.getClient();
    requireThat(await google.getProjectId() === PROJECT && (await google.getCredentials()).client_email === BACKUP_SERVICE_ACCOUNT, 'RESTORE_ATTACHED_IDENTITY_MISMATCH');
    const oauth = new OAuth2Client(secret.clientId,secret.clientSecret); oauth.setCredentials({refresh_token:secret.refreshToken});
    const token = await oauth.getAccessToken(); requireThat(token.token, 'DRIVE_ACCESS_UNAVAILABLE'); assertDriveScopes((await oauth.getTokenInfo(token.token)).scopes);
    async function request(url, bearer, {method='GET', data, max=1048576}={}) {
      requireThat(++requests <= MAX_REQUESTS, 'RESTORE_REQUEST_LIMIT');
      const response = await fetch(url,{method,headers:{Authorization:'Bearer '+bearer,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined,redirect:'error',signal:AbortSignal.timeout(Math.min(30000,watchdog.remaining()))});
      requireThat(response.ok,'RESTORE_HTTP_'+response.status);
      const chunks=[];let size=0;
      for await(const chunk of response.body){size+=chunk.length;requireThat(size<=max,'RESTORE_RESPONSE_TOO_LARGE');chunks.push(chunk);}
      return Buffer.concat(chunks);
    }
    async function driveJson(id, folder=false) {
      const fields=folder?'id,mimeType,trashed,shared,owners(emailAddress),permissions(type,role,emailAddress),capabilities(canAddChildren)':FILE_FIELDS;
      return JSON.parse((await request('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'?fields='+encodeURIComponent(fields),token.token)).toString('utf8'));
    }
    async function firestore(suffix, data) {
      const access=await adc.getAccessToken();requireThat(access.token,'RESTORE_ADC_TOKEN_UNAVAILABLE');
      return JSON.parse((await request('https://firestore.googleapis.com/v1/projects/'+PROJECT+'/databases/'+receipt.database+suffix,access.token,{method:data?'POST':'GET',data})).toString('utf8'));
    }
    const owner=JSON.parse((await request('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',token.token)).toString('utf8'));
    requireThat(owner.user?.emailAddress?.toLowerCase()===OWNER,'RESTORE_DRIVE_OWNER_MISMATCH');assertPrivateDriveFile(await driveJson(FOLDER,true),{folder:true});
    phase='restore-manifest';
    const manifestMetadata=await driveJson(receipt.manifest.driveId);assertPrivateDriveFile(manifestMetadata);
    requireThat(manifestMetadata.appProperties?.app===APP_TAG && manifestMetadata.appProperties?.kind==='manifest' && manifestMetadata.appProperties?.status==='COMPLETE' && manifestMetadata.appProperties?.sha256===receipt.manifest.sha256 && Number(manifestMetadata.size)<=1048576,'RESTORE_MANIFEST_METADATA_INVALID');
    const manifestBytes=await request('https://www.googleapis.com/drive/v3/files/'+receipt.manifest.driveId+'?alt=media',token.token);
    requireThat(sha256(manifestBytes)===receipt.manifest.sha256 && manifestBytes.length===Number(manifestMetadata.size) && createHash('md5').update(manifestBytes).digest('hex')===manifestMetadata.md5Checksum,'RESTORE_MANIFEST_BYTES_INVALID');
    const manifest=JSON.parse(manifestBytes),selected=restoreSelection(manifest,receipt);
    phase='restore-target-preflight';
    const database=await firestore('');requireThat(database.name==='projects/'+PROJECT+'/databases/'+receipt.database && database.type==='FIRESTORE_NATIVE' && database.locationId==='asia-southeast1','PROOF_DATABASE_METADATA_INVALID');
    const collections=await firestore('/documents:listCollectionIds',{pageSize:1});requireThat((collections.collectionIds||[]).length===0 && !collections.nextPageToken,'PROOF_DATABASE_MUST_BE_EMPTY');
    const storage=new Storage({projectId:PROJECT,retryOptions:{autoRetry:false}}),stage=storage.bucket(STAGING_BUCKET),[bucketMetadata]=await stage.getMetadata();
    requireThat(bucketMetadata.iamConfiguration?.uniformBucketLevelAccess?.enabled===true && bucketMetadata.iamConfiguration?.publicAccessPrevention==='enforced','RESTORE_STAGE_NOT_PRIVATE');
    const [occupied]=await stage.getFiles({prefix:'restore-proofs/'+receipt.receiptId+'/',autoPaginate:false,maxResults:1});requireThat(occupied.length===0,'RESTORE_PREFIX_ALREADY_ATTEMPTED');
    async function saveControl(name,value) {await stage.file(selected.controlPrefix+name+'.json').save(encode(value),{resumable:false,contentType:'application/json',metadata:{cacheControl:'private,no-store'},preconditionOpts:{ifGenerationMatch:0}});}
    await saveControl('intent',{version:1,scope:'owned-restore-proof',receiptId:receipt.receiptId,receiptSha256:sha256(receiptBytes),manifestSha256:receipt.manifest.sha256,database:receipt.database,inputUriPrefix:selected.inputUriPrefix,createdAt:new Date().toISOString(),automaticRetryAllowed:false});
    phase='restore-rehydrate';
    async function rehydrate(artifact,target) {
      verifyArtifactMetadata(await driveJson(artifact.driveId),artifact);
      const bytes=await request('https://www.googleapis.com/drive/v3/files/'+artifact.driveId+'?alt=media',token.token,{max:artifact.size});
      requireThat(bytes.length===artifact.size && sha256(bytes)===artifact.sha256 && createHash('md5').update(bytes).digest('hex')===artifact.md5,'RESTORE_PAYLOAD_BYTES_MISMATCH');
      verifyArtifactMetadata(await driveJson(artifact.driveId),artifact);
      const file=stage.file(target);await file.save(bytes,{resumable:false,contentType:'application/octet-stream',metadata:{cacheControl:'private,no-store',metadata:{proofOwner:receipt.receiptId,sha256:artifact.sha256,sourceGeneration:artifact.source.generation,scanStatus:'unverified-restoration'}},preconditionOpts:{ifGenerationMatch:0}});
      const [metadata]=await file.getMetadata();requireThat(Number(metadata.size)===artifact.size && metadata.metadata?.proofOwner===receipt.receiptId && metadata.metadata?.sha256===artifact.sha256,'RESTORE_STAGE_WRITE_MISMATCH');
      const [readback]=await stage.file(target,{generation:metadata.generation}).download({validation:'crc32c'});requireThat(readback.length===artifact.size && sha256(readback)===artifact.sha256,'RESTORE_STAGE_READBACK_MISMATCH');
      return String(metadata.generation);
    }
    for(const item of selected.files)await rehydrate(item.artifact,item.target);
    const fileGeneration=await rehydrate(selected.file,selected.fileTarget);
    phase='restore-import';
    const beforeImport=await firestore('/documents:listCollectionIds',{pageSize:1});requireThat((beforeImport.collectionIds||[]).length===0 && !beforeImport.nextPageToken,'PROOF_DATABASE_MUST_STILL_BE_EMPTY');
    // Intent already exists. An ambiguous POST is never retried or silently resumed.
    const operation=await firestore(':importDocuments',{inputUriPrefix:selected.inputUriPrefix});
    requireThat(typeof operation.name==='string' && operation.name.startsWith('projects/'+PROJECT+'/databases/'+receipt.database+'/operations/') && /^[A-Za-z0-9_-]{1,500}$/.test(operation.name.split('/').at(-1)),'RESTORE_OPERATION_SCOPE_INVALID');
    await saveControl('import-operation',{name:operation.name,database:receipt.database,startedAt:new Date().toISOString()});
    let result=operation;
    for(let poll=0;!result.done && poll<IMPORT_POLLS;poll++){await new Promise(resolve=>setTimeout(resolve,2000));result=await firestore('/operations/'+operation.name.split('/').at(-1));}
    requireThat(result.done===true && !result.error,'RESTORE_IMPORT_NOT_COMPLETE');
    phase='restore-probe-readback';
    const document=await firestore('/documents/'+receipt.probe.documentPath);
    requireThat(document.name==='projects/'+PROJECT+'/databases/'+receipt.database+'/documents/'+receipt.probe.documentPath,'RESTORE_PROBE_DATABASE_MISMATCH');verifyProbeFields(document.fields,receipt.probe.expectedFields);
    const [fileBytes]=await stage.file(selected.fileTarget,{generation:fileGeneration}).download({validation:'crc32c'});requireThat(fileBytes.length===receipt.file.size && sha256(fileBytes)===receipt.file.sha256,'RESTORE_OWNED_FILE_FINAL_MISMATCH');
    const proof={version:1,scope:'owned-probe-only',receiptId:receipt.receiptId,manifestSha256:receipt.manifest.sha256,database:receipt.database,importOperation:operation.name,importComplete:true,exportFiles:selected.files.length,exportBytes:receipt.expectedExportBytes,probeTypedValuesMatch:true,fileBytesAndSha256Match:true,newFileGeneration:fileGeneration,defaultDatabaseTouched:false,authRestorationVerified:false,totpRestorationVerified:false,applicationRestorationVerified:false,cleanup:'Root removes only this owned proof database/prefix after reviewing the proof.',finishedAt:new Date().toISOString()};
    await saveControl('proof',proof);
    console.log(encode({phase:'restore-proof-verified',receiptId:receipt.receiptId,database:receipt.database,probeTypedValuesMatch:true,fileBytesAndSha256Match:true,authRestorationVerified:false}).trim());
    return proof;
  } finally {watchdog.stop();}
}
const mode=process.argv[2]||'--plan';
if(process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
  if(mode==='--plan' && process.argv.length<=3)console.log(encode({scope:'Source-only controlled restore; no execution in plan mode',project:PROJECT,sourceDatabase:DATABASE,targetDatabase:'isp-restore-proof-<YYYYMMDD>-<8hex>, precreated empty and deny-client rules',isolatedPrefix:'gs://'+STAGING_BUCKET+'/restore-proofs/<receiptId>/',runtime:'Node22 attached single-task backupSA; no service-account key files',hardDeadlineSeconds:600,maxExportFiles:Math.min(MAX_FILES,Math.floor((MAX_REQUESTS-FIXED_HTTP_CALLS-IMPORT_POLLS)/3)-1),maxTotalBytes:MAX_BYTES,maxExplicitHTTPRequests:MAX_REQUESTS,receipt:'Explicit private JSON per docs/CONTROLLED-RESTORE-PROOF.md; two-hour expiry and owner acknowledgement',retry:'None. A durable intent prevents replay; reconcile ambiguous import manually.',budget:'Root admission US$0.40 for build/one proof; this is not a billing hard cap.',authRestore:'Not attempted or verified'}).trim());
  else if(mode==='--restore' && process.argv[3]==='--receipt' && process.argv.length===5)restore(process.argv[4]).catch(error=>{console.error(encode({phase:'restore-failed',code:/^[A-Z0-9_]+$/.test(error.safeCode||'')?error.safeCode:'RESTORE_INCOMPLETE',automaticRetryAllowed:false,ownedIntentRetained:true}).trim());process.exitCode=1;});
  else{console.error('Use --plan, or explicitly --restore --receipt <private receipt file>.');process.exitCode=1;}
}
