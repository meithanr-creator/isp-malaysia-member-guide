import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeContent,parseRegistryCsv,classifyRegistry,httpsUrl,sha} from '../lib/validation.js';

const event={title:'Field workshop',format:'Workshop',summary:'One day in the field.',description:'Practical discussion.',date:'2026-11-12',startsAt:'09:00',endsAt:'16:00',timezone:'Asia/Kuala_Lumpur',venue:'ISP hall',admission:'free',images:[]};
test('free event round trip clears payment data and retains valid preview',()=>{
  const draft=normalizeContent('event',{...event,fee:'500',bankName:'Old bank',paymentMethod:'bank'});
  assert.equal(draft.fee,'');assert.equal(draft.bankName,'');
  assert.deepEqual(normalizeContent('event',draft,true),draft);
});
test('event rejects invalid date/time and out-of-contract fee',()=>{
  for(const change of [{date:'2026-02-30'},{endsAt:'08:00'},{admission:'paid',fee:'0.001',paymentMethod:'organiser',receiptEmail:'team@example.invalid'},{images:['one','two','three','four']}])assert.throws(()=>normalizeContent('event',{...event,...change},true));
});
test('Discover permits fixed local default assets and rejects unsafe destinations',()=>{
  assert.equal(httpsUrl('https://example.invalid/path'),'https://example.invalid/path');
  for(const url of ['http://example.invalid','https://name:secret@example.invalid','https://example.invalid/%0a','https://example.invalid\\@evil.invalid',' https://example.invalid'])assert.throws(()=>httpsUrl(url));
  assert.throws(()=>normalizeContent('discover',{tag:'Tag',title:'Title',description:'Description',imageAlt:'Palm',websiteUrl:'https://example.invalid',defaultImage:'other.jpg'},true));
});
test('publication needs both bound attachment IDs before preview',()=>{
  assert.throws(()=>normalizeContent('publication',{title:'Book',description:'Description'},true));
  assert.equal(normalizeContent('publication',{title:'Book',description:'Description',cover:'cover-id',pdf:'pdf-id'},true).pdf,'pdf-id');
});
test('CSV preserves leading zeros, quoted names, normalized emails and omitted suspension',()=>{
  const rows=parseRegistryCsv('name,email,member_reference,status\r\n"Planter, One",ONE@example.invalid,00001,eligible\r\n');
  const result=classifyRegistry(rows,[{name:'Old',email:'one@example.invalid',memberReference:'00001',status:'ineligible',accessSuspended:true},{name:'Omitted',email:'two@example.invalid',memberReference:'00002',status:'eligible',accessSuspended:false}],new Map());
  assert.equal(rows[0].memberReference,'00001');assert.equal(rows[0].name,'Planter, One');assert.equal(rows[0].email,'one@example.invalid');
  assert.equal(rows[0].accessSuspended,true);assert.equal(result.counts.omitted,1);assert.equal(result.counts.update,1);assert.equal(result.errors.length,0);
});
test('CSV duplicate identities and altered pairing fail the exact preview',()=>{
  const rows=parseRegistryCsv('name,email,member_reference,status\nOne,one@example.invalid,00001,eligible\nTwo,ONE@example.invalid,00002,eligible');
  const result=classifyRegistry(rows,[{name:'Existing',email:'one@example.invalid',memberReference:'original',status:'eligible',accessSuspended:false}],new Map());
  assert.equal(result.counts.duplicates,2);assert.equal(result.counts.invalid,2);assert.match(result.errors.join(' '),/different membership reference/u);
});
test('CSV rejects extra columns, malformed quoting, over-limit rows/bytes, control characters and broken Unicode',()=>{
  for(const csv of ['name,email,member_reference,status,admin\nOne,one@example.invalid,1,eligible,true','name,email,member_reference,status\n"unterminated', 'name,email,member_reference,status\nOne,one@example.invalid,1,eligible\u0000','name,email,member_reference,status\nOne,one@example.invalid,\ud800,eligible','x'.repeat(2*1024*1024+1),'name,email,member_reference,status\n'+Array.from({length:5001},(_,index)=>`One,${index}@example.invalid,${index},eligible`).join('\n')])assert.throws(()=>parseRegistryCsv(csv));
});
test('CSV never converts administrator or unpaired accounts into memberships',()=>{
  for(const account of [{uid:'admin',admin:true,membershipReference:'00001'},{uid:'member',admin:false,membershipReference:null}]){
    const rows=parseRegistryCsv('name,email,member_reference,status\nOne,one@example.invalid,00001,eligible');
    assert.equal(classifyRegistry(rows,[],new Map([['one@example.invalid',account]])).counts.invalid,1);
  }
  assert.equal(sha('00001').length,64);assert.notEqual(sha('00001'),sha('1'));
});
