import { FirebaseError, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserSessionPersistence, EmailAuthProvider, getIdTokenResult, getMultiFactorResolver,
  initializeAuth, multiFactor, onIdTokenChanged, reauthenticateWithCredential,
  sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut,
  TotpMultiFactorGenerator, type Auth, type MultiFactorError, type MultiFactorResolver,
  type TotpSecret, type User,
} from 'firebase/auth';
import {
  collection, doc, documentId, getDocFromServer, getDocsFromServer, initializeFirestore,
  limit, memoryLocalCache, orderBy, query, serverTimestamp, startAfter, updateDoc,
  type DocumentData, type Firestore, type QueryDocumentSnapshot,
} from 'firebase/firestore';

export interface Member {
  uid: string;
  status: 'pending' | 'approved' | 'suspended';
  membershipReference: string | null;
  email: string;
  displayName: string;
  company: string;
  branch: string;
  phone: string;
}
export interface ProfileFields { displayName: string; company: string; branch: string; phone: string }
export interface IdentityStamp { uid: string | null; epoch: number }
export interface Session {
  status: 'loading' | 'unconfigured' | 'signed-out' | 'signing-out' | 'ready' | 'error';
  identity: IdentityStamp;
  user: { uid: string; email: string; emailVerified: boolean } | null;
  member: Member | null;
  memberAccess: boolean;
  adminClaim: boolean;
  staffActive: boolean;
  totpVerified: boolean;
  adminAccess: boolean;
  message?: string;
}
export const emptySession: Session = {
  status: 'loading', identity: { uid: null, epoch: 0 }, user: null, member: null,
  memberAccess: false, adminClaim: false, staffActive: false, totpVerified: false, adminAccess: false,
};
interface Client { app: FirebaseApp; auth: Auth; db: Firestore }
let client: Client | undefined;
let mfaResolver: MultiFactorResolver | undefined;
let mfaStartedAt = 0, mfaGeneration = 0;
let signingOut = false, enrollmentGeneration = 0;
let enrollment: { identity: IdentityStamp; secret: TotpSecret; expires: number } | undefined;

// Identity epoch changes for account transitions and every explicit sign-out.
// The observer separately rejects out-of-order token loads for the same account.
export function createIdentityGuard(currentUid: () => string | null) {
  let epoch = 0, lastUid = currentUid();
  return {
    capture(): IdentityStamp {
      const uid = currentUid();
      if (uid !== lastUid) { epoch++; lastUid = uid; }
      return { uid, epoch };
    },
    invalidate(): void { epoch++; },
    accepts(stamp: IdentityStamp): boolean {
      return stamp.epoch === epoch && stamp.uid === currentUid();
    },
  };
}
const identity = createIdentityGuard(() => client?.auth.currentUser?.uid ?? null);

export function sessionResultIsCurrent(session: Session): boolean {
  return identity.accepts(session.identity)
    && (session.status === 'signing-out' || !signingOut)
    && (session.user === null || session.user.uid === session.identity.uid);
}
function assertIdentity(stamp: IdentityStamp): void {
  if (signingOut || !identity.accepts(stamp)) throw new Error('ISP_IDENTITY_CHANGED');
}
function connect(): Client {
  if (client) return client;
  const config = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  };
  if (config.projectId !== 'isp-planter-app' || config.authDomain !== 'isp-planter-app.firebaseapp.com' || !config.apiKey || !config.appId) {
    throw new Error('ISP_CONNECTION_UNAVAILABLE');
  }
  const app = initializeApp(config);
  const auth = initializeAuth(app, { persistence: browserSessionPersistence });
  const db = initializeFirestore(app, { localCache: memoryLocalCache() });
  client = { app, auth, db };
  return client;
}
function boundedString(value: unknown, maximum: number, required = false): string {
  if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) throw new Error('ISP_RECORD_INVALID');
  return value;
}
function memberRecord(uid: string, value: DocumentData): Member {
  if (!['pending', 'approved', 'suspended'].includes(value.status)
      || !(value.membershipReference === null || typeof value.membershipReference === 'string')) throw new Error('ISP_RECORD_INVALID');
  return {
    uid, status: value.status, membershipReference: value.membershipReference,
    email: boundedString(value.email, 160, true), displayName: boundedString(value.displayName, 80),
    company: boundedString(value.company, 120), branch: boundedString(value.branch, 100), phone: boundedString(value.phone, 40),
  };
}
async function accessFor(user: User): Promise<Session> {
  const stamp = identity.capture();
  if (stamp.uid !== user.uid) throw new Error('ISP_IDENTITY_CHANGED');
  assertIdentity(stamp);
  const { db } = connect(), token = await getIdTokenResult(user);
  const snapshot = await getDocFromServer(doc(db, 'members', user.uid));
  const member = snapshot.exists() ? memberRecord(user.uid, snapshot.data()) : null;
  const adminClaim = token.claims.admin === true;
  const firebaseClaims = token.claims.firebase as Record<string, unknown> | undefined;
  const totpVerified = firebaseClaims?.sign_in_second_factor === 'totp';
  const verified = user.emailVerified === true && token.claims.email_verified === true;
  let staffActive = false;
  if (adminClaim) {
    const staff = await getDocFromServer(doc(db, 'staff', user.uid));
    staffActive = staff.exists() && staff.data().active === true;
  }
  assertIdentity(stamp);
  return {
    status: 'ready', identity: stamp, user: { uid: user.uid, email: user.email ?? '', emailVerified: verified },
    member, memberAccess: verified && member?.status === 'approved',
    adminClaim, staffActive, totpVerified,
    // Rendering only. Firestore rules independently enforce the access contract.
    adminAccess: verified && adminClaim && staffActive && totpVerified,
  };
}
export function observeSession(next: (session: Session) => void): () => void {
  let active = true, generation = 0, auth: Auth;
  try { auth = connect().auth; }
  catch {
    next({ ...emptySession, identity: identity.capture(), status: 'unconfigured', message: 'Sign-in is being connected. Please try again later.' });
    return () => { active = false; };
  }
  const unsubscribe = onIdTokenChanged(auth, async user => {
    const current = ++generation, stamp = identity.capture();
    if (!user) signingOut = false;
    if (signingOut) {
      if (active) next({ ...emptySession, identity: stamp, status: 'signing-out' });
      return;
    }
    if (!user) {
      if (active) next({ ...emptySession, identity: stamp, status: 'signed-out' });
      return;
    }
    next({ ...emptySession, identity: stamp, status: 'loading', user: { uid: user.uid, email: user.email ?? '', emailVerified: user.emailVerified } });
    try {
      const session = await accessFor(user);
      if (active && current === generation && sessionResultIsCurrent(session)) next(session);
    } catch (error) {
      if (active && current === generation && identity.accepts(stamp) && !signingOut) next({
        ...emptySession, identity: stamp, status: 'error',
        user: { uid: user.uid, email: user.email ?? '', emailVerified: user.emailVerified }, message: friendlyError(error),
      });
    }
  }, error => {
    if (active && !signingOut) next({ ...emptySession, identity: identity.capture(), status: 'error', message: friendlyError(error) });
  });
  return () => { active = false; generation++; unsubscribe(); };
}
export function cancelMfa(): void { mfaGeneration++; mfaResolver = undefined; mfaStartedAt = 0; }
export async function signIn(email: string, password: string): Promise<'signed-in' | 'totp-required'> {
  cancelMfa();
  const attempt = mfaGeneration;
  try {
    await signInWithEmailAndPassword(connect().auth, email.trim(), password);
    return 'signed-in';
  } catch (error) {
    if (error instanceof FirebaseError && error.code === 'auth/multi-factor-auth-required') {
      if (attempt !== mfaGeneration) throw new Error('ISP_IDENTITY_CHANGED');
      const resolver = getMultiFactorResolver(connect().auth, error as MultiFactorError);
      if (!resolver.hints.some(hint => hint.factorId === TotpMultiFactorGenerator.FACTOR_ID)) throw new Error('ISP_TOTP_REQUIRED');
      mfaResolver = resolver; mfaStartedAt = Date.now();
      return 'totp-required';
    }
    throw error;
  }
}
export async function completeTotp(code: string): Promise<void> {
  const resolver = mfaResolver;
  const factor = resolver?.hints.find(hint => hint.factorId === TotpMultiFactorGenerator.FACTOR_ID);
  if (!resolver || !factor || Date.now() - mfaStartedAt > 300000 || !/^\d{6}$/.test(code)) throw new Error('ISP_TOTP_EXPIRED');
  await resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(factor.uid, code));
  cancelMfa();
}
export function cancelTotpEnrollment(): void { enrollmentGeneration++; enrollment = undefined; }
export async function signOutMember(clearPrivateView: (session: Session) => void): Promise<void> {
  identity.invalidate(); signingOut = true;
  cancelMfa(); cancelTotpEnrollment();
  clearPrivateView({ ...emptySession, identity: identity.capture(), status: 'signing-out' });
  try { await signOut(connect().auth); }
  catch (error) {
    signingOut = false; identity.invalidate();
    clearPrivateView({ ...emptySession, identity: identity.capture(), status: 'error', message: friendlyError(error) });
    throw error;
  }
}
export async function refreshSession(): Promise<Session> {
  const user = connect().auth.currentUser;
  if (!user) return { ...emptySession, identity: identity.capture(), status: 'signed-out' };
  const stamp = identity.capture();
  assertIdentity(stamp);
  await user.reload();
  assertIdentity(stamp);
  await user.getIdToken(true);
  assertIdentity(stamp);
  return accessFor(user);
}
export async function saveProfile(input: ProfileFields): Promise<Session> {
  if (Object.keys(input).sort().join(',') !== 'branch,company,displayName,phone') throw new Error('ISP_PROFILE_INVALID');
  const profile: ProfileFields = {
    displayName: boundedString(input.displayName.trim(), 80, true),
    company: boundedString(input.company.trim(), 120),
    branch: boundedString(input.branch.trim(), 100), phone: boundedString(input.phone.trim(), 40),
  };
  const { auth, db } = connect(), user = auth.currentUser;
  if (!user) throw new Error('ISP_MEMBER_REQUIRED');
  const stamp = identity.capture();
  if (!(await accessFor(user)).memberAccess) throw new Error('ISP_MEMBER_REQUIRED');
  assertIdentity(stamp);
  await updateDoc(doc(db, 'members', user.uid), { ...profile, updatedAt: serverTimestamp() });
  assertIdentity(stamp);
  return accessFor(user);
}
export type RosterCursor = QueryDocumentSnapshot<DocumentData> | null;
export interface RosterPage { members: Member[]; nextCursor: RosterCursor }
export async function loadRoster(after: RosterCursor = null): Promise<RosterPage> {
  const { auth, db } = connect(), user = auth.currentUser;
  if (!user) throw new Error('ISP_ADMIN_REQUIRED');
  const stamp = identity.capture();
  if (!(await accessFor(user)).adminAccess) throw new Error('ISP_ADMIN_REQUIRED');
  assertIdentity(stamp);
  const constraints = [orderBy(documentId()), ...(after ? [startAfter(after)] : []), limit(25)];
  const snapshot = await getDocsFromServer(query(collection(db, 'members'), ...constraints));
  assertIdentity(stamp);
  return { members: snapshot.docs.map(row => memberRecord(row.id, row.data())), nextCursor: snapshot.docs.length === 25 ? snapshot.docs.at(-1) ?? null : null };
}
export async function requestPasswordRecovery(email: string): Promise<void> {
  try { await sendPasswordResetEmail(connect().auth, email.trim()); }
  catch (error) {
    // Keep the same confirmation for addresses without an account.
    if (!(error instanceof FirebaseError && error.code === 'auth/user-not-found')) throw error;
  }
}
export async function requestEmailVerification(): Promise<void> {
  const user = connect().auth.currentUser, stamp = identity.capture();
  if (!user) throw new Error('ISP_MEMBER_REQUIRED');
  assertIdentity(stamp);
  if (user.emailVerified) return;
  await sendEmailVerification(user);
  assertIdentity(stamp);
}
export async function beginTotpEnrollment(password: string): Promise<{ secretKey: string; account: string }> {
  cancelTotpEnrollment();
  const attempt = enrollmentGeneration, user = connect().auth.currentUser;
  if (!user?.email) throw new Error('ISP_ADMIN_REQUIRED');
  const stamp = identity.capture(), access = await accessFor(user);
  assertIdentity(stamp);
  if (!access.user?.emailVerified || !access.adminClaim || !access.staffActive) throw new Error('ISP_ADMIN_REQUIRED');
  if (multiFactor(user).enrolledFactors.some(factor => factor.factorId === TotpMultiFactorGenerator.FACTOR_ID)) throw new Error('ISP_TOTP_ALREADY_ENROLLED');
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
  assertIdentity(stamp);
  const mfaSession = await multiFactor(user).getSession();
  assertIdentity(stamp);
  const secret = await TotpMultiFactorGenerator.generateSecret(mfaSession);
  assertIdentity(stamp);
  if (attempt !== enrollmentGeneration) throw new Error('ISP_IDENTITY_CHANGED');
  enrollment = { identity: stamp, secret, expires: Date.now() + 300000 };
  return { secretKey: secret.secretKey, account: user.email };
}
export async function finishTotpEnrollment(code: string, clearPrivateView: (session: Session) => void): Promise<void> {
  const pending = enrollment, user = connect().auth.currentUser;
  if (!pending || !user || Date.now() >= pending.expires || !/^\d{6}$/.test(code)) throw new Error('ISP_TOTP_EXPIRED');
  assertIdentity(pending.identity);
  const access = await accessFor(user);
  assertIdentity(pending.identity);
  if (!access.user?.emailVerified || !access.adminClaim || !access.staffActive) throw new Error('ISP_ADMIN_REQUIRED');
  await multiFactor(user).enroll(TotpMultiFactorGenerator.assertionForEnrollment(pending.secret, code), 'ISP authenticator');
  assertIdentity(pending.identity);
  cancelTotpEnrollment();
  // Enrollment cannot promote a password-only session into an admin session.
  await signOutMember(clearPrivateView);
}
export function friendlyError(error: unknown): string {
  const code = error instanceof FirebaseError ? error.code : error instanceof Error ? error.message : '';
  if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'].includes(code)) return 'The email or password did not match. Please try again.';
  if (code === 'ISP_IDENTITY_CHANGED') return 'Your sign-in changed. Please continue with the current account.';
  if (code === 'auth/requires-recent-login') return 'Please sign out and sign in again before setting up your authenticator.';
  if (code === 'ISP_TOTP_ALREADY_ENROLLED') return 'An authenticator is already set up. Sign out, then sign in with its code.';
  if (code === 'auth/too-many-requests') return 'Please wait a moment before trying again.';
  if (['auth/invalid-verification-code', 'auth/invalid-multi-factor-session', 'auth/multi-factor-session-expired', 'ISP_TOTP_EXPIRED'].includes(code)) return 'That authenticator code is invalid or the sign-in expired. Please try again.';
  if (code === 'ISP_TOTP_REQUIRED') return 'This account needs an authenticator before administrator access can open.';
  if (['ISP_ADMIN_REQUIRED', 'permission-denied', 'firestore/permission-denied'].includes(code)) return 'Access is not available for this account. Please contact ISP if you need help.';
  if (code === 'ISP_MEMBER_REQUIRED') return 'An approved membership and verified email are required.';
  if (['ISP_PROFILE_INVALID', 'ISP_RECORD_INVALID'].includes(code)) return 'These member details could not be accepted. Please contact ISP.';
  if (code === 'auth/user-disabled') return 'This account is unavailable. Please contact ISP.';
  if (['auth/network-request-failed', 'unavailable', 'firestore/unavailable'].includes(code)) return 'The connection is unavailable. Please try again when you are online.';
  return 'We could not complete that request. Please try again, or contact ISP.';
}
