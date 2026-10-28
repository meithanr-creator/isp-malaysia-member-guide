import test from 'node:test';
import assert from 'node:assert/strict';
import {OFFLINE_DASHBOARD_URL,classifyRequestFailure,acceptableOfflineNavigationError,PRIVATE_FAILURE_FACT_LIMIT,privateRequestFailureFact,retainPrivateFailureFact,freezeFailureBeforeCleanup} from './virtual-mobile-failures.mjs';
const armed={armed:true,consumed:false};
const failure=(changes={})=>({url:OFFLINE_DASHBOARD_URL,method:'GET',isNavigationRequest:true,isMainFrame:true,errorText:'net::ERR_INTERNET_DISCONNECTED',...changes});
test('only the explicitly armed exact main-frame GET is expected',()=>{
 assert.equal(classifyRequestFailure(failure(),armed),'expected-offline-navigation');
 for(const facts of [{url:OFFLINE_DASHBOARD_URL+'?x=1'},{url:OFFLINE_DASHBOARD_URL+'/'},{url:OFFLINE_DASHBOARD_URL.replace('https:','http:')},{url:OFFLINE_DASHBOARD_URL.replace('/member/dashboard','/login')},{method:'POST'},{method:'get'},{isNavigationRequest:false},{isMainFrame:false},{isMainFrame:undefined}])assert.notEqual(classifyRequestFailure(failure(facts),armed),'expected-offline-navigation');
});
test('unarmed and already consumed failures remain fatal',()=>{
 for(const state of [{},{armed:false,consumed:false},{armed:true,consumed:true},{armed:1,consumed:false},{armed:true}])assert.notEqual(classifyRequestFailure(failure(),state),'expected-offline-navigation');
});
test('missing or empty failure text never proves offline failure',()=>{
 for(const errorText of [undefined,null,'',' ','\n',false,42])assert.equal(classifyRequestFailure(failure({errorText}),armed),'Request transport failure');
});
test('timeouts, closure, cancellation and abort are fatal even while armed',()=>{
 for(const errorText of ['Timeout 20000ms exceeded','timed out','timedout','time out','net::ERR_TIMED_OUT','Target page, context or browser has been closed','net::ERR_CONNECTION_CLOSED','net::ERR_ABORTED','Load cancelled','NSURLErrorCancelled']){assert.notEqual(classifyRequestFailure(failure({errorText}),armed),'expected-offline-navigation');assert.equal(acceptableOfflineNavigationError(errorText),false);}
});
test('both engines may report a nonempty ordinary network failure',()=>{
 for(const errorText of ['net::ERR_INTERNET_DISCONNECTED','The Internet connection appears to be offline.','Load failed']){assert.equal(classifyRequestFailure(failure({errorText}),armed),'expected-offline-navigation');assert.equal(acceptableOfflineNavigationError(errorText),true);}
 for(const value of [undefined,null,'',' ',12])assert.equal(acceptableOfflineNavigationError(value),false);
});
test('classification is pure and unexpected events retain redacted fatal labels',()=>{
 const facts=Object.freeze(failure()),state=Object.freeze(armed);assert.equal(classifyRequestFailure(facts,state),'expected-offline-navigation');assert.deepEqual(state,armed);assert.deepEqual(facts,failure());assert.equal(classifyRequestFailure(failure({url:'https://private.example/?token=secret'}),armed),'Request transport failure');assert.equal(classifyRequestFailure(null,armed),'Request transport failure');
});

import {publicReport as publicMobileReport} from './virtual-mobile-acceptance.mjs';

test('private failure facts keep method resource navigation phase and hashes without URL credentials queries or fragments',()=>{
 const secret='do-not-retain-private-token',facts=privateRequestFailureFact({url:'https://private-user:private-password@example.test/member/publications/signed-key?token='+secret+'#private-fragment',method:'GET',resourceType:'script',isNavigationRequest:false,isMainFrame:true,phase:'private_gate',requestPhase:'private_gate',errorText:'raw '+secret,httpStatus:429},'Asset HTTP failure');
 assert.equal(facts.method,'GET');assert.equal(facts.resource_type,'script');assert.equal(facts.navigation,false);assert.equal(facts.main_frame,true);assert.equal(facts.phase,'private_gate');assert.equal(facts.path_template,'/member/:route');assert.equal(facts.http_status,429);assert.match(facts.url_sha256,/^[a-f0-9]{64}$/);const raw=JSON.stringify(facts);for(const value of [secret,'private-user','private-password','signed-key','private-fragment','example.test'])assert.equal(raw.includes(value),false);
 const asset=privateRequestFailureFact({url:'https://fixture.test/assets/controllers/menu_controller-a1b2c3d4.js?token='+secret,resourceType:'script'},'Request cancelled');assert.equal(asset.asset_basename,'menu_controller-a1b2c3d4.js');assert.equal(asset.path_template,'/assets/:fingerprinted');assert.equal(JSON.stringify(asset).includes(secret),false);
});
test('private failure ledger is bounded and the first error survives later teardown cancellation noise',()=>{
 const result={errors:['Asset HTTP failure']},first=privateRequestFailureFact({url:'https://fixture.test/assets/application-a1b2c3d4.js',phase:'private_gate',resourceType:'script',httpStatus:429},'Asset HTTP failure');retainPrivateFailureFact(result,first);const snapshot=freezeFailureBeforeCleanup(result,'private_gate');for(let i=0;i<PRIVATE_FAILURE_FACT_LIMIT+10;i++)retainPrivateFailureFact(result,privateRequestFailureFact({phase:'private_gate',cleanup:true,url:'https://fixture.test/admin/private-'+i},'Request cancelled'));
 assert.equal(result.private_failure_facts.entries.length,PRIVATE_FAILURE_FACT_LIMIT);assert.equal(result.private_failure_facts.dropped,11);assert.deepEqual(result.private_failure_facts.first_error,first);assert.deepEqual(snapshot.first_error,first);assert.equal(snapshot.error_count,1);assert.equal(freezeFailureBeforeCleanup(result,'cleanup'),snapshot);
});
test('expected offline navigation does not take the primary failure slot and diagnostics stay out of public reports',()=>{
 const profile={name:'iphone-webkit',errors:['Request cancelled']};retainPrivateFailureFact(profile,privateRequestFailureFact({url:OFFLINE_DASHBOARD_URL,phase:'offline_privacy'},'expected-offline-navigation'),{fatal:false});assert.equal(profile.private_failure_facts.first_error,null);retainPrivateFailureFact(profile,privateRequestFailureFact({url:'https://fixture.test/assets/application-a1b2c3d4.js',phase:'private_gate'},'Request cancelled'));freezeFailureBeforeCleanup(profile,'private_gate');
 const publicText=JSON.stringify(publicMobileReport({profiles:{'iphone-webkit':profile}}));assert.equal(publicText.includes('private_failure_facts'),false);assert.equal(publicText.includes('url_sha256'),false);assert.equal(publicText.includes('private_failure_before_cleanup'),false);assert.equal(publicText.includes('Request cancelled'),true);
});
