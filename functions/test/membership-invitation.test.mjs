import test,{beforeEach,afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
process.env.GCLOUD_PROJECT='isp-planter-app';
const {Timestamp}=await import('firebase-admin/firestore');
const {getStorage}=await import('firebase-admin/storage');
const {db,auth}=await import('../lib/runtime.js');
const {requireMembershipInvitationHandler}=await import('../lib/invitation.js');
const {activateMyMembershipHandler}=await import('../lib/enrollment.js');
const {previewRegistryImportHandler,confirmRegistryImportHandler,registryPreviewDigest}=await import('../lib/registry.js');
const {parseRegistryCsv,classifyRegistry,sha}=await import('../lib/validation.js');
let records,authUser,writes,objects,generation,lookupAuth,raceOnFinalMemberRead,readPaths;
const key=sha('00001'),reference='00001';
function reset(){records=new Map([['registryState/current',{activeVersion:'v1',revision:1}],[`memberRegistryVersions/v1/entries/${key}`,{name:'Registry Planter',email:'member@example.invalid',memberReference:reference,status:'eligible',accessSuspended:false}],['staff/owner',{active:true}]]);authUser={uid:'member',email:'Member@example.invalid',emailVerified:true,disabled:false,customClaims:{},providerData:[{providerId:'password'}],tokensValidAfterTime:new Date(1_700_000_000_000).toISOString()};writes=0;lookupAuth=false;raceOnFinalMemberRead=false;readPaths=[];}
const snapshot=ref=>({ref,id:ref.id,exists:records.has(ref.path),get:key=>records.get(ref.path)?.[key],data:()=>records.get(ref.path)});
function query(path,filters=[],after=null,bound=25){return {__query:true,where:(field,operator,value)=>query(path,[...filters,[field,operator,value]],after,bound),orderBy:()=>query(path,filters,after,bound),limit:n=>query(path,filters,after,n),startAfter:value=>query(path,filters,value,bound),get:async()=>{const docs=[...records.keys()].filter(key=>key.startsWith(path+'/')&&!key.slice(path.length+1).includes('/')).sort().filter(key=>!after||key.slice(path.length+1)>after).filter(key=>filters.every(([field,operator,value])=>operator==='in'?value.includes(records.get(key)[field]):records.get(key)[field]===value)).slice(0,bound).map(key=>snapshot(db.doc(key)));return {docs,size:docs.length};}};}
const request=(data,token={})=>({data,auth:{uid:'member',token:{email_verified:true,email:'member@example.invalid',auth_time:1_800_000_000,firebase:{sign_in_provider:'password'},...token}}});
const adminRequest=data=>({data,auth:{uid:'owner',token:{email_verified:true,email:'owner@example.invalid',admin:true,firebase:{sign_in_second_factor:'totp'}}}});
const profile=()=>({status:'approved',membershipReference:reference,email:'member@example.invalid',displayName:'My preferred name',company:'My organisation',branch:'Local',phone:'0123'});
beforeEach(()=>{
  reset();objects=new Map();generation=0;
  mock.method(auth,'getUser',async uid=>{assert.equal(uid,'member');return authUser;});
  mock.method(auth,'getUsers',async()=>({users:lookupAuth?[authUser]:[],notFound:[]}));
  mock.method(auth,'createUser',async()=>{throw Error('Server Auth creation is forbidden');});
  mock.method(auth,'updateUser',async()=>{throw Error('Server Auth activation is forbidden');});
  mock.method(db,'collection',path=>query(path));mock.method(db,'getAll',async(...refs)=>refs.map(snapshot));
  const proto=Object.getPrototypeOf(db.doc('local/example'));
  mock.method(proto,'get',async function(){return snapshot(this);});
  mock.method(db,'runTransaction',async handler=>{
    const pending=[];const tx={get:async target=>target.__query?target.get():snapshot(target),getAll:async(...refs)=>{readPaths.push(...refs.map(ref=>ref.path));if(raceOnFinalMemberRead && refs.some(ref=>ref.path==='members/member')){raceOnFinalMemberRead=false;records.set('members/member',{...profile(),registryKey:key});records.set('registryBindings/'+key,{uid:'member',memberReference:reference,email:'member@example.invalid'});}return refs.map(snapshot);},create:(ref,data)=>pending.push(['create',ref,data]),set:(ref,data)=>pending.push(['set',ref,data]),update:(ref,data)=>pending.push(['update',ref,data])};
    const result=await handler(tx);
    for(const [method,ref,data] of pending){if(method==='create')assert.equal(records.has(ref.path),false);records.set(ref.path,method==='update'?{...records.get(ref.path),...data}:data);writes++;}return result;
  });
  mock.method(getStorage(),'bucket',()=>({name:'private-test',file:(path,options)=>({save:async bytes=>objects.set(path,{bytes:Buffer.from(bytes),generation:String(++generation)}),getMetadata:async()=>[{generation:objects.get(path).generation}],download:async()=>{assert.equal(options?.generation,objects.get(path).generation);return [objects.get(path).bytes];},delete:async()=>objects.delete(path)})}));
});
afterEach(()=>mock.restoreAll());

const csv = (await import('node:fs/promises')).readFile;
const fixturePath = new URL('../../docs/membership-import-mock.csv', import.meta.url);
async function importFixture() {
  records.delete('registryState/current');
  for (const path of [...records.keys()]) if (path.startsWith('memberRegistryVersions/')) records.delete(path);
  const source=await csv(fixturePath,'utf8');
  const preview=await previewRegistryImportHandler(adminRequest({csv:source}));
  assert.equal(preview.state,'ready'); assert.equal(preview.counts.invalid,0); assert.equal(preview.counts.total,2);
  let result;
  for(let step=0;step<8;step++){result=await confirmRegistryImportHandler(adminRequest({previewId:preview.previewId,digest:preview.digest,registryVersion:preview.registryVersion}));if(result.state==='confirmed')break;}
  assert.equal(result.state,'confirmed');
  assert.equal(records.get('registryState/current').activeVersion,result.activeVersion);
  return result.activeVersion;
}
const event=address=>({data:{uid:'member',email:address,tenantId:undefined},additionalUserInfo:{providerId:'password'},eventType:'providers/cloud.auth/eventTypes/user.beforeCreate:password',resource:{name:'projects/isp-planter-app'}});
function denyCheck(error){return error.code==='permission-denied' && error.message==='ISP_INVITATION_REQUIRED';}
test('mock CSV import -> listed invitation -> verified activation -> durable profile and binding -> idempotent repeat',async()=>{
  const version=await importFixture();
  assert.equal(records.get('memberRegistryVersions/'+version+'/entries/'+key).memberReference,'00001');
  writes=0;await requireMembershipInvitationHandler(event(' Member@example.invalid '));assert.equal(writes,0);assert.equal(records.has('members/member'),false);
  const result=await activateMyMembershipHandler(request({memberReference:'00001'}));
  assert.equal(result.status,'approved');
  const saved=records.get('members/member');assert.equal(saved.email,'member@example.invalid');assert.equal(saved.membershipReference,'00001');assert.equal(saved.displayName,'MOCK Eligible Planter');assert.equal(saved.registryKey,key);assert.equal(saved.status,'approved');assert.ok(saved.createdAt instanceof Timestamp);
  assert.equal(records.get('registryBindings/'+key).uid,'member');
  writes=0;await activateMyMembershipHandler(request({memberReference:'00001'}));assert.equal(writes,0);
  assert.equal(auth.createUser.mock.callCount(),0);assert.equal(auth.updateUser.mock.callCount(),0);
});
test('absent and ineligible mock emails rejected by registration hook without member or binding writes',async()=>{
  await importFixture();
  for(const address of ['not-listed@example.invalid','ineligible@example.invalid']){
    writes=0;await assert.rejects(requireMembershipInvitationHandler(event(address)),denyCheck);assert.equal(writes,0);assert.equal(records.has('members/member'),false);assert.equal(records.has('registryBindings/'+key),false);
  }
});
test('suspended, duplicate, already-bound and absent registry fail closed before account creation',async()=>{
  const version=await importFixture(),path='memberRegistryVersions/'+version+'/entries/'+key;
  writes=0;records.get(path).accessSuspended=true;await assert.rejects(requireMembershipInvitationHandler(event('member@example.invalid')),denyCheck);records.get(path).accessSuspended=false;
  const duplicate='memberRegistryVersions/'+version+'/entries/'+sha('00003');records.set(duplicate,{...records.get(path),memberReference:'00003'});await assert.rejects(requireMembershipInvitationHandler(event('member@example.invalid')),denyCheck);records.delete(duplicate);
  records.set('registryBindings/'+key,{uid:'different-uid'});await assert.rejects(requireMembershipInvitationHandler(event('member@example.invalid')),denyCheck);records.delete('registryBindings/'+key);
  records.delete('registryState/current');await assert.rejects(requireMembershipInvitationHandler(event('member@example.invalid')),denyCheck);assert.equal(writes,0);
});
test('unverified, mismatched-email, absent and ineligible references cannot activate or save membership',async()=>{
  await importFixture();
  for(const req of [request({memberReference:'00001'},{email_verified:false}),request({memberReference:'00001'},{email:'not-listed@example.invalid'}),request({memberReference:'00003'}),request({memberReference:'00002'})]){
    writes=0;await assert.rejects(activateMyMembershipHandler(req));assert.equal(writes,0);assert.equal(records.has('members/member'),false);assert.equal(records.has('registryBindings/'+key),false);
  }
});

test('nonpassword, tenant, malformed and wrong-project events fail closed',async()=>{await importFixture();for(const value of [{...event('member@example.invalid'),additionalUserInfo:{providerId:'google.com'}},{...event('member@example.invalid'),eventType:'providers/cloud.auth/eventTypes/user.beforeCreate:emailLink'},{...event('member@example.invalid'),resource:{name:'projects/another-project'}},{...event('member@example.invalid'),data:{uid:'member',email:'member@example.invalid',tenantId:'unexpected'}},{data:{}}]){writes=0;await assert.rejects(requireMembershipInvitationHandler(value),denyCheck);assert.equal(writes,0);}});
