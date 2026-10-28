import { HttpsError } from 'firebase-functions/v2/https';
import { auth, db, now, verified, type Request } from './runtime.js';
import { obj, text, email, id, sha } from './validation.js';

function denied(message='This verified account cannot activate that membership.'):never {throw new HttpsError('permission-denied',message);}
async function freshIdentity(request:Request):Promise<string> {
  const uid=verified(request),token=request.auth!.token;
  if(token.admin===true || token.firebase?.sign_in_provider!=='password')denied();
  const current=await auth.getUser(uid);
  const address=email(current.email),tokenAddress=email(token.email);
  if(current.uid!==uid || current.disabled || current.emailVerified!==true || current.customClaims?.admin===true || address!==tokenAddress
    || !current.providerData.some(provider=>provider.providerId==='password'))denied();
  const authenticatedAt=token.auth_time*1000;
  const validAfter=current.tokensValidAfterTime?Date.parse(current.tokensValidAfterTime):0;
  // Same auth_time / tokensValidAfterTime revocation comparison used by the installed Admin SDK.
  if(!Number.isFinite(authenticatedAt) || authenticatedAt<=0 || !Number.isFinite(validAfter) || authenticatedAt<validAfter)denied('Please sign out and sign in again before activating membership.');
  return address;
}
function validProfile(data:Record<string,any>):boolean {
  return Object.entries({displayName:80,company:120,branch:100,phone:40}).every(([field,maximum])=>typeof data[field]==='string' && data[field].length<=maximum);
}
export async function activateMyMembershipHandler(request:Request) {
  const uid=verified(request),source=obj(request.data,['memberReference']),reference=text(source.memberReference,80,true,true),registryKey=sha(reference);
  const stateRef=db.doc('registryState/current'),memberRef=db.doc(`members/${uid}`),staffRef=db.doc(`staff/${uid}`),bindingRef=db.doc(`registryBindings/${registryKey}`);
  return db.runTransaction(async transaction=>{
    const [state,profile,staff,binding]=await transaction.getAll(stateRef,memberRef,staffRef,bindingRef);
    const activeVersion=state!.get('activeVersion');
    if(typeof activeVersion!=='string' || !activeVersion)throw new HttpsError('failed-precondition','Membership activation requires an active eligibility registry.');
    if(staff!.exists)denied();
    const row=await transaction.get(db.doc(`memberRegistryVersions/${id(activeVersion)}/entries/${registryKey}`));
    if(!row.exists || row.get('status')!=='eligible' || row.get('accessSuspended')===true || row.get('memberReference')!==reference)denied();
    const address=await freshIdentity(request);
    if(row.get('email')!==address)denied();
    const existing=profile!.data(),claim=binding!.data();
    if(existing && (existing.status!=='approved' || existing.email!==address || existing.membershipReference!==reference
      || existing.registryKey!==undefined && existing.registryKey!==null && existing.registryKey!==registryKey || !validProfile(existing)))denied();
    if(claim && (claim.uid!==uid || claim.memberReference!==reference || claim.email!==address))denied();
    // Bound legacy-account checks prevent a recreated Auth UID from claiming an unpaired old profile.
    const [sameReference,sameEmail]=await Promise.all([
      transaction.get(db.collection('members').where('membershipReference','==',reference).limit(2)),
      transaction.get(db.collection('members').where('email','==',address).limit(2)),
    ]);
    if([...sameReference.docs,...sameEmail.docs].some(account=>account.id!==uid))denied();
    const timestamp=now();
    if(!claim)transaction.create(bindingRef,{uid,memberReference:reference,email:address,createdAt:timestamp});
    if(!existing)transaction.create(memberRef,{status:'approved',membershipReference:reference,registryKey,email:address,displayName:text(row.get('name'),80,true,true),company:'',branch:'',phone:'',createdAt:timestamp,updatedAt:timestamp});
    else if(existing.registryKey!==registryKey)transaction.update(memberRef,{registryKey,updatedAt:timestamp});
    return {uid,status:'approved' as const,membershipReference:reference,registryKey,paired:true};
  });
}
