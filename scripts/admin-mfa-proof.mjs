// Separate, single proof of administrator MFA. Reuses only owned disposable identities.
import { initializeApp, deleteApp } from 'firebase/app';
import { initializeAuth, inMemoryPersistence, signInWithEmailAndPassword, signOut, multiFactor, TotpMultiFactorGenerator, getMultiFactorResolver } from 'firebase/auth';
import { initializeFirestore, memoryLocalCache, collection, query, limit, getDocsFromServer } from 'firebase/firestore';
import { TOTP, Secret } from 'otpauth';
import { initializeApp as initializeAdmin, applicationDefault, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
assert.equal(process.env.GOOGLE_CLOUD_PROJECT, 'isp-planter-app');
const fixture = JSON.parse(await readFile(new URL('../audit/private/core-fixtures.json', import.meta.url), 'utf8')).find(row => row.role === 'admin');
assert.match(fixture.uid, /^isp-core-[0-9]+-admin$/);
const app = initializeApp({ apiKey: process.env.VITE_FIREBASE_API_KEY, authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN, projectId: 'isp-planter-app', appId: process.env.VITE_FIREBASE_APP_ID }, 'isp-admin-mfa-proof');
const auth = initializeAuth(app, { persistence: inMemoryPersistence });
const db = initializeFirestore(app, { localCache: memoryLocalCache() });
const outcomes = [];
let phase = 'fixture reset', failure = null;
const timing = {};
function totp(secret) {
  assert.equal(secret.hashingAlgorithm, 'SHA1');
  assert.equal(secret.codeLength, 6); assert.equal(secret.codeIntervalSeconds, 30);
  return new TOTP({ secret: Secret.fromBase32(secret.secretKey), algorithm: 'SHA1', digits: 6, period: 30 }).generate();
}
try {
  const admin = initializeAdmin({ projectId: 'isp-planter-app', credential: applicationDefault() });
  try {
    const user = await getAdminAuth(admin).getUser(fixture.uid);
    assert.equal(user.email, `${fixture.uid}@example.invalid`);
    assert.equal(user.customClaims.admin, true);
    await getAdminAuth(admin).updateUser(fixture.uid, { multiFactor: { enrolledFactors: null } });
    await getAdminAuth(admin).revokeRefreshTokens(fixture.uid);
  } finally { await deleteAdmin(admin); }
  phase = 'enrollment';
  const result = await signInWithEmailAndPassword(auth, fixture.email, fixture.password);
  const session = await multiFactor(result.user).getSession();
  const secret = await TotpMultiFactorGenerator.generateSecret(session);
  timing.enrollmentStep = Math.floor(Date.now() / 30000);
  const enrollmentCode = totp(secret);
  await multiFactor(result.user).enroll(TotpMultiFactorGenerator.assertionForEnrollment(secret, enrollmentCode), 'Disposable ISP proof');
  await result.user.reload();
  const enrolled = multiFactor(result.user).enrolledFactors.find(row => row.factorId === 'totp');
  assert.ok(enrolled);
  outcomes.push('TOTP enrollment accepted by Firebase');
  phase = 'password challenge';
  await signOut(auth);
  let resolver;
  try { await signInWithEmailAndPassword(auth, fixture.email, fixture.password); }
  catch (error) {
    assert.equal(error.code, 'auth/multi-factor-auth-required'); resolver = getMultiFactorResolver(auth, error);
  }
  assert.ok(resolver); outcomes.push('fresh password sign-in requires second factor');
  const factor = resolver.hints.find(row => row.factorId === TotpMultiFactorGenerator.FACTOR_ID);
  assert.ok(factor);
  assert.equal(factor.uid, enrolled.uid);
  phase = 'TOTP sign-in';
  while (Math.floor(Date.now() / 30000) <= timing.enrollmentStep) {
    await new Promise(resolve => setTimeout(resolve, Math.min(1000, 30000 - Date.now() % 30000 + 100)));
  }
  timing.signInStep = Math.floor(Date.now() / 30000);
  const signInCode = totp(secret);
  timing.distinctCodes = signInCode !== enrollmentCode;
  assert.ok(timing.signInStep > timing.enrollmentStep);
  await resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(factor.uid, signInCode));
  phase = 'bounded roster authorization';
  const token = await auth.currentUser.getIdTokenResult();
  assert.equal(token.claims.admin, true); assert.equal(token.claims.firebase.sign_in_second_factor, 'totp');
  const roster = await getDocsFromServer(query(collection(db, 'members'), limit(25)));
  assert.ok(roster.size > 0 && roster.size <= 25);
  outcomes.push('TOTP-authenticated active administrator can read bounded roster');
  await assert.rejects(() => getDocsFromServer(query(collection(db, 'members'), limit(26))), error => error.code === 'permission-denied');
  outcomes.push('roster requests above 25 denied');
  await signOut(auth);
  for (const row of outcomes) console.log('PASS ' + row);
} catch (error) {
  failure = { phase, code: error.code ?? error.name, message: String(error.message).slice(0, 240) };
  console.error('FAIL', error.code ?? error.name, String(error.message).slice(0, 240));
  process.exitCode = 1;
} finally {
  await writeFile(new URL('../audit/admin-mfa-proof.json', import.meta.url), JSON.stringify({
    timestamp: new Date().toISOString(), projectId: 'isp-planter-app', outcomes, timing, failure,
    complete: outcomes.length === 4, scope: 'one owned synthetic administrator; no real users or mail',
  }, null, 2));
  await deleteApp(app);
}
