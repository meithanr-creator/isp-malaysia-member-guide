import assert from 'node:assert/strict';
import { loadBackupSdk } from './job.mjs';

// The exact production loader is exercised. Do not instantiate clients, initialize an app,
// read credentials, enumerate accounts, or invoke any provider method during this build check.
const sdk = await loadBackupSdk(), firestoreModule = await import('@google-cloud/firestore');
assert.equal(sdk.v1, firestoreModule.default.v1);
const functions = [
  ['FirestoreAdminClient', sdk.v1.FirestoreAdminClient],
  ['FirestoreAdminClient.exportDocuments', sdk.v1.FirestoreAdminClient.prototype.exportDocuments],
  ['FirestoreAdminClient.checkExportDocumentsProgress', sdk.v1.FirestoreAdminClient.prototype.checkExportDocumentsProgress],
  ['GoogleAuth', sdk.GoogleAuth],
  ['GoogleAuth.getClient', sdk.GoogleAuth.prototype.getClient],
  ['GoogleAuth.getProjectId', sdk.GoogleAuth.prototype.getProjectId],
  ['GoogleAuth.getCredentials', sdk.GoogleAuth.prototype.getCredentials],
  ['OAuth2Client', sdk.OAuth2Client],
  ['OAuth2Client.getAccessToken', sdk.OAuth2Client.prototype.getAccessToken],
  ['OAuth2Client.getTokenInfo', sdk.OAuth2Client.prototype.getTokenInfo],
  ['OAuth2Client.setCredentials', sdk.OAuth2Client.prototype.setCredentials],
  ['OAuth2Client.request', sdk.OAuth2Client.prototype.request],
  ['Storage', sdk.Storage],
  ['Storage.bucket', sdk.Storage.prototype.bucket],
  ['initializeApp', sdk.initializeApp],
  ['applicationDefault', sdk.applicationDefault],
  ['getAuth', sdk.getAuth],
];
for (const [name, value] of functions) assert.equal(typeof value, 'function', 'SDK contract missing: ' + name);
console.log(JSON.stringify({ contract: 'actual backup SDK imports and required method types', passed: functions.length + 1, providerMethodsInvoked: 0, clientsInitialized: 0, credentialsRead: 0, firestoreNamespace: 'default.v1', nodeMajor: process.versions.node.split('.')[0] }));
