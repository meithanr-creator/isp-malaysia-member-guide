import { createHash, randomUUID } from 'node:crypto';
import {
  PROJECT, DATABASE, SOURCE_BUCKET, STAGING_BUCKET, BACKUP_SERVICE_ACCOUNT, OWNER, FOLDER, DRIVE_SCOPE, APP_TAG, MAX_USERS, MAX_OBJECTS,
  requireThat, sha256, encode, parseDriveSecret, assertPrivateDriveFile, assertDriveScopes,
  sourceKey, serializeAuthUser, authCoverage, buildManifest, retentionPlan, uploadOffset, assertDriveCapacity,
} from './manifest.mjs';

import { startProcessWatchdog } from './watchdog.mjs';
import { readSourceArchive } from './source-closure.mjs';

export async function loadBackupSdk() {
  const [{ GoogleAuth, OAuth2Client }, { Storage }, { default: firestore }, { initializeApp, applicationDefault }, { getAuth }] = await Promise.all([import('google-auth-library'), import('@google-cloud/storage'), import('@google-cloud/firestore'), import('firebase-admin/app'), import('firebase-admin/auth')]);
  // Firestore9.4.0 defines v1 as a CommonJS module.exports getter; use its exact default namespace.
  return { GoogleAuth, OAuth2Client, Storage, v1: firestore.v1, initializeApp, applicationDefault, getAuth };
}

const CHUNK = 8 * 1024 * 1024;
const FILE_FIELDS = 'id,name,mimeType,size,md5Checksum,sha256Checksum,parents,owners(emailAddress),shared,trashed,appProperties';
let watchdog, currentPhase = 'plan';
function timeLeft() { return watchdog.remaining(); }
function log(phase, fields = {}) { console.log(JSON.stringify({ kind: APP_TAG, phase, ...fields })); }
function configuredBucket(name, value) { requireThat(typeof value === 'string' && value.startsWith(PROJECT) && /^[a-z0-9_.-]{3,222}$/.test(value), name + '_INVALID'); return value; }
function describe(file, metadata) {
  return { bucket: file.bucket.name, name: file.name, generation: String(metadata.generation), metageneration: String(metadata.metageneration), size: Number(metadata.size), contentType: metadata.contentType || 'application/octet-stream', md5Hash: metadata.md5Hash || null, crc32c: metadata.crc32c || null };
}
async function readJson(file) { try { const [bytes] = await file.download(); return JSON.parse(bytes.toString('utf8')); } catch (error) { if (error.code === 404) return null; throw error; } }
async function saveJson(file, value, generation = 0) {
  await file.save(encode(value), { resumable: false, contentType: 'application/json', metadata: { cacheControl: 'private, no-store' }, preconditionOpts: { ifGenerationMatch: generation } });
  const [metadata] = await file.getMetadata(); return metadata.generation;
}
function exactFile(storage, source) { return storage.bucket(source.bucket).file(source.name, { generation: source.generation }); }
async function digestSource(storage, source) {
  const sha = createHash('sha256'), md5 = createHash('md5'); let size = 0;
  for await (const chunk of exactFile(storage, source).createReadStream({ validation: 'crc32c' })) { timeLeft(); size += chunk.length; sha.update(chunk); md5.update(chunk); }
  requireThat(size === source.size, 'SOURCE_SIZE_CHANGED');
  return { sha256: sha.digest('hex'), md5: md5.digest('hex'), size };
}
async function sourceRange(storage, source, start, end) {
  const chunks = []; let size = 0;
  for await (const chunk of exactFile(storage, source).createReadStream({ start, end, validation: false })) { timeLeft(); chunks.push(chunk); size += chunk.length; requireThat(size <= CHUNK, 'UPLOAD_CHUNK_EXCEEDED'); }
  requireThat(size === end - start + 1, 'SOURCE_RANGE_INCOMPLETE');
  return Buffer.concat(chunks);
}
async function stageBytes(stage, category, bytes) {
  const digest = sha256(bytes), file = stage.file('generated/' + category + '/' + digest + '.json');
  try { await file.save(bytes, { resumable: false, contentType: 'application/json', metadata: { cacheControl: 'private, no-store', metadata: { sha256: digest } }, preconditionOpts: { ifGenerationMatch: 0 } }); }
  catch (error) { if (error.code !== 412) throw error; }
  const [metadata] = await file.getMetadata(); requireThat(metadata.metadata?.sha256 === digest && Number(metadata.size) === bytes.length, 'STAGED_GENERATION_MISMATCH');
  return { ...describe(file, metadata), category };
}
async function sourceArchive() { return readSourceArchive('/app/source', process.env.ISP_SOURCE_VERSION); }
class DriveCopy {
  constructor(oauth, stage, storage) { this.oauth = oauth; this.stage = stage; this.storage = storage; }
  async request(url, options = {}) {
    timeLeft();
    try { return await this.oauth.request({ url, timeout: Math.min(60000, timeLeft()), retry: false, ...options }); }
    catch (error) { if (error.response?.data?.error?.errors?.some(item => item.reason === 'storageQuotaExceeded')) throw Object.assign(Error('DRIVE_QUOTA_EXCEEDED'), { safeCode: 'DRIVE_QUOTA_EXCEEDED' }); throw error; }
  }
  async assertSpace(bytes) {
    const result = (await this.request('https://www.googleapis.com/drive/v3/about?fields=storageQuota(limit,usage)')).data.storageQuota;
    assertDriveCapacity(result, bytes);
  }
  async get(id) {
    try { return (await this.request('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?fields=' + encodeURIComponent(FILE_FIELDS))).data; }
    catch (error) { if (error.response?.status === 404) return null; throw error; }
  }
  async list(query) {
    const files = []; let pageToken;
    do {
      const url = new URL('https://www.googleapis.com/drive/v3/files'); url.searchParams.set('q', query); url.searchParams.set('spaces', 'drive'); url.searchParams.set('pageSize', '1000'); url.searchParams.set('fields', 'nextPageToken,files(' + FILE_FIELDS + ')'); if (pageToken) url.searchParams.set('pageToken', pageToken);
      const result = (await this.request(url.href)).data; files.push(...result.files); pageToken = result.nextPageToken;
    } while (pageToken);
    return files;
  }
  async find(key) {
    const rows = await this.list("'" + FOLDER + "' in parents and trashed=false and appProperties has { key='app' and value='" + APP_TAG + "' } and appProperties has { key='key' and value='" + key + "' }");
    requireThat(rows.length <= 1, 'DUPLICATE_DRIVE_PAYLOAD'); return rows[0] || null;
  }
  verified(file, key, checksum, source) {
    assertPrivateDriveFile(file);
    requireThat(file.appProperties?.app === APP_TAG && file.appProperties?.key === key && file.appProperties?.sha256 === checksum.sha256 && file.md5Checksum === checksum.md5 && Number(file.size) === checksum.size, 'DRIVE_CHECKSUM_MISMATCH');
    if (file.sha256Checksum) requireThat(file.sha256Checksum === checksum.sha256, 'DRIVE_SHA256_MISMATCH');
    return { driveId: file.id, source: { bucket: source.bucket, name: source.name, generation: source.generation, metageneration: source.metageneration }, category: source.category || 'storage-object', size: checksum.size, sha256: checksum.sha256, md5: checksum.md5, verified: true };
  }
  async copy(source, properties = {}) {
    const key = sourceKey(source), old = await this.find(key);
    if (old) {
      const checksum = { sha256: old.appProperties?.sha256, md5: old.md5Checksum, size: source.size };
      requireThat(/^[a-f0-9]{64}$/.test(checksum.sha256 || '') && /^[a-f0-9]{32}$/.test(checksum.md5 || '') && old.appProperties?.generation === source.generation && old.appProperties?.crc32c === (source.crc32c || ''), 'DRIVE_DEDUP_PROVENANCE_INVALID');
      if (source.md5Hash) requireThat(Buffer.from(source.md5Hash, 'base64').toString('hex') === checksum.md5, 'DRIVE_DEDUP_MD5_MISMATCH');
      return this.verified(old, key, checksum, source);
    }
    const checkpointFile = this.stage.file('upload-state/' + key + '.json');
    let state = await readJson(checkpointFile), stateGeneration = state ? (await checkpointFile.getMetadata())[0].generation : 0;
    const save = async () => { stateGeneration = await saveJson(checkpointFile, state, stateGeneration); };
    if (!state) {
      await this.assertSpace(source.size);
      const generated = (await this.request('https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files')).data;
      const checksum = await digestSource(this.storage, source);
      state = { version: 1, key, driveId: generated.ids[0], source, checksum, sessionUrl: null }; await save();
    }
    requireThat(state.key === key && state.source.generation === source.generation && sourceKey(state.source) === key, 'UPLOAD_CHECKPOINT_MISMATCH');
    const completed = await this.get(state.driveId);
    if (completed) return this.verified(completed, key, state.checksum, source);
    if (source.size === 0) {
      const boundary = 'isp-backup-' + randomUUID(), metadata = { id: state.driveId, name: 'payload-' + key + '.bin', mimeType: 'application/octet-stream', parents: [FOLDER], appProperties: { app: APP_TAG, key, sha256: state.checksum.sha256, generation: source.generation, crc32c: source.crc32c || '', ...properties } };
      const body = Buffer.from('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) + '\r\n--' + boundary + '\r\nContent-Type: application/octet-stream\r\n\r\n\r\n--' + boundary + '--\r\n');
      await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=' + encodeURIComponent(FILE_FIELDS), { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, data: body });
      return this.verified(await this.get(state.driveId), key, state.checksum, source);
    }
    if (!state.sessionUrl) {
      const url = new URL('https://www.googleapis.com/upload/drive/v3/files'); url.searchParams.set('uploadType', 'resumable'); url.searchParams.set('fields', FILE_FIELDS);
      const result = await this.request(url.href, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(source.size) }, data: { id: state.driveId, name: properties.kind === 'manifest' ? 'manifest-' + properties.date + '.json' : 'payload-' + key + '.bin', mimeType: 'application/octet-stream', parents: [FOLDER], appProperties: { app: APP_TAG, key, sha256: state.checksum.sha256, generation: source.generation, crc32c: source.crc32c || '', ...properties } } });
      state.sessionUrl = result.headers.get?.('location') || result.headers.location;
      const session = new URL(state.sessionUrl); requireThat(session.protocol === 'https:' && session.hostname === 'www.googleapis.com' && session.pathname.startsWith('/upload/drive/'), 'DRIVE_SESSION_TARGET_INVALID'); await save();
    }
    const status = await this.request(state.sessionUrl, { method: 'PUT', headers: { 'Content-Length': '0', 'Content-Range': 'bytes */' + source.size }, validateStatus: () => true });
    if (status.status === 404) { state.sessionUrl = null; await save(); throw Object.assign(Error('DRIVE_SESSION_EXPIRED'), { safeCode: 'DRIVE_SESSION_EXPIRED' }); }
    let offset = uploadOffset(status.status, status.headers.get?.('range') || status.headers.range, source.size);
    if (offset < source.size) await this.assertSpace(source.size - offset);
    while (offset < source.size) {
      const end = Math.min(offset + CHUNK, source.size) - 1, bytes = await sourceRange(this.storage, source, offset, end);
      const result = await this.request(state.sessionUrl, { method: 'PUT', headers: { 'Content-Length': String(bytes.length), 'Content-Type': 'application/octet-stream', 'Content-Range': 'bytes ' + offset + '-' + end + '/' + source.size }, data: bytes, responseType: 'json', validateStatus: () => true });
      const next = uploadOffset(result.status, result.headers.get?.('range') || result.headers.range, source.size); requireThat(next > offset, 'DRIVE_UPLOAD_DID_NOT_PROGRESS'); offset = next;
    }
    const file = await this.get(state.driveId); requireThat(file, 'DRIVE_UPLOAD_READBACK_MISSING');
    return this.verified(file, key, state.checksum, source);
  }
}
export async function run() {
  requireThat(process.versions.node.split('.')[0] === '22' && process.env.CLOUD_RUN_JOB && process.env.CLOUD_RUN_EXECUTION && process.env.CLOUD_RUN_TASK_COUNT === '1' && process.env.CLOUD_RUN_TASK_INDEX === '0' && process.env.CLOUD_RUN_TASK_ATTEMPT === '0' && !process.env.GOOGLE_APPLICATION_CREDENTIALS, 'ATTACHED_CLOUD_RUN_IDENTITY_REQUIRED');
  watchdog = startProcessWatchdog(() => currentPhase);
  try { return await backup(); } finally { watchdog.stop(); }
}
async function backup() {
  currentPhase = 'identity-preflight';
  const sourceVersion = process.env.ISP_SOURCE_VERSION, date = process.env.ISP_BACKUP_DATE || new Date().toISOString().slice(0, 10);
  requireThat(/^[a-f0-9]{40}$/.test(sourceVersion || '') && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(new Date(date + 'T00:00:00Z').valueOf()) && new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date, 'BACKUP_IDENTITY_INVALID');
  const sourceBucket = configuredBucket('SOURCE_BUCKET', process.env.ISP_BACKUP_SOURCE_BUCKET), stageBucket = configuredBucket('STAGING_BUCKET', process.env.ISP_BACKUP_STAGING_BUCKET);
  requireThat(sourceBucket === SOURCE_BUCKET && stageBucket === STAGING_BUCKET && sourceBucket !== stageBucket, 'EXACT_BACKUP_BUCKETS_REQUIRED');
  const secret = parseDriveSecret(process.env.ISP_DRIVE_BACKUP || '');
  const { GoogleAuth, OAuth2Client, Storage, v1, initializeApp, applicationDefault, getAuth } = await loadBackupSdk();
  const google = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }), adc = await google.getClient(), storage = new Storage({ projectId: PROJECT, retryOptions: { autoRetry: false } }), stage = storage.bucket(stageBucket);
  requireThat(await google.getProjectId() === PROJECT, 'ATTACHED_PROJECT_MISMATCH');
  requireThat((await google.getCredentials()).client_email === BACKUP_SERVICE_ACCOUNT, 'ATTACHED_SERVICE_ACCOUNT_MISMATCH');
  const [bucketMetadata] = await stage.getMetadata();
  requireThat(bucketMetadata.iamConfiguration?.uniformBucketLevelAccess?.enabled === true && bucketMetadata.iamConfiguration?.publicAccessPrevention === 'enforced', 'STAGING_BUCKET_NOT_PRIVATE');
  currentPhase = 'drive-preflight';
  const oauth = new OAuth2Client(secret.clientId, secret.clientSecret); oauth.setCredentials({ refresh_token: secret.refreshToken });
  const access = await oauth.getAccessToken(); requireThat(access.token, 'DRIVE_ACCESS_UNAVAILABLE'); assertDriveScopes((await oauth.getTokenInfo(access.token)).scopes);
  const drive = new DriveCopy(oauth, stage, storage);
  const about = (await drive.request('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)')).data; requireThat(about.user?.emailAddress?.toLowerCase() === OWNER, 'DRIVE_IDENTITY_MISMATCH');
  const folder = (await drive.request('https://www.googleapis.com/drive/v3/files/' + FOLDER + '?fields=id,mimeType,trashed,shared,owners(emailAddress),permissions(type,role,emailAddress),capabilities(canAddChildren)')).data; assertPrivateDriveFile(folder, { folder: true });
  const runId = date + '-' + randomUUID(), leaseFile = stage.file('control/job-lease.json'); let leaseGeneration;
  try { leaseGeneration = await saveJson(leaseFile, { runId, expiresAt: new Date(Date.now() + 1860000).toISOString() }, 0); }
  catch (error) {
    if (error.code !== 412) throw error;
    const old = await readJson(leaseFile), [metadata] = await leaseFile.getMetadata(); requireThat(Date.parse(old?.expiresAt) < Date.now(), 'BACKUP_ALREADY_RUNNING');
    await leaseFile.delete({ ifGenerationMatch: metadata.generation }); leaseGeneration = await saveJson(leaseFile, { runId, expiresAt: new Date(Date.now() + 1860000).toISOString() }, 0);
  }
  try {
    const stateFile = stage.file('control/daily-' + date + '.json'); let state = await readJson(stateFile), stateGeneration = state ? (await stateFile.getMetadata())[0].generation : 0;
    if (!state) state = { version: 1, project: PROJECT, database: DATABASE, date, runId, startedAt: new Date().toISOString(), sourceVersion, exportIntent: null, operation: null, exportInfo: null, generated: [], auth: null, inventory: null, complete: false };
    requireThat(state.project === PROJECT && state.database === DATABASE && state.date === date && state.sourceVersion === sourceVersion, 'DAILY_CHECKPOINT_MISMATCH');
    const saveState = async () => { stateGeneration = await saveJson(stateFile, state, stateGeneration); };
    if (state.complete) { log('already-complete', { date }); return; }
    await saveState(); log('started', { date });
    initializeApp({ credential: applicationDefault(), projectId: PROJECT });
    const auth = getAuth(), configUrl = 'https://identitytoolkit.googleapis.com/admin/v2/projects/' + PROJECT + '/config';
    currentPhase = 'auth-export';
    if (!state.auth || !state.auth.passwordExportCovered) {
      const capturedAt = new Date().toISOString(), config = (await adc.request({ url: configUrl, method: 'GET', retry: false })).data, users = []; let pageToken;
      do { timeLeft(); const page = await auth.listUsers(1000, pageToken); users.push(...page.users.map(serializeAuthUser)); requireThat(users.length <= MAX_USERS, 'AUTH_INVENTORY_LIMIT_REACHED'); pageToken = page.pageToken; } while (pageToken);
      users.sort((a, b) => a.uid.localeCompare(b.uid));
      const afterConfig = (await adc.request({ url: configUrl, method: 'GET', retry: false })).data;
      requireThat(sha256(encode(config.signIn?.hashConfig || null)) === sha256(encode(afterConfig.signIn?.hashConfig || null)), 'AUTH_HASH_CONFIG_CHANGED');
      const coverage = authCoverage(users, config.signIn?.hashConfig), source = await stageBytes(stage, 'auth-accounts', Buffer.from(encode({ users, hashConfig: config.signIn?.hashConfig || null, supportedConfiguration: { authorizedDomains: config.authorizedDomains, mfa: config.mfa, passwordPolicyConfig: config.passwordPolicyConfig, emailPrivacyConfig: config.emailPrivacyConfig } })));
      state.auth = { ...coverage, scope: 'project default tenant', capturedAt, capturedUntil: new Date().toISOString() }; state.generated = state.generated.filter(item => item.category !== 'auth-accounts'); state.generated.push(source); await saveState();
    }
    currentPhase = 'firestore-export';
    const admin = new v1.FirestoreAdminClient({ projectId: PROJECT }), exportOwnerFile = stage.file('control/export-owner.json');
    let exportOwner = await readJson(exportOwnerFile), exportOwnerGeneration = exportOwner ? (await exportOwnerFile.getMetadata())[0].generation : 0;
    if (exportOwner && exportOwner.date !== date) {
      const prior = await readJson(stage.file('control/daily-' + exportOwner.date + '.json'));
      requireThat(prior?.exportInfo?.complete === true && prior.runId === exportOwner.runId, 'PREVIOUS_EXPORT_REQUIRES_OPERATOR_REVIEW');
      await exportOwnerFile.delete({ ifGenerationMatch: exportOwnerGeneration }); exportOwner = null; exportOwnerGeneration = 0;
    }
    if (!state.exportInfo) {
      if (!state.exportIntent) { state.exportIntent = 'gs://' + stageBucket + '/firestore/' + date + '/' + state.runId; await saveState(); }
      else requireThat(state.operation, 'EXPORT_START_AMBIGUOUS_OPERATOR_REVIEW_REQUIRED');
      if (!exportOwner) { exportOwner = { date, runId: state.runId, prefix: state.exportIntent }; exportOwnerGeneration = await saveJson(exportOwnerFile, exportOwner, 0); }
      requireThat(exportOwner.date === date && exportOwner.runId === state.runId && exportOwner.prefix === state.exportIntent, 'EXPORT_OWNER_MISMATCH');
      if (!state.operation) {
        const [operation] = await admin.exportDocuments({ name: 'projects/' + PROJECT + '/databases/' + DATABASE, outputUriPrefix: state.exportIntent }, { retry: null, timeout: 60000 });
        state.operation = operation.name; await saveState();
      }
      requireThat(state.operation.startsWith('projects/' + PROJECT + '/databases/' + DATABASE + '/operations/'), 'EXPORT_OPERATION_PROJECT_MISMATCH');
      const operation = await admin.checkExportDocumentsProgress(state.operation), [response] = await operation.promise();
      const output = response.outputUriPrefix; requireThat(output === state.exportIntent || output.startsWith(state.exportIntent + '/'), 'EXPORT_PREFIX_MISMATCH');
      state.exportInfo = { complete: true, operation: state.operation, requestedAt: state.startedAt, completedAt: new Date().toISOString(), outputUriPrefix: output, collectionGroups: 'all' }; await saveState();
      await exportOwnerFile.delete({ ifGenerationMatch: exportOwnerGeneration });
    }
    currentPhase = 'storage-inventory';
    if (!state.inventory) {
      const capturedAt = new Date().toISOString(), objects = []; let pageToken;
      do { timeLeft(); const [files, next] = await storage.bucket(sourceBucket).getFiles({ versions: true, autoPaginate: false, maxResults: 500, ...(pageToken ? { pageToken } : {}) }); for (const file of files) { const metadata = file.metadata?.generation ? file.metadata : (await file.getMetadata())[0]; objects.push({ ...describe(file, metadata), originalMetadata: metadata }); requireThat(objects.length <= MAX_OBJECTS, 'STORAGE_INVENTORY_LIMIT_REACHED'); } pageToken = next?.pageToken; } while (pageToken);
      const sourceBucketMetadata = (await storage.bucket(sourceBucket).getMetadata())[0];
      const source = await stageBytes(stage, 'storage-inventory', Buffer.from(encode({ bucket: sourceBucket, bucketMetadata: sourceBucketMetadata, objects })));
      state.inventory = { bucket: sourceBucket, capturedAt, capturedUntil: new Date().toISOString(), objects: objects.length, source }; state.generated.push(source); await saveState();
    }
    if (!state.sourceArchive) { const archive = await sourceArchive(); requireThat(archive.sourceVersion === sourceVersion, 'SOURCE_VERSION_MISMATCH'); const source = await stageBytes(stage, 'source-config', Buffer.from(encode(archive))); state.sourceArchive = { files: archive.files.length, source }; state.generated.push(source); await saveState(); }
    const outputUrl = new URL(state.exportInfo.outputUriPrefix), exportPrefix = outputUrl.pathname.replace(/^\//, '').replace(/\/$/, '') + '/', exportFiles = []; let exportPage;
    do { const [files, next] = await stage.getFiles({ prefix: exportPrefix, autoPaginate: false, maxResults: 500, ...(exportPage ? { pageToken: exportPage } : {}) }); for (const file of files) { const metadata = file.metadata?.generation ? file.metadata : (await file.getMetadata())[0]; exportFiles.push({ ...describe(file, metadata), category: 'firestore-export' }); } exportPage = next?.pageToken; } while (exportPage);
    requireThat(exportFiles.length > 0 && exportFiles.filter(file => file.name.endsWith('.overall_export_metadata')).length === 1, 'FIRESTORE_EXPORT_OUTPUT_INCOMPLETE');
    const inventory = JSON.parse((await exactFile(storage, state.inventory.source).download())[0].toString('utf8')), artifacts = [];
    currentPhase = 'drive-copy';
    for (const source of [...state.generated, ...exportFiles, ...inventory.objects]) { timeLeft(); artifacts.push(await drive.copy(source)); }
    currentPhase = 'manifest-commit';
    const manifest = buildManifest({ runId: state.runId, date, startedAt: state.startedAt, finishedAt: new Date().toISOString(), sourceVersion, exportInfo: { ...state.exportInfo, outputFiles: exportFiles.length }, artifacts, auth: state.auth, storage: { bucket: sourceBucket, objects: state.inventory.objects, capturedAt: state.inventory.capturedAt, capturedUntil: state.inventory.capturedUntil, versions: true }, configuration: { sourceFiles: state.sourceArchive.files, rulesAndIndexesIncluded: true, configurationBasis: 'image source files; not a live deployed rules/index verification', deployedConfigurationVerified: false, credentialSecretsIncluded: false } });
    const source = await stageBytes(stage, 'daily-manifest', Buffer.from(encode(manifest))), saved = await drive.copy(source, { kind: 'manifest', date, status: manifest.status });
    requireThat(saved.verified, 'MANIFEST_READBACK_INCOMPLETE'); state.manifest = saved; state.complete = manifest.status === 'COMPLETE'; await saveState();
    if (state.complete) {
      currentPhase = 'manifest-retention';
      const all = await drive.list("'" + FOLDER + "' in parents and trashed=false and appProperties has { key='app' and value='" + APP_TAG + "' } and appProperties has { key='kind' and value='manifest' }");
      const plan = retentionPlan(all); for (const id of plan.manifestIdsToTrash) { const file = await drive.get(id); assertPrivateDriveFile(file); requireThat(file.appProperties?.app === APP_TAG && file.appProperties?.kind === 'manifest' && file.appProperties?.status === 'COMPLETE' && !plan.retainedDates.includes(file.appProperties?.date), 'RETENTION_TARGET_INVALID'); await drive.request('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id), { method: 'PATCH', data: { trashed: true } }); }
    }
    log('finished', { date, status: manifest.status, payloads: artifacts.length, passwordExportCovered: state.auth.passwordExportCovered, restoreVerified: false });
    requireThat(state.complete, 'AUTH_EXPORT_COVERAGE_INCOMPLETE');
  } finally { if (leaseGeneration) await leaseFile.delete({ ifGenerationMatch: leaseGeneration }).catch(() => {}); }
}
const mode = process.argv[2] || '--plan';
if (process.argv[1]?.endsWith('/job.mjs') || process.argv[1]?.endsWith('\\job.mjs')) {
  if (mode === '--plan' && process.argv.length <= 3) console.log(encode({ project: PROJECT, database: DATABASE, serviceAccount: BACKUP_SERVICE_ACCOUNT, sourceBucket: SOURCE_BUCKET, stagingBucket: STAGING_BUCKET, driveOwner: OWNER, folderId: FOLDER, scope: DRIVE_SCOPE, runtime: 'Node22 attached Cloud Run Job identity', taskTimeoutSeconds: 1800, taskCount: 1, parallelism: 1, maxRetries: 0, requiredEnvironment: ['ISP_DRIVE_BACKUP(secret JSON)', 'ISP_BACKUP_STAGING_BUCKET', 'ISP_BACKUP_SOURCE_BUCKET', 'ISP_SOURCE_VERSION'] }).trim());
  else if (mode === '--run' && process.argv.length === 3) run().catch(error => { log('failed', { failedPhase: currentPhase, errorClass: ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'GaxiosError', 'ApiError', 'FirebaseError', 'GoogleError'].includes(error?.name) ? error.name : 'UnknownError', providerStatus: Number.isInteger(error.response?.status) ? error.response.status : Number.isInteger(error.code) ? error.code : null, code: /^[A-Z0-9_]+$/.test(error.safeCode || '') ? error.safeCode : 'BACKUP_INCOMPLETE', priorCompleteBackupModified: false }); process.exitCode = 1; });
  else { log('refused', { code: 'USE_PLAN_OR_RUN' }); process.exitCode = 1; }
}
