// One focused live proof of the changed Firebase connection. No real member data or mail.
import { initializeApp as initializeAdmin, applicationDefault, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getAuth as adminAuth } from 'firebase-admin/auth';
import { getFirestore as adminFirestore, FieldValue } from 'firebase-admin/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { initializeAuth, inMemoryPersistence, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { initializeFirestore, memoryLocalCache, doc, getDocFromServer, updateDoc, serverTimestamp, collection, query, limit, getDocsFromServer } from 'firebase/firestore';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import assert from 'node:assert/strict';

const projectId = 'isp-planter-app';
assert.equal(process.env.GOOGLE_CLOUD_PROJECT, projectId);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, undefined);
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, undefined);
const admin = initializeAdmin({ projectId, credential: applicationDefault() });
const users = adminAuth(admin), store = adminFirestore(admin);
const privatePath = new URL('../audit/private/core-fixtures.json', import.meta.url);
const reportPath = new URL('../audit/core-connection-proof.json', import.meta.url);
const config = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId,
  appId: process.env.VITE_FIREBASE_APP_ID,
};
let clients = [], fixtures = [], outcomes = [];
function client(name) {
  const app = initializeApp(config, name);
  const auth = initializeAuth(app, { persistence: inMemoryPersistence });
  const db = initializeFirestore(app, { localCache: memoryLocalCache() });
  clients.push(app); return { auth, db };
}
async function check(name, run) {
  await run(); outcomes.push({ name, status: 'PASS' }); console.log('PASS ' + name);
}
async function denied(action) {
  await assert.rejects(action, error => error?.code === 'permission-denied');
}
async function cleanup() {
  fixtures = JSON.parse(await readFile(privatePath, 'utf8'));
  for (const row of fixtures) {
    assert.ok(/^isp-core-[0-9]+-(member|pending|admin)$/.test(row.uid));
    await store.doc('members/' + row.uid).delete();
    await store.doc('staff/' + row.uid).delete();
    await users.deleteUser(row.uid).catch(error => { if (error.code !== 'auth/user-not-found') throw error; });
  }
  await unlink(privatePath);
  console.log('CLEANUP: owned connection-proof identities and records removed');
}
try {
  if (process.argv.includes('--cleanup')) { await cleanup(); }
  else {
    await mkdir(new URL('../audit/private/', import.meta.url), { recursive: true });
    try { await readFile(privatePath); throw new Error('Existing owned fixtures must be cleaned first'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const run = Date.now();
    fixtures = ['member', 'pending', 'admin'].map(role => ({
      role, uid: `isp-core-${run}-${role}`, email: `isp-core-${run}-${role}@example.invalid`,
      password: randomBytes(24).toString('base64url') + 'aA1!',
    }));
    await writeFile(privatePath, JSON.stringify(fixtures), { mode: 0o600, flag: 'wx' });
    for (const row of fixtures) {
      await users.createUser({ uid: row.uid, email: row.email, password: row.password, emailVerified: true });
      await store.doc('members/' + row.uid).set({
        status: row.role === 'pending' ? 'pending' : 'approved', membershipReference: '000001',
        email: row.email, displayName: 'ISP connection check', company: '', branch: '', phone: '',
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (row.role === 'admin') {
        await users.setCustomUserClaims(row.uid, { admin: true });
        await store.doc('staff/' + row.uid).set({ active: true });
      }
    }
    const [member, pending, staff] = fixtures;
    const active = client('isp-core-member-' + run);
    await check('approved email/password sign-in and member read', async () => {
      const credential = await signInWithEmailAndPassword(active.auth, member.email, member.password);
      assert.equal(credential.user.emailVerified, true);
      const record = await getDocFromServer(doc(active.db, 'members', member.uid));
      assert.equal(record.data().status, 'approved');
      assert.equal(record.data().membershipReference, '000001');
    });
    await check('own profile save and fresh server read', async () => {
      await updateDoc(doc(active.db, 'members', member.uid), { company: 'ISP persisted connection proof', updatedAt: serverTimestamp() });
      const fresh = await getDocFromServer(doc(active.db, 'members', member.uid));
      assert.equal(fresh.data().company, 'ISP persisted connection proof');
    });
    await check('cross-member read and update denied', async () => {
      await denied(() => getDocFromServer(doc(active.db, 'members', pending.uid)));
      await denied(() => updateDoc(doc(active.db, 'members', pending.uid), { company: 'Denied', updatedAt: serverTimestamp() }));
    });
    await check('member status and administrator self-grant denied', async () => {
      await denied(() => updateDoc(doc(active.db, 'members', member.uid), { status: 'approved', admin: true, updatedAt: serverTimestamp() }));
      await denied(() => updateDoc(doc(active.db, 'staff', member.uid), { active: true }));
    });
    await check('sign-out clears identity and denies protected reads', async () => {
      await signOut(active.auth); assert.equal(active.auth.currentUser, null);
      await denied(() => getDocFromServer(doc(active.db, 'members', member.uid)));
    });
    await check('unapproved member update denied', async () => {
      const person = client('isp-core-pending-' + run);
      await signInWithEmailAndPassword(person.auth, pending.email, pending.password);
      const record = await getDocFromServer(doc(person.db, 'members', pending.uid));
      assert.equal(record.data().status, 'pending');
      await denied(() => updateDoc(doc(person.db, 'members', pending.uid), { company: 'Denied', updatedAt: serverTimestamp() }));
    });
    await check('administrator claim without TOTP cannot read member roster', async () => {
      const person = client('isp-core-admin-' + run);
      await signInWithEmailAndPassword(person.auth, staff.email, staff.password);
      await denied(() => getDocsFromServer(query(collection(person.db, 'members'), limit(25))));
    });
    console.log('Owned identities retained privately for one hosted visual check, then cleanup. No identity email sent.');
  }
} catch (error) {
  outcomes.push({ name: 'run', status: 'FAIL', code: error.code ?? error.name, message: String(error.message).slice(0, 300) });
  console.error('FAIL', error.code ?? error.name, String(error.message).slice(0, 300));
  process.exitCode = 1;
} finally {
  if (!process.argv.includes('--cleanup')) await writeFile(reportPath, JSON.stringify({
    projectId, timestamp: new Date().toISOString(), scope: 'single live Firebase connection proof; no legacy or demo checks',
    outcomes, complete: outcomes.length === 7 && outcomes.every(row => row.status === 'PASS'),
  }, null, 2));
  await Promise.all(clients.map(deleteApp));
  await store.terminate(); await deleteAdmin(admin);
}
