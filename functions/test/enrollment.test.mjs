import test,{beforeEach,afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
process.env.GCLOUD_PROJECT='isp-planter-app';
const {Timestamp}=await import('firebase-admin/firestore');
const {getStorage}=await import('firebase-admin/storage');
const {db,auth}=await import('../lib/runtime.js');
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
test('activation creates one server-derived approved profile and immutable UID binding, preserving zero reference',async()=>{
  const result=await activateMyMembershipHandler(request({memberReference:' 00001 '}));
  assert.deepEqual(result,{uid:'member',status:'approved',membershipReference:'00001',registryKey:key,paired:true});
  const member=records.get('members/member');assert.equal(member.displayName,'Registry Planter');assert.equal(member.email,'member@example.invalid');assert.equal(member.company,'');assert.equal(member.branch,'');assert.equal(member.phone,'');assert.ok(member.updatedAt instanceof Timestamp);assert.equal(records.get('registryBindings/'+key).uid,'member');
  writes=0;assert.deepEqual(await activateMyMembershipHandler(request({memberReference:reference})),result);assert.equal(writes,0);
});
test('activation pairs an exact approved legacy profile without overwriting its user fields',async()=>{
  records.set('members/member',profile());await activateMyMembershipHandler(request({memberReference:reference}));
  assert.equal(records.get('members/member').displayName,'My preferred name');assert.equal(records.get('members/member').company,'My organisation');assert.equal(records.get('members/member').registryKey,key);
});
test('activation denies stale, unverified, disabled, revoked, administrator and staff identities',async()=>{
  const cases=[()=>request({memberReference:reference},{email_verified:false}),()=>{authUser.emailVerified=false;return request({memberReference:reference});},()=>{authUser.disabled=true;return request({memberReference:reference});},()=>{authUser.tokensValidAfterTime=new Date(1_900_000_000_000).toISOString();return request({memberReference:reference});},()=>request({memberReference:reference},{admin:true}),()=>{authUser.customClaims.admin=true;return request({memberReference:reference});},()=>{records.set('staff/member',{active:false});return request({memberReference:reference});},()=>request({memberReference:reference},{email:'other@example.invalid'})];
  for(const makeRequest of cases){reset();await assert.rejects(activateMyMembershipHandler(makeRequest()),{code:'permission-denied'});assert.equal(records.has('members/member'),false);}
});
test('activation requires an exact active unsuspended registry match and refuses competing UID or nonapproved profiles',async()=>{
  for(const change of [()=>records.delete('registryState/current'),()=>records.set('registryState/current',{activeVersion:null}),()=>records.get(`memberRegistryVersions/v1/entries/${key}`).status='ineligible',()=>records.get(`memberRegistryVersions/v1/entries/${key}`).accessSuspended=true,()=>records.get(`memberRegistryVersions/v1/entries/${key}`).email='other@example.invalid',()=>records.set('registryBindings/'+key,{uid:'other',memberReference:reference,email:'member@example.invalid'}),()=>records.set('members/member',{...profile(),status:'suspended'}),()=>records.set('members/member',{...profile(),status:'pending'}),()=>records.set('members/member',{...profile(),status:'rejected'}),()=>records.set('members/other',profile())]){reset();change();await assert.rejects(activateMyMembershipHandler(request({memberReference:reference})));assert.equal(writes,0);}
  reset();await assert.rejects(activateMyMembershipHandler(request({memberReference:reference,status:'approved'})),{code:'invalid-argument'});
  await assert.rejects(activateMyMembershipHandler(request({memberReference:1})),{code:'invalid-argument'});
});
test('CSV suspension restoration is false by default, eligible-only, counted and bound into preview digest',()=>{
  const existing=[{name:'Planter',email:'member@example.invalid',memberReference:reference,status:'eligible',accessSuspended:true}];
  const csv='name,email,member_reference,status\nPlanter,member@example.invalid,00001,eligible';
  const ordinary=parseRegistryCsv(csv),normal=classifyRegistry(ordinary,existing,new Map());assert.equal(ordinary[0].accessSuspended,true);assert.equal(normal.counts.restoredSuspensions,0);
  const reviewed=parseRegistryCsv(csv),restored=classifyRegistry(reviewed,existing,new Map(),true);assert.equal(reviewed[0].accessSuspended,false);assert.equal(reviewed[0].restoreSuspension,true);assert.equal(reviewed[0].action,'update');assert.equal(restored.counts.restoredSuspensions,1);assert.notEqual(registryPreviewDigest(ordinary,false),registryPreviewDigest(reviewed,true));
  const ineligible=parseRegistryCsv(csv.replace(',eligible',',ineligible'));assert.equal(classifyRegistry(ineligible,existing,new Map(),true).counts.restoredSuspensions,0);assert.equal(ineligible[0].accessSuspended,true);
});
test('explicit CSV restoration stages atomically, preserves omitted suspensions, and never enables Auth or changes member status',async()=>{
  records.get(`memberRegistryVersions/v1/entries/${key}`).accessSuspended=true;
  const omittedKey=sha('00002');records.set(`memberRegistryVersions/v1/entries/${omittedKey}`,{name:'Omitted',email:'omitted@example.invalid',memberReference:'00002',status:'eligible',accessSuspended:true});
  records.set('members/member',profile());lookupAuth=true;authUser.disabled=true;
  const csv='name,email,member_reference,status\nRegistry Planter,member@example.invalid,00001,eligible';
  const ordinary=await previewRegistryImportHandler(adminRequest({csv}));assert.equal(ordinary.restoreSuspended,false);assert.equal(ordinary.counts.restoredSuspensions,0);
  const preview=await previewRegistryImportHandler(adminRequest({csv,restoreSuspended:true}));assert.equal(preview.restoreSuspended,true);assert.equal(preview.counts.restoredSuspensions,1);assert.equal(preview.rows[0].restoreSuspension,true);
  const confirmation={previewId:preview.previewId,digest:preview.digest,registryVersion:preview.registryVersion};await assert.rejects(confirmRegistryImportHandler(adminRequest({...confirmation,restoreSuspended:false})),{code:'invalid-argument'});
  let result;for(let attempt=0;attempt<8;attempt++){result=await confirmRegistryImportHandler(adminRequest(confirmation));if(result.state==='confirmed')break;assert.equal(records.get('registryState/current').activeVersion,'v1');}
  assert.equal(result.state,'confirmed');const active=records.get('registryState/current').activeVersion;assert.equal(records.get(`memberRegistryVersions/${active}/entries/${key}`).accessSuspended,false);assert.equal(records.get(`memberRegistryVersions/${active}/entries/${omittedKey}`).accessSuspended,true);assert.equal(records.get('members/member').status,'approved');assert.equal(authUser.disabled,true);assert.equal(auth.createUser.mock.callCount(),0);assert.equal(auth.updateUser.mock.callCount(),0);
});

test('signup-before-import provenance permits only Auth-only or exact already-linked identity, preserving a matching UID binding',async()=>{
  const csv='name,email,member_reference,status\nRegistry Planter,member@example.invalid,00001,eligible';
  for(const prepare of [()=>{},()=>records.set('registryBindings/'+key,{uid:'member',memberReference:reference,email:'member@example.invalid'}),()=>records.set('members/member',profile())]){reset();lookupAuth=true;prepare();const preview=await previewRegistryImportHandler(adminRequest({csv}));assert.equal(preview.state,'ready');assert.equal(preview.counts.invalid,0);}
});
test('signup-before-import provenance rejects existing UID/profile, orphan, staff and permanent-binding conflicts',async()=>{
  const csv='name,email,member_reference,status\nRegistry Planter,member@example.invalid,00001,eligible';
  const cases=[()=>records.set('members/member',{...profile(),email:'other@example.invalid',membershipReference:'other'}),()=>records.set('members/other',profile()),()=>records.set('members/other',{...profile(),email:'other@example.invalid'}),()=>records.set('registryBindings/'+key,{uid:'other',memberReference:reference,email:'member@example.invalid'}),()=>records.set('registryBindings/'+key,{uid:'member',memberReference:'other',email:'member@example.invalid'}),()=>records.set('staff/member',{active:false}),()=>authUser.customClaims.admin=true,()=>{lookupAuth=false;records.set('members/orphan',profile());}];
  for(const prepare of cases){reset();lookupAuth=true;prepare();const preview=await previewRegistryImportHandler(adminRequest({csv}));assert.equal(preview.state,'invalid');assert.equal(preview.counts.invalid,1);}
});
test('signup-before-import final recheck transaction reads missing UID and binding so concurrent activation cannot evade its preview',async()=>{
  lookupAuth=true;
  const preview=await previewRegistryImportHandler(adminRequest({csv:'name,email,member_reference,status\nRegistry Planter,member@example.invalid,00001,eligible'}));
  const confirmation={previewId:preview.previewId,digest:preview.digest,registryVersion:preview.registryVersion};
  for(let attempt=0;attempt<6;attempt++){const status=await confirmRegistryImportHandler(adminRequest(confirmation));if(status.phase==='activate')break;}
  raceOnFinalMemberRead=true;
  await assert.rejects(confirmRegistryImportHandler(adminRequest(confirmation)),{code:'failed-precondition'});
  assert.equal(records.get('registryState/current').activeVersion,'v1');assert.ok(readPaths.includes('members/member'));
  reset();lookupAuth=true;
  const bound=await previewRegistryImportHandler(adminRequest({csv:'name,email,member_reference,status\nRegistry Planter,member@example.invalid,00001,eligible'}));
  const request={previewId:bound.previewId,digest:bound.digest,registryVersion:bound.registryVersion};let status;
  for(let attempt=0;attempt<8;attempt++){status=await confirmRegistryImportHandler(adminRequest(request));if(status.state==='confirmed')break;}
  assert.equal(status.state,'confirmed');assert.ok(readPaths.includes('members/member'));assert.ok(readPaths.includes('registryBindings/'+key));
});

