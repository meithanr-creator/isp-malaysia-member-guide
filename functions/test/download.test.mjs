import test,{beforeEach,afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
process.env.GCLOUD_PROJECT='isp-planter-app';
const {Timestamp}=await import('firebase-admin/firestore');
const {getStorage}=await import('firebase-admin/storage');
const {db,auth}=await import('../lib/runtime.js');
const {authorizeDownload,verifiedBody,disposition,downloadContentFileHandler,DOWNLOAD_ORIGINS}=await import('../lib/download.js');
const {sha}=await import('../lib/validation.js');
let records;
const query={kind:'publication',id:'book1',attachmentId:'file1'};
const request=(uid='member',extra={})=>({data:{},auth:{uid,token:{email_verified:true,email:`${uid}@example.invalid`,admin:uid==='owner',firebase:{sign_in_second_factor:'totp'},...extra}}});
beforeEach(()=>{
  records=new Map([
    ['members/member',{status:'approved',email:'member@example.invalid',membershipReference:'00001',registryKey:sha('00001')}],
    ['staff/owner',{active:true}],['registryState/current',{activeVersion:'v1',revision:1}],
    [`memberRegistryVersions/v1/entries/${sha('00001')}`,{status:'eligible',accessSuspended:false,email:'member@example.invalid',memberReference:'00001'}],
    ['contentAttachments/file1',{kind:'publication',parentId:'book1',role:'pdf',bucket:'private-test',storagePath:'contentUploads/publication/book1/file1',contentType:'application/pdf',fileName:'Book.pdf',size:4,generation:'123',sha256:'a'.repeat(64),finalizedAt:Timestamp.now(),scanStatus:'clean',scan:{generation:'123',sha256:'a'.repeat(64),scannerId:'trusted-worker',scannedAt:Timestamp.now()}}],
    ['publications/book1',{data:{cover:null,pdf:'file1'}}],['publicationDrafts/book1',{data:{cover:null,pdf:'file1'}}],
  ]);
  const docProto=Object.getPrototypeOf(db.doc('local/example'));
  mock.method(docProto,'get',async function(){return {id:this.id,ref:this,exists:records.has(this.path),data:()=>records.get(this.path),get:key=>records.get(this.path)?.[key]};});
  mock.method(getStorage(),'bucket',()=>({name:'private-test'}));
});
afterEach(()=>mock.restoreAll());
test('stream authorization checks current approved registry membership and parent, denying guests/other users',async()=>{
  const file=await authorizeDownload(request(),query);assert.equal(file.generation,'123');
  await assert.rejects(authorizeDownload({data:{}},query),{code:'permission-denied'});
  await assert.rejects(authorizeDownload(request('other'),query),{code:'permission-denied'});
  records.get(`memberRegistryVersions/v1/entries/${sha('00001')}`).accessSuspended=true;
  await assert.rejects(authorizeDownload(request(),query),{code:'permission-denied'});
});
test('stream denies pending scan, mismatched exact generation and detached published parent',async()=>{
  const metadata=records.get('contentAttachments/file1');metadata.scanStatus='pending';await assert.rejects(authorizeDownload(request(),query),{code:'failed-precondition'});
  metadata.scanStatus='clean';metadata.scan.generation='other';await assert.rejects(authorizeDownload(request(),query),{code:'failed-precondition'});
  metadata.scan.generation='123';records.get('publications/book1').data.pdf=null;await assert.rejects(authorizeDownload(request(),query),{code:'permission-denied'});
});
test('TOTP administrator can preview only clean current draft files, with quarantine sealed',async()=>{
  records.get('publications/book1').data.pdf=null;
  assert.equal((await authorizeDownload(request('owner'),query)).generation,'123');
  await assert.rejects(authorizeDownload(request('owner',{firebase:{}}),query),{code:'permission-denied'});
  records.get('contentAttachments/file1').scanStatus='pending';await assert.rejects(authorizeDownload(request('owner'),query),{code:'failed-precondition'});
});
test('non-streaming body accepts at most25MiB and verifies all bytes before delivery',async()=>{
  const bytes=Buffer.alloc(25*1024*1024,7),hash=createHash('sha256').update(bytes).digest('hex');
  assert.deepEqual(await verifiedBody(Readable.from([bytes]),{size:bytes.length,sha256:hash}),bytes);
  await assert.rejects(verifiedBody(Readable.from([]),{size:bytes.length+1,sha256:hash}),{code:'resource-exhausted'});
  await assert.rejects(verifiedBody(Readable.from([Buffer.from('larger')]),{size:4,sha256:hash}),{code:'failed-precondition'});
  await assert.rejects(verifiedBody(Readable.from([Buffer.from('book')]),{size:4,sha256:'0'.repeat(64)}),{code:'failed-precondition'});
});
test('HTTP accepts bearer token only in header and verifies revocation before file authorization',async()=>{
  let verified=0;mock.method(auth,'verifyIdToken',async(token,revoked)=>{verified++;assert.equal(token,'test.header.signature');assert.equal(revoked,true);throw Error('revoked');});
  const response=()=>({headersSent:false,headers:{},statusCode:0,body:null,status(code){this.statusCode=code;return this;},set(name,value){if(typeof name==='string')this.headers[name]=value;else Object.assign(this.headers,name);return this;},removeHeader(name){delete this.headers[name];},json(body){this.body=body;return this;},destroy(){throw Error('unexpected destroy');}});
  const missing=response();await downloadContentFileHandler({method:'GET',headers:{},query:{...query,token:'test.header.signature'}},missing);assert.equal(missing.statusCode,401);assert.equal(verified,0);
  const revoked=response();await downloadContentFileHandler({method:'GET',headers:{authorization:'Bearer test.header.signature'},query},revoked);assert.equal(revoked.statusCode,401);assert.equal(verified,1);
  const wrongMethod=response();await downloadContentFileHandler({method:'POST',headers:{},query},wrongMethod);assert.equal(wrongMethod.statusCode,405);
});
test('download headers keep PDFs as attachments and restrict CORS to the two Hosting origins',()=>{
  assert.match(disposition({contentType:'application/pdf',fileName:'Book.pdf'}),/^attachment; filename="Book.pdf"/u);
  assert.match(disposition({contentType:'image/png',fileName:'Cover.png'}),/^inline;/u);
  assert.deepEqual(DOWNLOAD_ORIGINS,['https://isp-planter-app.web.app','https://isp-planter-app.firebaseapp.com']);
});
test('HTTP sends one verified binary PDF response with exposed generation/hash and private attachment headers',async()=>{
  const bytes=Buffer.from('book'),hash=createHash('sha256').update(bytes).digest('hex');records.get('contentAttachments/file1').sha256=hash;records.get('contentAttachments/file1').scan.sha256=hash;
  mock.method(auth,'verifyIdToken',async()=>({uid:'member',...request().auth.token}));
  getStorage().bucket.mock.restore();
  mock.method(getStorage(),'bucket',()=>({name:'private-test',file:(path,options)=>{assert.equal(path,'contentUploads/publication/book1/file1');assert.equal(options.generation,'123');return {getMetadata:async()=>[{generation:'123',size:4,contentType:'application/pdf'}],createReadStream:options=>{assert.equal(options.decompress,false);return Readable.from([bytes]);}};}}));
  class BinaryResponse {constructor(){this.headers={};this.statusCode=0;this.body=null;this.headersSent=false;this.sends=0;}status(code){this.statusCode=code;return this;}set(headers){Object.assign(this.headers,headers);return this;}removeHeader(name){delete this.headers[name];}send(bytes){this.headersSent=true;this.body=bytes;this.sends++;return this;}json(body){throw Error('Unexpected JSON error: '+JSON.stringify(body));}}
  const response=new BinaryResponse();await downloadContentFileHandler({method:'GET',headers:{authorization:'Bearer test.header.signature'},query},response);
  assert.equal(response.statusCode,200);assert.equal(response.sends,1);assert.equal(response.body.toString(),'book');assert.equal(response.headers['X-ISP-File-Generation'],'123');assert.equal(response.headers['X-ISP-File-SHA256'],hash);assert.equal(response.headers['Cache-Control'],'private, no-store');assert.equal(response.headers['X-Content-Type-Options'],'nosniff');assert.match(response.headers['Content-Disposition'],/^attachment;/u);
});

test('malformed registry state cannot bypass eligibility while root-approved initial null/missing/empty states remain inactive',async()=>{
  for(const value of [null,'',undefined]){records.set('registryState/current',value===undefined?{}:{activeVersion:value});assert.equal((await authorizeDownload(request(),query)).generation,'123');}
  records.delete('registryState/current');assert.equal((await authorizeDownload(request(),query)).generation,'123');
  for(const value of [42,true,{},[]]){records.set('registryState/current',{activeVersion:value});await assert.rejects(authorizeDownload(request(),query),{code:'permission-denied'});}
});
