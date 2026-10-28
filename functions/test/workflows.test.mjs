import test,{beforeEach,afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
process.env.GCLOUD_PROJECT='isp-planter-app';
const {Timestamp}=await import('firebase-admin/firestore');
const {getStorage}=await import('firebase-admin/storage');
const {db,auth}=await import('../lib/runtime.js');
const content=await import('../lib/content.js');
const registry=await import('../lib/registry.js');
const {sha}=await import('../lib/validation.js');
let records,objects,maxWrites,commits,generation;
const snapshot=(ref)=>({ref,id:ref.id,exists:records.has(ref.path),data:()=>records.get(ref.path),get:key=>records.get(ref.path)?.[key]});
function query(path,filters=[],after=null,bound=25){return {where:(key,operator,value)=>query(path,[...filters,[key,operator,value]],after,bound),orderBy:()=>query(path,filters,after,bound),limit:n=>query(path,filters,after,n),startAfter:value=>query(path,filters,value,bound),get:async()=>{const docs=[...records.keys()].filter(key=>key.startsWith(path+'/')&&key.slice(path.length+1).indexOf('/')<0).sort().filter(key=>!after||key.slice(path.length+1)>after).filter(key=>filters.every(([field,operator,value])=>operator==='in'?value.includes(records.get(key)[field]):records.get(key)[field]===value)).slice(0,bound).map(key=>snapshot(db.doc(key)));return {docs,size:docs.length};}};}
const request=(data,uid='owner')=>({data,auth:{uid,token:{email_verified:true,email:`${uid}@example.invalid`,admin:uid==='owner',firebase:{sign_in_second_factor:'totp'}}}});
beforeEach(()=>{
  records=new Map([['staff/owner',{active:true}],['members/member',{status:'approved',email:'member@example.invalid',membershipReference:'00001'}]]);objects=new Map();maxWrites=0;commits=0;generation=0;
  mock.method(db,'collection',path=>query(path));
  mock.method(db,'getAll',async(...refs)=>refs.map(snapshot));
  mock.method(db,'runTransaction',async handler=>{
    const writes=[];const tx={get:async ref=>snapshot(ref),getAll:async(...refs)=>refs.map(snapshot),set:(ref,data,options)=>writes.push(['set',ref,data,options]),create:(ref,data)=>writes.push(['create',ref,data]),update:(ref,data)=>writes.push(['update',ref,data]),delete:ref=>writes.push(['delete',ref])};
    const result=await handler(tx);
    maxWrites=Math.max(maxWrites,writes.length);commits++;
    for(const [method,ref,data,options] of writes){if(method==='delete')records.delete(ref.path);else {if(method==='create'&&records.has(ref.path))throw Error('duplicate create');records.set(ref.path,method==='update'||options?.merge?{...records.get(ref.path),...data}:data);}}
    return result;
  });
  // Direct reads/writes used outside transactions still operate only on this in-memory store.
  const docProto=Object.getPrototypeOf(db.doc('local/example'));
  mock.method(docProto,'get',async function(){return snapshot(this);});
  mock.method(docProto,'create',async function(data){if(records.has(this.path))throw Error('exists');records.set(this.path,data);});
  mock.method(auth,'getUsers',async()=>({users:[],notFound:[]}));
  mock.method(getStorage(),'bucket',()=>({name:'private-test-bucket',file:(path,opts)=>({save:async bytes=>{if(objects.has(path))throw Error('exists');objects.set(path,{bytes:Buffer.from(bytes),generation:String(++generation)});},getMetadata:async()=>[{generation:objects.get(path)?.generation}],download:async()=>{const object=objects.get(path);assert.equal(opts?.generation,object.generation);return [object.bytes];},delete:async()=>objects.delete(path)})}));
});
afterEach(()=>mock.restoreAll());
const event={title:'Field workshop',format:'Workshop',summary:'Summary',description:'Description',date:'2026-11-12',startsAt:'09:00',endsAt:'16:00',timezone:'Asia/Kuala_Lumpur',venue:'ISP hall',admission:'free',images:[]};
test('draft/preview/publish keeps prior public projection until exact actor-bound preview is consumed',async()=>{
  const data={kind:'event',id:'0123456789abcdef',expectedRevision:0,data:event};
  await content.saveContentDraftHandler(request(data));assert.equal(records.has('events/0123456789abcdef'),false);
  const receipt=await content.previewContentDraftHandler(request({kind:'event',id:data.id,expectedRevision:1}));
  await assert.rejects(content.publishContentDraftHandler(request({kind:'event',id:data.id,expectedRevision:1,expectedPreviewToken:'0'.repeat(64)})),{code:'failed-precondition'});
  await content.publishContentDraftHandler(request({kind:'event',id:data.id,expectedRevision:1,expectedPreviewToken:receipt.previewToken}));
  assert.equal(records.get('events/'+data.id).revision,1);
  await content.saveContentDraftHandler(request({...data,expectedRevision:1,data:{...event,title:'New draft'}}));
  assert.equal(records.get('events/'+data.id).data.title,event.title);
  await assert.rejects(content.publishContentDraftHandler(request({kind:'event',id:data.id,expectedRevision:2,expectedPreviewToken:receipt.previewToken})),{code:'failed-precondition'});
});
test('pending file scan and stale generation block publishing',async()=>{
  const attachmentId='file1',recordId='0123456789abcdef';
  records.set('contentAttachments/'+attachmentId,{kind:'event',parentId:recordId,role:'image',contentType:'image/png',generation:'1',sha256:'a'.repeat(64),finalizedAt:Timestamp.now(),scanStatus:'pending'});
  await content.saveContentDraftHandler(request({kind:'event',id:recordId,expectedRevision:0,data:{...event,images:[attachmentId]}}));
  const receipt=await content.previewContentDraftHandler(request({kind:'event',id:recordId,expectedRevision:1}));assert.equal(receipt.attachmentStatus,'pending');
  const publish=()=>content.publishContentDraftHandler(request({kind:'event',id:recordId,expectedRevision:1,expectedPreviewToken:receipt.previewToken}));
  await assert.rejects(publish(),{code:'failed-precondition'});assert.equal(records.has('events/'+recordId),false);
  records.get('contentAttachments/'+attachmentId).scanStatus='clean';records.get('contentAttachments/'+attachmentId).scan={generation:'2',sha256:'a'.repeat(64),scannerId:'trusted-scanner',scannedAt:Timestamp.now()};
  await assert.rejects(publish(),{code:'failed-precondition'});
});
test('consultation retry is idempotent and immutable while member/guest denial is server enforced',async()=>{
  const input={category:'Other enquiry',subject:'Advice',message:'Please review.',requestKey:'01234567-89ab-cdef-0123-456789abcdef'};
  records.get('members/member').displayName='Planter Member';
  const first=await content.submitConsultationHandler(request(input,'member')),again=await content.submitConsultationHandler(request(input,'member'));
  assert.deepEqual(again,first);assert.equal(records.get('consultations/'+first.id).ownerName,'Planter Member');assert.equal(records.get('consultations/'+first.id).ownerEmail,'member@example.invalid');assert.equal([...records.keys()].filter(key=>key.startsWith('consultations/')).length,1);
  await assert.rejects(content.submitConsultationHandler(request({...input,message:'Different'},'member')),{code:'already-exists'});
  await assert.rejects(content.submitConsultationHandler({data:input}),{code:'permission-denied'});
  records.get('members/member').status='suspended';await assert.rejects(content.submitConsultationHandler(request(input,'member')),{code:'permission-denied'});
});
test('registry import stages more than 500 changes without partial activation, preserves omissions and resumes idempotently',async()=>{
  const oldVersion='initial';records.set('registryState/current',{activeVersion:oldVersion,revision:1});
  for(let index=0;index<600;index++){const reference=String(index).padStart(5,'0');records.set(`memberRegistryVersions/${oldVersion}/entries/${sha(reference)}`,{name:`Old ${index}`,email:`old${index}@example.invalid`,memberReference:reference,status:'eligible',accessSuspended:index===0});}
  const csv='name,email,member_reference,status\n'+Array.from({length:501},(_,index)=>`New ${index},new${index}@example.invalid,N${String(index).padStart(5,'0')},eligible`).join('\n');
  const preview=await registry.previewRegistryImportHandler(request({csv}));assert.equal(preview.counts.omitted,600);assert.equal(preview.counts.add,501);
  const confirmation={previewId:preview.previewId,digest:preview.digest,registryVersion:preview.registryVersion};let status;let steps=0;
  do{status=await registry.confirmRegistryImportHandler(request(confirmation));steps++;if(status.state!=='confirmed')assert.equal(records.get('registryState/current').activeVersion,oldVersion);assert.ok(steps<20);}while(status.state!=='confirmed');
  assert.ok(steps>5);assert.ok(maxWrites<=102);assert.equal(records.get('registryState/current').revision,2);
  const active=records.get('registryState/current').activeVersion,all=[...records.keys()].filter(key=>key.startsWith(`memberRegistryVersions/${active}/entries/`));assert.equal(all.length,1101);
  assert.equal(records.get(`memberRegistryVersions/${active}/entries/${sha('00000')}`).accessSuspended,true);
  const repeated=await registry.confirmRegistryImportHandler(request(confirmation));assert.equal(repeated.state,'confirmed');assert.equal(records.get('registryState/current').revision,2);
});
test('registry rejects wrong confirmation and stale base version before active pointer mutation',async()=>{
  const preview=await registry.previewRegistryImportHandler(request({csv:'name,email,member_reference,status\nOne,one@example.invalid,00001,eligible'}));
  await assert.rejects(registry.confirmRegistryImportHandler(request({previewId:preview.previewId,digest:'0'.repeat(64),registryVersion:0})),{code:'failed-precondition'});
  records.set('registryState/current',{activeVersion:'other',revision:1});
  await assert.rejects(registry.confirmRegistryImportHandler(request({previewId:preview.previewId,digest:preview.digest,registryVersion:0})),{code:'failed-precondition'});
  assert.equal(records.get('registryState/current').activeVersion,'other');
});

test('public file metadata stays public for guests and unenrolled administrators before private guards',async()=>{
  const attachmentId='publicimage',recordId='publicevent';
  records.set('contentAttachments/'+attachmentId,{kind:'event',parentId:recordId,role:'image',bucket:'private-test-bucket',storagePath:`contentUploads/event/${recordId}/${attachmentId}`,contentType:'image/png',fileName:'Image.png',size:4,generation:'1',sha256:'a'.repeat(64),finalizedAt:Timestamp.now(),scanStatus:'clean',scan:{generation:'1',sha256:'a'.repeat(64),scannerId:'trusted',scannedAt:Timestamp.now()}});
  records.set('events/'+recordId,{data:{...event,images:[attachmentId],brochure:null}});
  const data={kind:'event',id:recordId,attachmentId};
  assert.equal((await content.getContentFileHandler({data})).delivery,'public-storage');
  assert.equal((await content.getContentFileHandler({data,auth:{uid:'owner',token:{admin:true,email_verified:false,firebase:{}}}})).delivery,'public-storage');
  records.get('events/'+recordId).data.images=[];
  await assert.rejects(content.getContentFileHandler({data}),{code:'permission-denied'});
});
