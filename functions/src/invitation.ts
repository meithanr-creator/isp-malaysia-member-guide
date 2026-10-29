import { HttpsError, type AuthBlockingEvent } from 'firebase-functions/v2/identity';
import { db } from './runtime.js';
import { email, id, sha } from './validation.js';

export const INVITATION_REQUIRED = 'ISP_INVITATION_REQUIRED';
function deny(): never { throw new HttpsError('permission-denied', INVITATION_REQUIRED); }
// ISP invites members by adding their exact email to the approved CSV registry.
// Do not create profiles or mark ownership verified before email verification.
export async function requireMembershipInvitationHandler(event: AuthBlockingEvent): Promise<void> {
  const user = event.data;
  if (!user || user.tenantId || typeof user.uid !== 'string' || !user.uid || user.uid.length > 128 || typeof user.email !== 'string'
    || event.additionalUserInfo?.providerId !== 'password'
    || event.eventType !== 'providers/cloud.auth/eventTypes/user.beforeCreate:password'
    || event.resource?.name !== 'projects/isp-planter-app') deny();
  let address: string;
  try { address = email(user.email); } catch { deny(); }
  await db.runTransaction(async transaction => {
    const state = await transaction.get(db.doc('registryState/current'));
    const version = state.get('activeVersion');
    if (typeof version !== 'string' || !version) deny();
    let validVersion: string;
    try { validVersion = id(version); } catch { deny(); }
    const candidates = await transaction.get(db.collection('memberRegistryVersions/' + validVersion + '/entries').where('email', '==', address).limit(2));
    if (candidates.size !== 1) deny();
    const row = candidates.docs[0]!, reference = row.get('memberReference');
    if (typeof reference !== 'string' || !reference || reference.length > 80 || reference !== reference.trim()
      || /[\u0000-\u001f\u007f]/u.test(reference) || row.id !== sha(reference) || row.get('email') !== address
      || row.get('status') !== 'eligible' || row.get('accessSuspended') === true) deny();
    // A deleted account must not reclaim another account's permanent membership binding.
    const binding = await transaction.get(db.doc('registryBindings/' + row.id));
    if (binding.exists) deny();
  }, { maxAttempts: 1 });
}
