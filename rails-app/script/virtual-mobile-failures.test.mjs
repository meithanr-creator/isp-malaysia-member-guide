import test from 'node:test';
import assert from 'node:assert/strict';
import {OFFLINE_DASHBOARD_URL,classifyRequestFailure,acceptableOfflineNavigationError} from './virtual-mobile-failures.mjs';
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
