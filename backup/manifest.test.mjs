import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OWNER, FOLDER, DRIVE_SCOPE, PROJECT, APP_TAG, parseDriveSecret, assertPrivateDriveFile,
  assertDriveScopes, assertDriveCapacity, sourceKey, serializeAuthUser, authCoverage, buildManifest, retentionPlan, uploadOffset,
} from './manifest.mjs';

const secret = { clientId: 'synthetic-client-id', clientSecret: 'synthetic-client-secret', refreshToken: 'synthetic-refresh-token', folderId: FOLDER, ownerEmail: OWNER, scope: DRIVE_SCOPE };
const privateFile = { id: 'fixture-file', shared: false, trashed: false, owners: [{ emailAddress: OWNER }], parents: [FOLDER] };
const hashConfig = { algorithm: 'SCRYPT', signerKey: 'synthetic-base64-key', saltSeparator: '', rounds: 8, memoryCost: 14 };
const passwordUser = { uid: 'fixture', email: 'fixture@example.invalid', providerData: [{ providerId: 'password' }], passwordHash: 'synthetic-hash', passwordSalt: 'synthetic-salt' };
const item = category => ({ category, driveId: category, sha256: 'a'.repeat(64), md5: 'b'.repeat(32), size: 3, verified: true });
const manifestInput = () => ({
  runId: 'owned-fixture-run', date: '2026-10-29', startedAt: '2026-10-29T00:00:00Z', finishedAt: '2026-10-29T00:05:00Z', sourceVersion: 'c'.repeat(40),
  exportInfo: { complete: true, operation: 'projects/' + PROJECT + '/databases/(default)/operations/fixture', outputUriPrefix: 'gs://isp-planter-app-backup-stage/firestore/fixture', outputFiles: 1 },
  artifacts: ['auth-accounts', 'source-config', 'storage-inventory', 'firestore-export'].map(item),
  auth: authCoverage([passwordUser], hashConfig), storage: { bucket: 'isp-planter-app.firebasestorage.app', objects: 0 }, configuration: { sourceFiles: 1 },
});

test('runtime secret accepts only the approved folder, owner, scope and exact fields', () => {
  assert.equal(parseDriveSecret(JSON.stringify(secret)).folderId, FOLDER);
  for (const altered of [{ ...secret, scope: 'https://www.googleapis.com/auth/drive' }, { ...secret, ownerEmail: 'other@example.invalid' }, { ...secret, folderId: 'another' }, { ...secret, extra: true }]) assert.throws(() => parseDriveSecret(JSON.stringify(altered)));
});
test('private owner/readback guard rejects sharing and foreign parents', () => {
  assert.doesNotThrow(() => assertPrivateDriveFile(privateFile));
  assert.throws(() => assertPrivateDriveFile({ ...privateFile, shared: true }));
  assert.throws(() => assertPrivateDriveFile({ ...privateFile, parents: ['foreign'] }));
  assert.throws(() => assertPrivateDriveFile({ ...privateFile, owners: [{ emailAddress: 'other@example.invalid' }] }));
  assert.doesNotThrow(() => assertDriveScopes([DRIVE_SCOPE]));
  assert.throws(() => assertDriveScopes([DRIVE_SCOPE, 'https://www.googleapis.com/auth/drive']));
});
test('source identity keeps large generation strings exact and distinguishes generations', () => {
  const source = { bucket: 'bucket', name: 'a/b', generation: '17932000000000001' };
  assert.equal(sourceKey(source), sourceKey({ ...source }));
  assert.notEqual(sourceKey(source), sourceKey({ ...source, generation: '17932000000000002' }));
  assert.throws(() => sourceKey({ ...source, generation: '../wrong' }));
});
test('Auth serialization retains supported password material but excludes unknown TOTP secrets', () => {
  const serialized = serializeAuthUser({ ...passwordUser, multiFactor: { enrolledFactors: [{ uid: 'factor', factorId: 'totp', displayName: 'Authenticator', enrollmentTime: '2026-10-29T00:00:00Z', secretKey: 'must-not-copy' }] }, refreshToken: 'must-not-copy' });
  assert.equal(serialized.passwordHash, passwordUser.passwordHash);
  assert.equal(serialized.passwordSalt, passwordUser.passwordSalt);
  assert.equal(serialized.multiFactorMetadata[0].factorId, 'totp');
  assert.equal(JSON.stringify(serialized).includes('must-not-copy'), false);
});
test('Auth coverage requires hashes only for password users and never claims restoration', () => {
  assert.equal(authCoverage([passwordUser, { uid: 'federated', providerData: [{ providerId: 'google.com' }] }], hashConfig).passwordExportCovered, true);
  assert.equal(authCoverage([{ ...passwordUser, passwordHash: undefined }], hashConfig).passwordExportCovered, false);
  assert.equal(authCoverage([passwordUser], null).passwordExportCovered, false);
  assert.equal(authCoverage([{ uid: 'federated', providerData: [{ providerId: 'google.com' }] }], null).passwordExportCovered, true);
  const covered = authCoverage([passwordUser], hashConfig);
  assert.equal(covered.passwordRestorationVerified, false); assert.equal(covered.totpSecretsExported, false);
});
test('complete manifest requires every verified component, count and owned successful export', () => {
  const value = manifestInput(), manifest = buildManifest(value);
  assert.equal(manifest.status, 'COMPLETE'); assert.equal(manifest.restore.verified, false);
  assert.equal(JSON.stringify(manifest).includes(secret.clientSecret), false);
  assert.equal(JSON.stringify(manifest).includes(hashConfig.signerKey), false);
  assert.throws(() => buildManifest({ ...value, exportInfo: { ...value.exportInfo, complete: false } }));
  assert.throws(() => buildManifest({ ...value, exportInfo: { ...value.exportInfo, operation: 'projects/foreign/databases/(default)/operations/x' } }));
  assert.throws(() => buildManifest({ ...value, artifacts: value.artifacts.slice(1) }));
  assert.throws(() => buildManifest({ ...value, storage: { ...value.storage, objects: 1 } }));
  assert.throws(() => buildManifest({ ...value, artifacts: value.artifacts.map((row, i) => i ? row : { ...row, verified: false }) }));
  assert.throws(() => buildManifest({ ...value, date: '2026-02-31' }));
  assert.equal(buildManifest({ ...value, auth: authCoverage([passwordUser], null) }).status, 'PARTIAL');
});
test('retention keeps complete recovery points and never deletes payloads', () => {
  const rows = Array.from({ length: 35 }, (_, i) => ({ id: String(i), appProperties: { kind: 'manifest', status: 'COMPLETE', date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10) } }));
  rows.push({ id: 'partial', appProperties: { kind: 'manifest', status: 'PARTIAL', date: '2026-12-31' } });
  const plan = retentionPlan(rows);
  assert.equal(plan.manifestIdsToTrash.length, 5); assert.equal(plan.manifestIdsToTrash.includes('partial'), false); assert.deepEqual(plan.payloadIdsToDelete, []);
});
test('resumable offsets require server acknowledgement and reject malformed ranges', () => {
  assert.equal(uploadOffset(308, undefined, 100), 0);
  assert.equal(uploadOffset(308, 'bytes=0-42', 100), 43);
  assert.equal(uploadOffset(200, undefined, 100), 100);
  assert.throws(() => uploadOffset(503, undefined, 100));
  assert.throws(() => uploadOffset(308, 'bytes=1-42', 100));
  assert.throws(() => uploadOffset(308, 'bytes=0-101', 100));
});

test('Drive capacity uses exact integer bytes and rejects insufficient or unknown space', () => {
  assert.doesNotThrow(() => assertDriveCapacity({usage:'100',limit:'2097252'},1048576));
  assert.throws(() => assertDriveCapacity({usage:'100',limit:'2097251'},1048576), /DRIVE_CAPACITY_LOW/);
  assert.doesNotThrow(() => assertDriveCapacity({usage:'90071992547409930000'},3));
  assert.throws(() => assertDriveCapacity({},3), /DRIVE_QUOTA_UNAVAILABLE/);
  assert.throws(() => assertDriveCapacity({usage:'1',limit:'not-a-number'},3), /DRIVE_QUOTA_INVALID/);
});
