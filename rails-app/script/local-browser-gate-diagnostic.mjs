// Local HTTPS software fixture only. No provider, user browser profile or member data.
import fs from 'node:fs';
import https from 'node:https';
import {Readable} from 'node:stream';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {browserAccessEndpoint,validBrowserCookie} from '../cloudflare/staging/browser-access.js';
const ROOT=resolve(fileURLToPath(new URL('..',import.meta.url)));
const PRIVATE=process.env.ISP_LOCAL_BROWSER_PRIVATE||'D:/Projects/isp-rails-tools/isp-staging-private';
process.env.PLAYWRIGHT_BROWSERS_PATH||='D:/Projects/isp-rails-tools/virtual-browsers';
const require=createRequire(join(process.env.ISP_BROWSER_TOOL_ROOT||'D:/Projects/isp-rails-tools/virtual-browser-tools','package.json'));
if(require('playwright/package.json').version!=='1.64.1')throw Error('Pinned browser tools required');
const {chromium,webkit,devices}=require('playwright');
const key=randomBytes(32).toString('hex'),window={start:Date.now()-1000,end:Date.now()+120000};
const report={scope:'Dedicated localhost HTTPS fixture; certificate exception applies only to localhost. Production TLS is unchanged.',platform:process.platform,node_version:process.versions.node,playwright_version:require('playwright/package.json').version,results:[]};
let origin,env;
const server=https.createServer({key:fs.readFileSync(PRIVATE+'/local-browser-key.pem'),cert:fs.readFileSync(PRIVATE+'/local-browser-cert.pem'),minVersion:'TLSv1.2'},async(req,res)=>{
 try{
  if(req.headers.host!==new URL(origin).host){res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end('<!doctype html><a href="'+origin+'/cookie-check">Open cross-site check</a>');return;}
  const request=new Request(origin+req.url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:Readable.toWeb(req),duplex:'half'}:{})});
  let response=await browserAccessEndpoint(request,env,window,value=>value===key);
  if(!response&&req.url==='/cookie-check')response=new Response('cookie behavior check',{status:await validBrowserCookie(request,env,window)?200:403});
  if(!response){const allowed=await validBrowserCookie(request,env,window);response=allowed?new Response('<!doctype html><h1>Review cookie accepted</h1>',{headers:{'Content-Type':'text/html','Cache-Control':'no-store'}}):new Response('',{status:303,headers:{Location:'/__isp_review'}});}
  (report.server_requests||=[]).push({method:req.method,path:req.url,status:response.status,origin_matches:request.headers.get('Origin')===origin,content_type:request.headers.get('Content-Type'),cookie_present:(request.headers.get('Cookie')||'').includes('__Host-isp_acceptance='),issued_attributes:attributes(response.headers.get('Set-Cookie')||'')});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(500);res.end('Fixture request failed');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
origin='https://localhost:'+server.address().port;env={APP_HOST:new URL(origin).host,ISP_STAGING_KEY:key};
function attributes(raw=''){return{secure:/;\s*Secure(?:;|$)/i.test(raw),httpOnly:/;\s*HttpOnly(?:;|$)/i.test(raw),strict:/SameSite=Strict/i.test(raw),hostOnly:!/;\s*Domain=/i.test(raw),pathRoot:/;\s*Path=\/(?:;|$)/i.test(raw)}}
function components(cookie){return{present:!!cookie,secure:cookie?.secure,httpOnly:cookie?.httpOnly,sameSite:cookie?.sameSite,domain:cookie?.domain,path:cookie?.path,unexpired:cookie?cookie.expires*1000>Date.now():false,expiry_delta_ms:cookie?cookie.expires*1000-window.end:null,key_absent:cookie?!cookie.value.includes(key):true}}
try{
 for(const [name,engine,profile]of[['webkit',webkit,'iPhone 13'],['chromium',chromium,'Pixel 7']]){
  const browser=await engine.launch({headless:true});
  try{
   for(const mode of['api','rendered']){
    const result={engine:name,version:browser.version(),profile,mode};report.results.push(result);
    let context;
    try{
     context=await browser.newContext({...devices[profile],ignoreHTTPSErrors:true});const page=await context.newPage();page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(10000);
     let post;const entryStart=report.server_requests?.length||0;
     if(mode==='api'){
      post=await context.request.post(origin+'/__isp_review',{headers:{Origin:origin},form:{access_key:key},maxRedirects:0,timeout:10000});
      result.header_attributes=attributes(post.headers()['set-cookie']);
     }else{
      await page.goto(origin+'/__isp_review');
      await page.locator('input[name="access_key"]').fill(key);
      const pending=page.waitForResponse(r=>r.url()===origin+'/__isp_review'&&r.request().method()==='POST');
      [post]=await Promise.all([pending,page.getByRole('button',{name:'Open private review',exact:true}).click()]);
      result.header_attributes=attributes(await post.headerValue('set-cookie')||'');
     }
     result.post_status=post.status();
     const issued=(report.server_requests||[]).slice(entryStart).filter(r=>r.method==='POST'&&r.path==='/__isp_review');
     result.post_origin_matches=issued.length===1&&issued[0].origin_matches;
     result.server_issued_attributes=issued.length===1?issued[0].issued_attributes:null;
     const cookie=(await context.cookies(origin)).find(c=>c.name==='__Host-isp_acceptance');
     result.components=components(cookie);
     if(mode==='api')await page.goto(origin+'/');
     await page.getByRole('heading',{name:'Review cookie accepted',exact:true}).waitFor();
     result.browser_admitted=await page.getByRole('heading',{name:'Review cookie accepted',exact:true}).count()===1;
     result.secure_context=await page.evaluate(()=>isSecureContext);
     result.current_path=new URL(page.url()).pathname;
     const sameSiteStart=report.server_requests?.length||0;
     const sameSiteResponse=await page.goto(origin+'/cookie-check');
     const sameSite=(report.server_requests||[]).slice(sameSiteStart).filter(r=>r.method==='GET'&&r.path==='/cookie-check');
     result.same_site_cookie_accepted=sameSiteResponse.status()===200&&sameSite.length===1&&sameSite[0].status===200&&sameSite[0].cookie_present===true;
     await page.goto('https://127.0.0.1:'+server.address().port+'/cross-site');
     const crossSiteStart=report.server_requests?.length||0;
     const [crossSiteResponse]=await Promise.all([page.waitForResponse(r=>r.url()===origin+'/cookie-check'&&r.request().method()==='GET'),page.getByRole('link',{name:'Open cross-site check',exact:true}).click()]);
     const crossSite=(report.server_requests||[]).slice(crossSiteStart).filter(r=>r.method==='GET'&&r.path==='/cookie-check');
     result.cross_site_cookie_withheld=crossSiteResponse.status()===403&&crossSite.length===1&&crossSite[0].status===403&&crossSite[0].cookie_present===false;
    }catch(error){result.failure='Local diagnostic did not complete';fs.writeFileSync(PRIVATE+'/'+name+'-'+mode+'-localhost-error.txt',String(error.stack||error),{mode:0o600});}
    finally{await context?.close().catch(()=>{});}
   }
  }finally{await browser.close();}
 }
}finally{
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 report.finished_at=new Date().toISOString();fs.writeFileSync(ROOT+'/audit/local-browser-gate-diagnostic.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 process.exitCode=report.results.length===4&&report.results.every(r=>r.post_status===303&&r.post_origin_matches&&r.server_issued_attributes&&Object.values(r.server_issued_attributes).every(Boolean)&&r.browser_admitted&&r.secure_context&&r.current_path==='/'&&r.components?.present&&r.components.secure&&r.components.httpOnly&&r.components.sameSite==='Strict'&&r.components.domain==='localhost'&&r.components.path==='/'&&r.components.unexpired&&Number.isFinite(r.components.expiry_delta_ms)&&r.components.expiry_delta_ms<=1000&&r.components.expiry_delta_ms>=-2000&&r.components.key_absent&&r.same_site_cookie_accepted&&r.cross_site_cookie_withheld)?0:1;
}
