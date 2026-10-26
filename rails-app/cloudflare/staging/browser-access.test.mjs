import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import worker,{stagingWindow} from './index.js';
import {issueBrowserCookie,validBrowserCookie,headersWithoutReviewCookie,browserAccessEndpoint} from './browser-access.js';
const HOST='isp-member-production.meithan-r.workers.dev',KEY='a'.repeat(64),COOKIE='__Host-isp_acceptance';
const NativeRequest=globalThis.Request;
globalThis.Request=class extends NativeRequest{constructor(input,init){super(input,init);const cf=init?.cf??input?.cf;if(cf)Object.defineProperty(this,'cf',{value:cf});}};
after(()=>{globalThis.Request=NativeRequest;});
function environment(){const now=Math.floor(Date.now()/1000)*1000;return {APP_HOST:HOST,ISP_STAGING_KEY:KEY,ISP_CONTAINER_ENABLED:'true',ISP_STAGING_START_AT:new Date(now-1000).toISOString().replace('.000Z','Z'),ISP_STAGING_EXPIRES_AT:new Date(now+120000).toISOString().replace('.000Z','Z'),ISP_DEMO_MODE:'false',ISP_ACCOUNT_EMAILS_ENABLED:'false',ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED:'false',DATABASE_URL:'postgresql://unit:unit@db.internal/isp?sslmode=verify-full',DB_SSLMODE:'verify-full',SECRET_KEY_BASE:'s'.repeat(128),STORAGE_BUCKET:'private',AWS_REGION:'auto',AWS_ACCESS_KEY_ID:'unit-access',AWS_SECRET_ACCESS_KEY:'unit-secret',MAIL_FROM:'staging@planterapp.co',ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY:'p'.repeat(64),ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY:'d'.repeat(64),ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT:'k'.repeat(64)};}
function request(path='/',init={}){return new Request(`https://${HOST}${path}`,{...init,cf:{colo:'KUL'},headers:{'CF-Connecting-IP':'203.0.113.1',...init.headers}});}
function post(body,extra={}){return request('/__isp_review',{method:'POST',body,headers:{Origin:`https://${HOST}`,'Content-Type':'application/x-www-form-urlencoded',...extra}});}
function cookieHeader(setCookie){return setCookie.split(';')[0];}
const verify=value=>value===KEY;
test('review form is private, does not echo credentials, and never acquires a container',async()=>{
 const env=environment();env.RAILS_CONTAINER=new Proxy({},{get(){assert.fail('No container for access form');}});
 const response=await worker.fetch(request('/__isp_review'),env);
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const body=await response.text();assert.match(body,/type="password"/);assert.equal(body.includes(KEY),false);
 assert.equal(response.headers.get('referrer-policy'),'same-origin');
 assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 assert.equal((await worker.fetch(request('/__isp_review'),{...env,ISP_CONTAINER_ENABLED:'false'})).status,503);
});
test('same-origin key POST issues a secure signed cookie with a fixed expiry and no raw key',async()=>{
 const env=environment(),window=stagingWindow(env);
 const response=await browserAccessEndpoint(post(`access_key=${KEY}`),env,window,verify);
 assert.equal(response.status,303);assert.equal(response.headers.get('Location'),'/');
 const cookie=response.headers.get('Set-Cookie');
 for(const flag of ['Path=/','Secure','HttpOnly','SameSite=Strict'])assert.ok(cookie.includes(flag));
 assert.equal(cookie.includes(KEY),false);assert.match(cookie,/Max-Age=\d+/);
 assert.equal(await validBrowserCookie(request('/',{headers:{Cookie:cookieHeader(cookie)}}),env,window),true);
 assert.equal(await response.text(),'');
});
test('wrong keys, cross-origin or missing origin, duplicate fields, unsupported type and oversized input fail closed',async()=>{
 const env=environment(),window=stagingWindow(env);
 for(const req of [post('access_key=wrong'),post(`access_key=${KEY}`,{Origin:'https://other.invalid'}),post(`access_key=${KEY}`,{Origin:''}),post(`access_key=${KEY}&access_key=${KEY}`),post(`access_key=${KEY}`,{'Content-Type':'application/json'}),post('access_key='+'a'.repeat(1500))]){
  const response=await browserAccessEndpoint(req,env,window,verify);assert.equal(response.status,403);assert.equal(response.headers.get('Set-Cookie'),null);assert.equal((await response.text()).includes(KEY),false);
 }
});
test('tampered, duplicate, expired and previous-rehearsal cookies are refused',async()=>{
 const env=environment(),window=stagingWindow(env),cookie=cookieHeader(await issueBrowserCookie(env,window));
 assert.equal(await validBrowserCookie(request('/',{headers:{Cookie:cookie}}),env,window),true);
 const index=cookie.indexOf('=')+4,tampered=cookie.slice(0,index)+(cookie[index]==='a'?'b':'a')+cookie.slice(index+1);
 assert.equal(await validBrowserCookie(request('/',{headers:{Cookie:tampered}}),env,window),false);
 assert.equal(await validBrowserCookie(request('/',{headers:{Cookie:cookie+'; '+cookie}}),env,window),false);
 assert.equal(await validBrowserCookie(request('/',{headers:{Cookie:cookie}}),env,window,window.end),false);
 assert.equal(await validBrowserCookie(request('/',{headers:{Cookie:cookie}}),env,{...window,start:window.start-1000}),false);
});
test('browser cookie authorizes only the private hop and is stripped while Rails cookies survive',async()=>{
 const env=environment(),window=stagingWindow(env),cookie=cookieHeader(await issueBrowserCookie(env,window));let forwarded;
 env.RAILS_CONTAINER={idFromName:name=>name,get:()=>({fetch:async req=>{forwarded=req;return new Response('app');}})};
 const response=await worker.fetch(request('/member/dashboard',{headers:{Cookie:`normal_session=opaque; ${cookie}`,'x-isp-staging-key':'b'.repeat(64)}}),env);
 assert.equal(await response.text(),'app');assert.ok(forwarded);
 assert.equal(forwarded.headers.get('x-isp-staging-key'),KEY);
 assert.equal(forwarded.headers.get('Cookie'),'normal_session=opaque');
 assert.equal(headersWithoutReviewCookie(request('/',{headers:{Cookie:cookie}})).has('Cookie'),false);
});
test('uncredentialed HTML navigation opens the review form; API/direct or forged paths cannot acquire containers',async()=>{
 const env=environment();env.RAILS_CONTAINER=new Proxy({},{get(){assert.fail('Unauthenticated binding access');}});
 const response=await worker.fetch(request('/',{headers:{Accept:'text/html'}}),env);
 assert.equal(response.status,303);assert.equal(response.headers.get('Location'),'/__isp_review');
 assert.equal((await worker.fetch(request('/member/dashboard'),env)).status,503);
 assert.equal((await worker.fetch(request(`/?access_key=${KEY}`),env)).status,503);
 assert.equal((await worker.fetch(request('/__isp_review?access_key=wrong'),env)).status,403);
 const foreign=new Request('https://another.invalid/__isp_review',{cf:{colo:'KUL'},headers:{'x-isp-staging-key':KEY,'CF-Connecting-IP':'203.0.113.1'}});
 assert.equal((await worker.fetch(foreign,env)).status,503);
});
test('review exit clears only its host cookie and rejects cross-origin exit',async()=>{
 const env=environment(),window=stagingWindow(env);
 const response=await browserAccessEndpoint(request('/__isp_review/exit',{method:'POST',headers:{Origin:`https://${HOST}`}}),env,window,verify);
 assert.equal(response.status,303);assert.match(response.headers.get('Set-Cookie'),/__Host-isp_acceptance=;.*Max-Age=0/);
 const rejected=await browserAccessEndpoint(request('/__isp_review/exit',{method:'POST',headers:{Origin:'https://other.invalid'}}),env,window,verify);
 assert.equal(rejected.status,403);assert.equal(rejected.headers.get('Set-Cookie'),null);
});
test('a slow review-key body is cancelled by the fixed window before a cookie can be issued',async()=>{
 const env=environment(),window={start:Date.now()-1000,end:Date.now()+20};let cancelled=false;
 const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('access_key='));},cancel(){cancelled=true;}});
 const req=request('/__isp_review',{method:'POST',body:stream,duplex:'half',headers:{Origin:`https://${HOST}`,'Content-Type':'application/x-www-form-urlencoded'}});
 const response=await browserAccessEndpoint(req,env,window,verify);
 assert.equal(response.status,403);assert.equal(cancelled,true);assert.equal(response.headers.get('Set-Cookie'),null);
});
test('only exact API-key clients may choose a trace; browser cookies cannot retrieve diagnostics',async()=>{
 const env=environment(),window=stagingWindow(env),chosen='00000000-0000-4000-8000-000000000001';
 const cookie=cookieHeader(await issueBrowserCookie(env,window));let forwarded;
 env.RAILS_CONTAINER={idFromName:name=>name,get:()=>({fetch:async req=>{forwarded=req;return new Response('app');}})};
 const browser=await worker.fetch(request('/events',{headers:{Cookie:cookie,'x-isp-trace':chosen}}),env);
 assert.equal(browser.status,200);assert.notEqual(forwarded.headers.get('x-isp-trace'),chosen);assert.equal(browser.headers.get('x-isp-trace'),forwarded.headers.get('x-isp-trace'));
 const api=await worker.fetch(request('/events',{headers:{'x-isp-staging-key':KEY,'x-isp-trace':chosen}}),env);
 assert.equal(api.status,200);assert.equal(forwarded.headers.get('x-isp-trace'),chosen);
 env.RAILS_CONTAINER=new Proxy({},{get(){assert.fail('Cookie-only diagnostic lookup acquired a binding');}});
 const denied=await worker.fetch(request('/__isp_diagnostics/'+chosen,{headers:{Cookie:cookie}}),env);assert.equal(denied.status,503);
});