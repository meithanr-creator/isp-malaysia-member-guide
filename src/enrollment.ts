import { getApp } from 'firebase/app';
import { createUserWithEmailAndPassword, getAuth } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { friendlyError, sessionResultIsCurrent, type Session } from './firebase';

export interface ActivationReceipt { uid: string; status: 'approved'; membershipReference: string; registryKey: string; paired: true }
function connection() {
  const app = getApp();
  if (app.options.projectId !== 'isp-planter-app') throw Error('ISP_CONNECTION_UNAVAILABLE');
  return { app, auth: getAuth(app) };
}
function currentMember(session: Session) {
  const client = connection();
  if (!sessionResultIsCurrent(session) || session.status !== 'ready' || !session.user || client.auth.currentUser?.uid !== session.user.uid) throw Error('ISP_IDENTITY_CHANGED');
  if (!session.user.emailVerified || !client.auth.currentUser.emailVerified) throw Error('ISP_VERIFY_FIRST');
  if (session.adminClaim || session.staffActive) throw Error('ISP_STAFF_ENROLLMENT');
  return client;
}
export function signupInput(email: string, password: string, confirmation: string) {
  const address = email.trim();
  if (!address || address.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || password.length < 12 || password.length > 128 || password !== confirmation) throw Error('ISP_SIGNUP_INVALID');
  return { email: address, password };
}
export function membershipReference(value: string): string {
  const reference = value.trim();
  if (!reference || reference.length > 80 || /[\u0000-\u001f\u007f]/.test(reference)) throw Error('ISP_REFERENCE_INVALID');
  return reference;
}
export async function createOwnAccount(email: string, password: string, confirmation: string, session: Session): Promise<void> {
  const input = signupInput(email, password, confirmation), { auth } = connection();
  if (session.status !== 'signed-out' || session.user || !sessionResultIsCurrent(session) || auth.currentUser) throw Error('ISP_IDENTITY_CHANGED');
  // The server admits eligible registry emails; the observer owns session admission.
  const credential = await createUserWithEmailAndPassword(auth, input.email, input.password);
  if (connection().auth.currentUser?.uid !== credential.user.uid) throw Error('ISP_IDENTITY_CHANGED');
}
export async function activateMembership(value: string, session: Session): Promise<ActivationReceipt> {
  const reference = membershipReference(value), { app } = currentMember(session);
  try {
    const result = await httpsCallable<{ memberReference: string }, ActivationReceipt>(getFunctions(app, 'asia-southeast1'), 'activateMyMembership', { timeout: 120000 })({ memberReference: reference });
    currentMember(session);
    const receipt = result.data;
    if (!receipt || receipt.uid !== session.user!.uid || receipt.status !== 'approved' || receipt.paired !== true || receipt.membershipReference !== reference || typeof receipt.registryKey !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.registryKey)) throw Error('ISP_ACTIVATION_UNCONFIRMED');
    return receipt;
  } catch (error) {
    currentMember(session);
    if (error instanceof Error && error.message === 'ISP_ACTIVATION_UNCONFIRMED') throw error;
    throw Error('ISP_ACTIVATION_UNCONFIRMED');
  }
}
export function enrollmentError(error: unknown): string {
  const details = error as { code?: string; message?: string } | null;
  const code = details?.code || (error instanceof Error ? error.message : '');
  if (code === 'ISP_INVITATION_REQUIRED' || code === 'auth/isp-invitation-required' || (code === 'auth/internal-error' && typeof details?.message === 'string' && details.message.includes('ISP_INVITATION_REQUIRED'))) return 'Registration is invitation-only. Use the exact email address on your ISP membership record, or contact ISP for help.';
  if (code === 'ISP_SIGNUP_INVALID') return 'Enter your email address and matching passwords of 12 to 128 characters.';
  if (code === 'auth/email-already-in-use') return 'If you already have an account, sign in or use password help.';
  if (['auth/weak-password', 'auth/password-does-not-meet-requirements'].includes(code)) return 'Choose a stronger password that meets the account requirements.';
  if (code === 'ISP_REFERENCE_INVALID') return 'Enter your membership reference exactly as issued, using no more than 80 characters.';
  if (code === 'ISP_VERIFY_FIRST') return 'Verify your email address, then check verification before continuing.';
  if (code === 'ISP_STAFF_ENROLLMENT') return 'Use administrator sign-in and authenticator setup for this account.';
  if (code === 'ISP_ACTIVATION_UNCONFIRMED') return 'We could not confirm an eligible membership for this account and reference. Check your details or contact ISP.';
  return friendlyError(error);
}
