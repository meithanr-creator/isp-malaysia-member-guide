const NAME='__Host-isp_acceptance',PATH='/__isp_review',MAX_BODY=1024;
const encoder=new TextEncoder();
const headers={'Cache-Control':'no-store','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
function response(body,status=200,extra={}){return new Response(body,{status,headers:{...headers,...extra}});}
function base64(bytes){return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
function unbase64(value){if(!/^[A-Za-z0-9_-]+$/.test(value))throw Error('Invalid review credential');return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));}
async function signingKey(env){if(!/^[a-f0-9]{64}$/.test(env.ISP_STAGING_KEY||''))throw Error('Review unavailable');return crypto.subtle.importKey('raw',Uint8Array.from(env.ISP_STAGING_KEY.match(/../g),s=>parseInt(s,16)),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
async function rehearsal(window){const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(`${window.start}|${window.end}`)));return base64(digest);}
export async function issueBrowserCookie(env,window,now=Date.now()){
 if(now<window.start||now>=window.end)throw Error('Review unavailable');
 const nonce=new Uint8Array(16);crypto.getRandomValues(nonce);
 const payload=base64(encoder.encode(JSON.stringify({v:1,n:base64(nonce),r:await rehearsal(window),e:window.end})));
 const signature=base64(new Uint8Array(await crypto.subtle.sign('HMAC',await signingKey(env),encoder.encode(payload))));
 if(Date.now()>=window.end)throw Error('Review unavailable');
 return `${NAME}=${payload}.${signature}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${Math.max(1,Math.floor((window.end-now)/1000))}; Expires=${new Date(window.end).toUTCString()}`;
}
function cookiePieces(request){return (request.headers.get('Cookie')||'').split(';').map(p=>p.trim()).filter(Boolean);}
export function headersWithoutReviewCookie(request){const result=new Headers(request.headers);const parts=cookiePieces(request).filter(p=>p.slice(0,p.indexOf('='))!==NAME);if(parts.length)result.set('Cookie',parts.join('; '));else result.delete('Cookie');return result;}
export async function validBrowserCookie(request,env,window,now=Date.now()){
 try{
  if(now<window.start||now>=window.end||(request.headers.get('Cookie')||'').length>16384)return false;
  const values=cookiePieces(request).filter(p=>p.slice(0,p.indexOf('='))===NAME).map(p=>p.slice(p.indexOf('=')+1));
  if(values.length!==1||values[0].length>512)return false;
  const pieces=values[0].split('.');if(pieces.length!==2)return false;
  const [payload,signature]=pieces;
  if(!await crypto.subtle.verify('HMAC',await signingKey(env),unbase64(signature),encoder.encode(payload)))return false;
  const value=JSON.parse(new TextDecoder().decode(unbase64(payload)));
  return value.v===1&&typeof value.n==='string'&&/^[A-Za-z0-9_-]{22}$/.test(value.n)&&value.e===window.end&&value.r===await rehearsal(window);
 }catch{return false;}
}
async function boundedForm(request,deadline){
 if(!/^application\/x-www-form-urlencoded(?:;|$)/i.test(request.headers.get('Content-Type')||''))return null;
 const length=Number(request.headers.get('Content-Length'));
 if(!Number.isFinite(length)||length>MAX_BODY||length<0)return null;
 if(!request.body)return null;
 const reader=request.body.getReader();let size=0,chunks=[],cancelled=false;
 const cancel=()=>{cancelled=true;void reader.cancel().catch(()=>{});};
 const timer=setTimeout(cancel,Math.max(1,Math.min(5000,deadline-Date.now())));
 request.signal.addEventListener('abort',cancel,{once:true});
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY){await reader.cancel();return null;}chunks.push(value);}}
 finally{clearTimeout(timer);request.signal.removeEventListener('abort',cancel);reader.releaseLock();}
 if(cancelled||Date.now()>=deadline)return null;
 const bytes=new Uint8Array(size);let position=0;for(const chunk of chunks){bytes.set(chunk,position);position+=chunk.length;}
 const params=new URLSearchParams(new TextDecoder().decode(bytes));
 return [...params.keys()].length===1&&params.getAll('access_key').length===1?params.get('access_key'):null;
}
export async function browserAccessEndpoint(request,env,window,verifyKey){
 const url=new URL(request.url);
 if(!url.pathname.startsWith(PATH))return null;
 if(url.search)return response('Private review access unavailable.',403);
 if(url.pathname===PATH&&request.method==='GET'){
  return response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ISP private review</title><style>body{font:20px/1.5 system-ui;background:#f4f7f3;color:#073e32;margin:0;padding:32px 20px}main{max-width:28rem;margin:10vh auto;background:white;padding:28px;border-radius:16px}h1{font-size:30px}label,input,button{display:block;width:100%;box-sizing:border-box}input,button{font:inherit;min-height:52px;margin-top:12px;padding:12px;border:1px solid #527467;border-radius:8px}button{background:#064b39;color:white;cursor:pointer}.exit{background:white;color:#064b39}</style><main><h1>ISP private review</h1><p>Enter your private review access code to continue.</p><form method="post" action="${PATH}"><label>Review access code<input type="password" name="access_key" maxlength="64" required autocomplete="off" autocapitalize="off" spellcheck="false"></label><button>Open private review</button></form><form method="post" action="${PATH}/exit"><button class="exit">Clear review access</button></form><p>Member sign-in is required inside the app.</p></main></html>`,200,{'Content-Type':'text/html; charset=utf-8'});
 }
 if(request.method!=='POST'||request.headers.get('Origin')!==`https://${env.APP_HOST}`)return response('Private review access unavailable.',403);
 if(url.pathname===`${PATH}/exit`)return response('',303,{Location:PATH,'Set-Cookie':`${NAME}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`});
 if(url.pathname!==PATH)return response('Private review access unavailable.',404);
 const key=await boundedForm(request,window.end);
 if(!key||!verifyKey(key))return response('Private review access unavailable.',403);
 return response('',303,{Location:'/', 'Set-Cookie':await issueBrowserCookie(env,window)});
}