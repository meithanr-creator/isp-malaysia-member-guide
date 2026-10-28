import fs from 'node:fs';
import {createRequire} from 'node:module';
import {connectLinuxWebKit,validServerId,closeLinuxWebKitConnection,boundedBrowserOperation} from './linux-webkit-connection.mjs';
const PRIVATE='D:/Projects/isp-rails-tools/isp-staging-private/leases/rails-staging-2';
const guard=ok=>{if(!ok)throw Error('Offline Linux WebKit smoke refused');};
const canonical=p=>fs.realpathSync(p).replaceAll('\\','/').toLowerCase()===p.toLowerCase();
let browser,context,phase='prerequisites';
async function main(){
 guard(process.platform==='win32'&&process.argv.length===3&&process.argv[2]==='--execute'&&validServerId(process.env.ISP_LINUX_WEBKIT_SERVER_ID));
 guard(fs.lstatSync(PRIVATE).isDirectory()&&!fs.lstatSync(PRIVATE).isSymbolicLink()&&canonical(PRIVATE));
 const tmp=PRIVATE+'/virtual-browser-tmp';try{fs.mkdirSync(tmp,{mode:0o700});}catch(e){guard(e.code==='EEXIST');}
 guard(fs.lstatSync(tmp).isDirectory()&&!fs.lstatSync(tmp).isSymbolicLink()&&canonical(tmp));process.env.TMP=tmp;process.env.TEMP=tmp;process.env.TMPDIR=tmp;
 process.env.PLAYWRIGHT_BROWSERS_PATH='D:/Projects/isp-rails-tools/virtual-browsers';
 for(const key of ['DEBUG','PWDEBUG','NODE_OPTIONS','NODE_PATH','NODE_COMPILE_CACHE'])delete process.env[key];
 const require=createRequire('D:/Projects/isp-rails-tools/virtual-browser-tools/package.json');guard(require('playwright/package.json').version==='1.64.1');const {webkit,devices}=require('playwright');
 try{
  phase='connection';browser=await connectLinuxWebKit(webkit,{privateRoot:PRIVATE,deadline:Date.now()+120000});phase='context';context=await boundedBrowserOperation(()=>browser.newContext({...devices['iPhone 13'],reducedMotion:'reduce'}));
  phase='page';await context.route('**/*',route=>route.abort());const page=await boundedBrowserOperation(()=>context.newPage());page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(10000);
  phase='render';await page.goto('about:blank');await page.setContent('<meta name="viewport" content="width=device-width"><p id="ready">Offline engine ready</p><button id="touch" style="width:100px;height:48px">Touch check</button>');
  guard(await page.locator('#ready').innerText()==='Offline engine ready');phase='touch';await boundedBrowserOperation(()=>page.evaluate(()=>{window.__touchCount=0;document.querySelector('#touch').addEventListener('touchstart',event=>{if(event.isTrusted&&event.touches.length===1)window.__touchCount++;});}));await page.locator('#touch').tap();const touch=await boundedBrowserOperation(()=>page.evaluate(()=>({trusted_touch_events:window.__touchCount,max_touch_points:navigator.maxTouchPoints,viewport_width:innerWidth})));guard(touch.trusted_touch_events===1&&touch.viewport_width===390);
  phase='screenshot';const file=`${PRIVATE}/linux-webkit/${process.env.ISP_LINUX_WEBKIT_SERVER_ID}/offline-smoke.png`;await page.screenshot({path:file});
  console.log(JSON.stringify({scope:'Offline virtual engine smoke only',engine:'WebKit',version:browser.version(),execution_platform:'linux',controller_platform:'win32',controller_pid_windows:process.pid,touch,profile:'iPhone 13',status:'pass'}));
 }finally{try{await closeLinuxWebKitConnection(()=>context?.close(),()=>{});}finally{if(browser)await closeLinuxWebKitConnection(()=>browser.close(),()=>{});}}
}
main().catch(error=>{try{const id=process.env.ISP_LINUX_WEBKIT_SERVER_ID,p=PRIVATE+'/linux-webkit/'+id;if(validServerId(id)&&fs.existsSync(p)&&canonical(p))fs.writeFileSync(p+'/offline-failure.json',JSON.stringify({phase,error:String(error?.stack||error)},null,2),{flag:'wx',mode:0o600});}catch{}console.error(JSON.stringify({error:'Offline Linux WebKit smoke refused or failed; private endpoint suppressed',phase}));process.exitCode=1;});
