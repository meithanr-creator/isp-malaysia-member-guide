import { createHash } from 'node:crypto';
export const PROJECT = 'isp-planter-app';
export const DATABASE = '(default)';
export const SOURCE_BUCKET = 'isp-planter-app.firebasestorage.app';
export const STAGING_BUCKET = 'isp-planter-app-backup-staging-606528057827';
export const BACKUP_SERVICE_ACCOUNT = 'isp-backup@isp-planter-app.iam.gserviceaccount.com';
export const OWNER = 'meithan.r@gmail.com';
export const FOLDER = '1gjZnAk2RxfTGL40UINhz-lZ6sRt2g2Rh';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const APP_TAG = 'isp-planter-backup-v1';
export const MAX_USERS = 20000;
export const MAX_OBJECTS = 100000;
export const RETAIN_MANIFESTS = 30;
export function requireThat(condition, code) { if (!condition) throw Object.assign(new Error(code), { safeCode: code }); }
export function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
export function encode(value) { return JSON.stringify(value, null, 2) + '\n'; }
export function parseDriveSecret(raw) {
  let value; try { value = JSON.parse(raw); } catch { throw Object.assign(new Error('DRIVE_SECRET_INVALID'), { safeCode: 'DRIVE_SECRET_INVALID' }); }
  requireThat(value && Object.keys(value).sort().join(',') === 'clientId,clientSecret,folderId,ownerEmail,refreshToken,scope', 'DRIVE_SECRET_FIELDS_INVALID');
  requireThat(value.folderId === FOLDER && value.ownerEmail === OWNER && value.scope === DRIVE_SCOPE, 'DRIVE_SECRET_SCOPE_INVALID');
  for (const key of ['clientId', 'clientSecret', 'refreshToken']) requireThat(typeof value[key] === 'string' && value[key].length >= 8, 'DRIVE_SECRET_VALUE_INVALID');
  return value;
}
export function assertPrivateDriveFile(file, { folder = false } = {}) {
  requireThat(file && !file.trashed && file.shared === false && file.owners?.length === 1 && file.owners[0].emailAddress?.toLowerCase() === OWNER, 'DRIVE_PRIVATE_OWNER_REQUIRED');
  if (folder) requireThat(file.id === FOLDER && file.mimeType === 'application/vnd.google-apps.folder' && file.capabilities?.canAddChildren === true, 'DRIVE_FOLDER_INVALID');
  else requireThat(file.parents?.length === 1 && file.parents[0] === FOLDER, 'DRIVE_PARENT_INVALID');
  if (file.permissions) requireThat(file.permissions.every(permission => permission.type === 'user' && permission.role === 'owner' && permission.emailAddress?.toLowerCase() === OWNER), 'DRIVE_SHARING_REFUSED');
}
export function assertDriveScopes(scopes) { requireThat(Array.isArray(scopes) && scopes.length === 1 && scopes[0] === DRIVE_SCOPE, 'DRIVE_TOKEN_SCOPE_INVALID'); }
export function sourceKey(source) {
  requireThat(typeof source.bucket === 'string' && typeof source.name === 'string' && /^[0-9]+$/.test(String(source.generation)), 'SOURCE_GENERATION_INVALID');
  return sha256(source.bucket + '\0' + source.name + '\0' + String(source.generation));
}
export function serializeAuthUser(user) {
  const json = typeof user.toJSON === 'function' ? user.toJSON() : user;
  const output = {};
  for (const key of ['uid', 'email', 'emailVerified', 'disabled', 'displayName', 'photoURL', 'phoneNumber', 'metadata', 'providerData', 'customClaims', 'tokensValidAfterTime', 'passwordHash', 'passwordSalt']) if (json[key] !== undefined) output[key] = json[key];
  output.multiFactorMetadata = (json.multiFactor?.enrolledFactors || user.multiFactor?.enrolledFactors || []).map(factor => ({
    uid: factor.uid, factorId: factor.factorId, displayName: factor.displayName ?? null, enrollmentTime: factor.enrollmentTime ?? null,
    ...(factor.phoneNumber ? { phoneNumber: factor.phoneNumber } : {}),
  }));
  return output;
}
export function authCoverage(users, hashConfig) {
  const passwordUsers = users.filter(user => user.providerData?.some(provider => provider.providerId === 'password'));
  const missing = passwordUsers.filter(user => typeof user.passwordHash !== 'string' || !user.passwordHash || typeof user.passwordSalt !== 'string');
  const parametersPresent = hashConfig?.algorithm === 'SCRYPT' && typeof hashConfig.signerKey === 'string' && hashConfig.signerKey.length > 0 && typeof hashConfig.saltSeparator === 'string' && Number.isInteger(hashConfig.rounds) && hashConfig.rounds > 0 && Number.isInteger(hashConfig.memoryCost) && hashConfig.memoryCost > 0;
  return {
    users: users.length, passwordUsers: passwordUsers.length, passwordHashesPresent: passwordUsers.length - missing.length,
    passwordHashParametersPresent: parametersPresent, passwordExportCovered: missing.length === 0 && (passwordUsers.length === 0 || parametersPresent),
    passwordRestorationVerified: false, totpSecretsExported: false, totpRecovery: 'Re-enrollment required; no TOTP secret restoration is claimed.',
  };
}
export function buildManifest({ runId, date, startedAt, finishedAt, sourceVersion, exportInfo, artifacts, auth, storage, configuration }) {
  requireThat(/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(new Date(date + 'T00:00:00Z').valueOf()) && new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date && /^[a-f0-9]{40}$/.test(sourceVersion), 'MANIFEST_ID_INVALID');
  requireThat(exportInfo.complete === true && exportInfo.operation?.startsWith('projects/' + PROJECT + '/databases/' + DATABASE + '/operations/') && exportInfo.outputUriPrefix?.startsWith('gs://'), 'FIRESTORE_EXPORT_NOT_COMPLETE');
  requireThat(artifacts.length > 0 && artifacts.every(item => item.driveId && /^[a-f0-9]{64}$/.test(item.sha256) && /^[a-f0-9]{32}$/.test(item.md5) && Number.isSafeInteger(item.size) && item.size >= 0 && item.verified === true), 'PAYLOAD_READBACK_INCOMPLETE');
  const categories = new Set(artifacts.map(item => item.category));
  requireThat(['auth-accounts', 'source-config', 'storage-inventory', 'firestore-export'].every(kind => categories.has(kind)), 'BACKUP_COMPONENT_MISSING');
  requireThat(artifacts.filter(item => item.category === 'firestore-export').length === exportInfo.outputFiles && artifacts.filter(item => item.category === 'storage-object').length === storage.objects, 'BACKUP_OBJECT_COUNT_MISMATCH');
  const status = auth.passwordExportCovered ? 'COMPLETE' : 'PARTIAL';
  return {
    version: 1, kind: APP_TAG, status, runId, date, startedAt, finishedAt, sourceVersion,
    source: { project: PROJECT, database: DATABASE, storageBucket: storage.bucket },
    destination: { folderId: FOLDER, ownerEmail: OWNER, scope: DRIVE_SCOPE, private: true },
    consistency: 'Firestore managed export, Auth listing and Storage generation inventory have separate capture intervals. This is not an atomic cross-service snapshot.',
    firestore: exportInfo, auth, storage, configuration, artifacts,
    restore: { verified: false, targetPolicy: 'Restore only to a separately named database and isolated Storage prefix until operator review.', storagePolicy: 'New Storage generations invalidate old safety attestations. Clear download tokens; verify bytes and rebind or rescan under controlled restore before serving.' },
    retention: { dailyManifests: RETAIN_MANIFESTS, payloadDeletion: 'disabled; no referenced or orphan payload is deleted automatically' },
  };
}
export function retentionPlan(files) {
  const completed = files.filter(file => file.appProperties?.kind === 'manifest' && file.appProperties?.status === 'COMPLETE');
  for (const file of completed) {
    const date = file.appProperties.date;
    requireThat(typeof file.id === 'string' && file.id && /^\d{4}-\d{2}-\d{2}$/.test(date || '') && Number.isFinite(new Date(date + 'T00:00:00Z').valueOf()) && new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date, 'RETENTION_MANIFEST_ID_INVALID');
  }
  const retainedDates = [...new Set(completed.map(file => file.appProperties.date))].sort().reverse().slice(0, RETAIN_MANIFESTS);
  return { retainedDates, manifestIdsToTrash: completed.filter(file => !retainedDates.includes(file.appProperties.date)).map(file => file.id), payloadIdsToDelete: [] };
}
export function uploadOffset(status, range, total) {
  if (status === 200 || status === 201) return total;
  requireThat(status === 308, 'DRIVE_UPLOAD_STATUS_INVALID');
  if (!range) return 0;
  const match = /^bytes=0-(\d+)$/.exec(range); requireThat(match, 'DRIVE_UPLOAD_RANGE_INVALID');
  const next = Number(match[1]) + 1; requireThat(Number.isSafeInteger(next) && next > 0 && next <= total, 'DRIVE_UPLOAD_RANGE_INVALID');
  return next;
}

export function assertDriveCapacity(quota, bytes) {
  requireThat(quota && /^[0-9]+$/.test(quota.usage || '') && Number.isSafeInteger(bytes) && bytes >= 0, 'DRIVE_QUOTA_UNAVAILABLE');
  if (quota.limit !== undefined) { requireThat(/^[0-9]+$/.test(quota.limit), 'DRIVE_QUOTA_INVALID'); requireThat(BigInt(quota.limit) - BigInt(quota.usage) >= BigInt(bytes) + 1048576n, 'DRIVE_CAPACITY_LOW'); }
}
