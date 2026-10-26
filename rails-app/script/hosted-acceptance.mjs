// Bounded real-host HTTPS acceptance. No network without --execute.
// This driver never connects to a database. Operator status captures are required.
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {cleanTrace} from '../cloudflare/staging/diagnostics.js';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const PRIVATE='D:/Projects/isp-rails-tools/isp-staging-private';
const ORIGIN='https://isp-member-production.meithan-r.workers.dev';
const HTTP_FILE=path.join(PRIVATE,'acceptance-http.json');
const OBS_FILE=path.join(PRIVATE,'acceptance-db-observations.json');
const RESULT_FILE=path.join(ROOT,'audit','hosted-acceptance.json');
const decode=s=>String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi,(_,x)=>x[0]==='#'?String.fromCodePoint(parseInt(x.slice(x[1]==='x'?2:1),x[1]==='x'?16:10)):({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'}[x.toLowerCase()]));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
class Blocked extends Error {}
function check(ok,message){if(!ok)throw new Error(message);}
function safePath(file){const target=path.resolve(file);check(/^[dD]:[\\/]/.test(target),'Artifacts must stay on D');let cursor=target;while(!fs.existsSync(cursor))cursor=path.dirname(cursor);for(;;){check(!fs.lstatSync(cursor).isSymbolicLink(),'Reparse/symbolic paths refused');const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}check(/^[dD]:[\\/]/.test(fs.realpathSync(path.dirname(target))),'Resolved destination must stay on D');return target;}
function json(file){return JSON.parse(fs.readFileSync(safePath(file),'utf8'));}
function atomic(file,value){safePath(file);const tmp=file+'.tmp-'+crypto.randomBytes(5).toString('hex');fs.writeFileSync(tmp,JSON.stringify(value,null,2),{mode:0o600,flag:'wx'});fs.renameSync(tmp,file);}
function attrs(tag){const out={};for(const m of tag.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))out[m[1].toLowerCase()]=decode(m[2]??m[3]??m[4]??'');return out;}
function sameOrigin(target){const url=new URL(target,ORIGIN);check(url.origin===ORIGIN&&!url.username&&!url.password,'Cross-origin credential forwarding refused');return url;}
export function forms(html){return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].map(m=>{const a=attrs(m[1]),fields=new Map();for(const input of m[2].matchAll(/<input\b([^>]*)>/gi)){const x=attrs(input[1]);if(!x.name||'disabled'in x||['file','submit','button'].includes(x.type))continue;if(['checkbox','radio'].includes(x.type)&&!('checked'in x))continue;fields.set(x.name,x.value??'');}for(const input of m[2].matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)){const x=attrs(input[1]);if(x.name&&!('disabled'in x))fields.set(x.name,decode(input[2]));}for(const input of m[2].matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)){const x=attrs(input[1]);if(!x.name||'disabled'in x)continue;const options=[...input[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map(o=>({a:attrs(o[1]),text:decode(o[2])})).filter(o=>!('disabled'in o.a));const selected=options.find(o=>'selected'in o.a)??options[0];if(selected)fields.set(x.name,selected.a.value??selected.text);}return{action:sameOrigin(a.action||'/'),method:(a.method||'get').toUpperCase(),fields,html:m[2]};});}
function form(page,action){const found=forms(page.text).find(f=>f.action.pathname===action);check(found,'Expected live form was absent: '+action);check(found.fields.get('authenticity_token'),'Live CSRF token was absent');return found;}
class CookieJar{
  constructor(saved=[]){this.items=new Map(saved);}
  accept(headers,url){for(const line of headers??[]){const bits=line.split(';').map(x=>x.trim()),first=bits.shift(),at=first.indexOf('=');if(at<1)continue;const name=first.slice(0,at),value=first.slice(at+1),a=Object.fromEntries(bits.map(x=>{const n=x.indexOf('=');return[n<0?x.toLowerCase():x.slice(0,n).toLowerCase(),n<0?'':x.slice(n+1)];}));if(a.domain&&a.domain.replace(/^\./,'')!==url.hostname)continue;const scope=a.path||url.pathname.slice(0,url.pathname.lastIndexOf('/')+1)||'/';const key=name+'|'+scope;if(a['max-age']==='0'||(a.expires&&Date.parse(a.expires)<Date.now()))this.items.delete(key);else this.items.set(key,{name,value,path:scope,secure:'secure'in a,httpOnly:'httponly'in a});}}
  header(url){return [...this.items.values()].filter(c=>url.pathname===c.path||url.pathname.startsWith(c.path.endsWith('/')?c.path:c.path+'/')).sort((a,b)=>b.path.length-a.path.length).map(c=>c.name+'='+c.value).join('; ');}
  save(){return [...this.items];}
}
export function safeDiagnostic(value,id,deadline){
  const clean=cleanTrace(value,deadline);
  return clean&&value.id===id&&value.deadline===deadline&&Object.keys(value).length===Object.keys(clean).length&&Object.entries(clean).every(([key,item])=>value[key]===item)?clean:null;
}
class Transport{
  constructor(runtime,state){this.runtime=runtime;this.state=state;this.calls=state.request_count??0;this.active=0;this.waiters=[];this.traces=[];this.jars=new Map();this.stopAt=Date.parse(runtime.ISP_STAGING_EXPIRES_AT)-600000;check(Number.isFinite(this.stopAt)&&this.stopAt>Date.now(),'Unexpired fixed cleanup reserve required');check(Date.parse(runtime.ISP_STAGING_EXPIRES_AT)-Date.parse(state.execution_started)<=55*60000,'Rehearsal may last at most 55 minutes');check(/^[a-f0-9]{64}$/.test(runtime.ISP_STAGING_KEY),'Private rehearsal key required');}
  jar(alias){if(!this.jars.has(alias))this.jars.set(alias,new CookieJar(this.state.jars?.[alias]));return this.jars.get(alias);}
  async request(alias,target,{method='GET',body,upload=false,startup=false,key=this.runtime.ISP_STAGING_KEY,omitCookie=false,accept="text/html,application/json;q=0.9"}={}){
    const url=sameOrigin(target),limit=startup?120000:upload?45000:20000;
    check(!startup||(method==='GET'&&url.pathname==='/ready'),'Longer startup deadline is readiness-only');
    if(this.calls>=350||Date.now()+limit>=this.stopAt)throw new Blocked('Request budget or cleanup reserve reached');
    while(this.active>=2)await new Promise(resolve=>this.waiters.push(resolve));
    if(this.calls>=350||Date.now()+limit>=this.stopAt)throw new Blocked('Request budget or cleanup reserve reached');
    this.active++;this.calls++;this.state.request_count=this.calls;
    const started=Date.now(),jar=this.jar(alias),trace={id:crypto.randomUUID(),alias,method,path:url.pathname.replace(/\/(?:files\/[^/]+|event-files\/[^/]+|discover-images\/[^/]+)\/[^/]+/,'/protected-file/:key'),status:null,duration_ms:null};
    this.traces.push(trace);this.state.request_journal??=[];this.state.request_journal.push(trace);
    atomic(HTTP_FILE,this.state); // UUID is durable BEFORE any request bytes are sent.
    let result,failure;
    try{
      result=await new Promise((resolve,reject)=>{
        const headers={'Accept':accept,'Origin':ORIGIN,'Referer':ORIGIN+'/','User-Agent':'ISP-hosted-acceptance/1','x-isp-trace':trace.id};
        if(key!==null)headers['x-isp-staging-key']=key;
        if(!omitCookie&&jar.header(url))headers.Cookie=jar.header(url);
        if(body){headers['Content-Type']=body.type;headers['Content-Length']=body.bytes.length;}
        const req=https.request(url,{method,headers,rejectUnauthorized:true,signal:AbortSignal.timeout(limit)},res=>{
          jar.accept(res.headers['set-cookie'],url);const chunks=[],digest=crypto.createHash('sha256');let size=0;
          res.on('data',chunk=>{size+=chunk.length;if(size>30*1024*1024){res.destroy(Error('Response size limit'));return;}digest.update(chunk);chunks.push(chunk);});
          res.on('error',()=>reject(new Blocked('Response failed; inspect state before continuing')));
          res.on('end',()=>{const bytes=Buffer.concat(chunks);trace.status=res.statusCode;
            if(key===this.runtime.ISP_STAGING_KEY&&!url.pathname.startsWith('/__isp_diagnostics/')&&res.headers['x-isp-trace']!==trace.id){reject(new Blocked('Trusted request correlation unavailable; inspect state before continuing'));return;}
            resolve({url,status:res.statusCode,headers:res.headers,text:bytes.toString('utf8'),bytes,sha256:digest.digest('hex'),trace});
          });
        });
        req.on('error',()=>reject(new Blocked('HTTPS request failed or timed out; mutation outcome requires DB inspection')));
        if(body)req.write(body.bytes);req.end();
      });
    }catch(error){failure=error;}
    finally{trace.duration_ms=Date.now()-started;atomic(HTTP_FILE,this.state);this.active--;this.waiters.shift()?.();}
    if(key===this.runtime.ISP_STAGING_KEY&&!url.pathname.startsWith('/__isp_diagnostics/')&&
       (failure||result?.status>=500||(method!=='GET'&&url.pathname.startsWith('/admin/')&&result?.status>=400))){
      await this.captureDiagnostic(trace);
    }
    if(failure)throw failure;
    return result;
  }
  async captureDiagnostic(trace){
    trace.diagnostic_status='unknown';
    try{
      const result=await this.request('diagnostics','/__isp_diagnostics/'+trace.id,{omitCookie:true,accept:'application/json'});
      if(result.status===200){
        const value=JSON.parse(result.text),clean=value.version===1?safeDiagnostic(value.trace,trace.id,Date.parse(this.runtime.ISP_STAGING_EXPIRES_AT)):null;
        if(clean){trace.diagnostic=clean;trace.diagnostic_status='observed';}
      }
    }catch{} // Unknown or missing evidence NEVER authorizes replay.
    atomic(HTTP_FILE,this.state);
  }  async page(alias,target){let r=await this.request(alias,target);for(let i=0;i<4&&[301,302,303,307,308].includes(r.status);i++){check(r.headers.location,'Redirect location absent');r=await this.request(alias,sameOrigin(r.headers.location));}return r;}
  save(){this.state.jars={...this.state.jars,...Object.fromEntries([...this.jars].map(([alias,jar])=>[alias,jar.save()]))};}
}
function encoded(fields){return{type:'application/x-www-form-urlencoded',bytes:Buffer.from(new URLSearchParams(fields).toString())};}
function multipart(fields,files){const boundary='isp-'+crypto.randomBytes(16).toString('hex'),parts=[];for(const [name,value]of fields)parts.push(Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="'+name+'"\r\n\r\n'+value+'\r\n'));for(const file of files){check(/^[\w\[\]]+$/.test(file.field)&&/^[\w.-]+$/.test(file.name),'Controlled upload names required');parts.push(Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="'+file.field+'"; filename="'+file.name+'"\r\nContent-Type: '+file.type+'\r\n\r\n'),file.bytes,Buffer.from('\r\n'));}parts.push(Buffer.from('--'+boundary+'--\r\n'));return{type:'multipart/form-data; boundary='+boundary,bytes:Buffer.concat(parts)};}
export function eicarPdf(){
 const eicar=['X5O!P%@AP[4','\\PZX54(P^)7CC)7}','$EICAR-STANDARD-','ANTIVIRUS-TEST-FILE!$H+H*'].join('');
 const objects=['<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(eicar.txt) 7 0 R] >> >> >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>','<< /Length 0 >>\nstream\n\nendstream','<< /Producer (ISP controlled scanner acceptance) >>','<< /Type /EmbeddedFile /Subtype /text#2Fplain /Length '+Buffer.byteLength(eicar)+' >>\nstream\n'+eicar+'\nendstream','<< /Type /Filespec /F (eicar.txt) /EF << /F 6 0 R >> >>'];
 let data='%PDF-1.4\n',offsets=[];objects.forEach((item,i)=>{offsets.push(Buffer.byteLength(data));data+=(i+1)+' 0 obj\n'+item+'\nendobj\n';});const xref=Buffer.byteLength(data);data+='xref\n0 8\n0000000000 65535 f \n'+offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';return Buffer.from(data);
}
async function submit(t,alias,f,values={},files=[],options={}){const fields=new Map(f.fields);for(const[key,value]of Object.entries(values))fields.set(key,String(value));if(options.noCsrf)fields.delete('authenticity_token');check(f.method==='POST','Only actual POST forms may mutate');return t.request(alias,f.action,{method:'POST',body:files.length?multipart(fields,files):encoded(fields),upload:files.length>0});}
function expectRedirect(r,path){check([302,303].includes(r.status)&&r.headers.location&&sameOrigin(r.headers.location).pathname===path,'Expected redirect to '+path+'; received '+r.status);}
function expectStatus(r,status){check(r.status===status,'Expected HTTP '+status+'; received '+r.status);}
function expectText(r,text){check(r.text.includes(text),'Expected rendered content was absent');}
function links(html){return[...html.matchAll(/<(?:a|img|script|link)\b([^>]+)>/gi)].map(m=>attrs(m[1])).map(a=>a.href||a.src).filter(Boolean);}
function matchingLink(html,re){const value=links(html).find(x=>re.test(x));check(value,'Expected resource link was absent');return sameOrigin(value);}
function fields(prefix,data){return Object.fromEntries(Object.entries(data).map(([key,value])=>[prefix+'['+key+']',value]));}
function totp(secret,time=Date.now()){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='',raw=[];for(const char of secret.toUpperCase().replace(/\s/g,'')){check(alphabet.includes(char),'Invalid private setup-key format');bits+=alphabet.indexOf(char).toString(2).padStart(5,'0');}for(let i=0;i+8<=bits.length;i+=8)raw.push(parseInt(bits.slice(i,i+8),2));const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(time/30000)));const digest=crypto.createHmac('sha1',Buffer.from(raw)).update(counter).digest(),offset=digest[19]&15;return((digest.readUInt32BE(offset)&0x7fffffff)%1000000).toString().padStart(6,'0');}
function benignPdf(marker){const stream='BT /F1 12 Tf 30 90 Td ('+marker.replace(/[^\w -]/g,'')+' synthetic acceptance fixture) Tj ET';const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 150] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+Buffer.byteLength(stream)+' >>\nstream\n'+stream+'\nendstream'];let text='%PDF-1.4\n',offsets=[0];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(text));text+=(i+1)+' 0 obj\n'+object+'\nendobj\n';});const xref=Buffer.byteLength(text);text+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';return Buffer.from(text);}
const BATCHES=['identity','event-draft','event-publish','publication-draft','publication-publish','discover','engagement','event-republish','snapshot-withdraw','imports','critical-guards','critical-replace','logout','throttle','aged-stepup'];
const INVENTORY={
  consultation_csrf_negative:['critical-guards','consultation'],scanner_eicar_rejection:['critical-guards','platform'],discover_replaced_key:['critical-replace','discover'],publication_replaced_key:['critical-replace','publications'],
  edge_denial:['identity','platform'],health:['identity','platform'],visitor_denial:['identity','identity'],credential_rejection:['identity','identity'],member_login:['identity','identity'],admin_enrollment:['identity','identity'],profile_forgery:['identity','identity'],role_boundaries:['identity','identity'],response_headers:['identity','platform'],
  event_draft:['event-draft','events'],event_draft_files:['event-draft','events'],event_stale_edit:['event-draft','events'],event_publish:['event-publish','events'],event_public_files:['event-publish','events'],
  publication_draft:['publication-draft','publications'],publication_draft_privacy:['publication-draft','publications'],publication_publish:['publication-publish','publications'],publication_member_hash:['publication-publish','publications'],publication_later_draft:['publication-publish','publications'],
  discover_setup:['discover','discover'],discover_save:['discover','discover'],discover_rejections:['discover','discover'],
  interest_concurrency:['engagement','events'],consultation_concurrency:['engagement','consultation'],consultation_boundaries:['engagement','consultation'],roster_boundaries:['engagement','events'],
  event_free_republish:['event-republish','events'],interest_snapshot:['event-republish','events'],interest_withdraw:['snapshot-withdraw','events'],
  csv_confirm:['imports','identity'],csv_other_admin:['imports','identity'],csv_malformed:['imports','identity'],mail_disabled:['imports','identity'],logout_revocation:['logout','identity'],login_throttle:['throttle','identity'],
  mfa_replay_recovery_cancel:['critical-guards','identity'],mfa_aged_stepup_revocation:['aged-stepup','identity'],constructed_session_expiry:['manual','identity'],constructed_activation_reset:['manual','identity'],membership_suspension_reeligibility:['manual','identity'],csv_stale_collision_expiry:['manual','identity'],mfa_throttle:['manual','identity'],
  event_limits_timezone_payment_matrix:['manual','events'],roster_51_pagination:['manual','events'],event_csrf_negative:['critical-guards','events'],publication_limits_republish_old_keys:['manual','publications'],publication_csrf_negative:['critical-guards','publications'],discover_carousel_browser:['manual','discover'],discover_cross_orphan_replacement:['manual','discover'],consultation_limits_csrf:['manual','consultation'],
  neon_tls_schema:['operator','platform'],r2_private_roundtrip:['operator','platform'],scanner_eicar_outage_integrity:['operator','platform'],dependency_host_proxy_failures:['operator','platform'],runtime_memory_overlap:['operator','platform'],browser_mobile_accessibility_pwa:['browser','platform'],restore_rollback:['operator','platform'],sender_lost_mfa:['operator','identity'],cleanup_shutdown_cost:['operator','platform']
};
function lookup(row,key){return key.split('.').reduce((value,part)=>value?.[part],row);}
function matches(row,expected){return row!==undefined&&row!==null&&Object.entries(expected).every(([key,value])=>JSON.stringify(lookup(row,key))===JSON.stringify(value));}
function observationRulesMatch(obs, rules) {
  return rules.every(rule => {
    let source;
    if (rule.collection === 'actors') {
      source = obs.actors && Object.hasOwn(obs.actors, rule.alias)
        ? [obs.actors[rule.alias]] : undefined;
    } else if (rule.collection === 'counts') {
      source = obs.counts && typeof obs.counts === 'object'
        ? [obs.counts] : undefined;
    } else {
      source = obs[rule.collection];
    }

    if (!Array.isArray(source)) return false;
    const rows = source.filter(row => matches(row, rule.where ?? {}));
    if (!Number.isInteger(rule.count) || rows.length !== rule.count) return false;
    if (rule.equals && !rows.every(row => matches(row, rule.equals))) return false;

    if (rule.interest_count !== undefined &&
        !rows.every(row => Array.isArray(row.interests) &&
          row.interests.filter(i => i.user_id === rule.user_id).length ===
            rule.interest_count)) return false;

    if (rule.interest_equals &&
        !rows.every(row => {
          const interests = row.interests?.filter(i => i.user_id === rule.user_id);
          return interests?.length === 1 &&
            matches(interests[0], rule.interest_equals);
        })) return false;
    return true;
  });
}
function reconcile(state){let obs;try{obs=json(OBS_FILE);}catch{return;}const captured=Date.parse(obs.captured_at);if(obs.version!==1||obs.run_marker!==state.run_marker||JSON.stringify(obs.target)!==JSON.stringify(state.target)||!Number.isFinite(captured)||captured>Date.now()+5000)return;for(const c of Object.values(state.cases)){if(c.http!=='PASS'||c.status!=='BLOCKED'||!c.db?.length)continue;const cutoff=Date.parse(c.observed_after);if(!Number.isFinite(cutoff)||captured<cutoff)continue;const valid=observationRulesMatch(obs,c.db);c.status=valid?'PASS':'FAIL';c.db_observed_at=obs.captured_at;c.observation_sha256=hash(Buffer.from(JSON.stringify(obs)));const evidence=path.join(PRIVATE,'acceptance-db-'+INVENTORY[c.id][0]+'.json');atomic(evidence,obs);c.observation_file=evidence;c.reason=valid?undefined:'Independent persisted-state assertion failed';c.assertions.push(valid?'Fresh independent persisted-state assertions matched':'Fresh independent persisted-state assertions failed');}}
function publicReport(state){const cases=Object.entries(INVENTORY).map(([id,[batch,area]])=>{const c=state.cases[id]??{id,area,status:'NOT RUN',http:'NOT RUN',assertions:[]};return{id,area,batch,status:c.status,http:c.http,started_at:c.started_at,finished_at:c.finished_at,assertions:c.assertions,requests:c.requests,db_observed_at:c.db_observed_at,observation_sha256:c.observation_sha256,reason:c.reason};});return{version:1,run_marker:state.run_marker,candidate:state.candidate,deployment_id:state.deployment_id,origin:ORIGIN,generated_at:new Date().toISOString(),requests:state.request_count??0,areas:Object.fromEntries([...new Set(cases.map(c=>c.area))].map(area=>{const rows=cases.filter(c=>c.area===area);return[area,rows.some(c=>c.status==='FAIL')?'FAIL':rows.every(c=>c.status==='PASS')?'PASS':'BLOCKED'];})),cases};}
async function execute(batch){
  check(!process.env.NODE_TLS_REJECT_UNAUTHORIZED||process.env.NODE_TLS_REJECT_UNAUTHORIZED==='1','Insecure ambient TLS setting refused');
  const runtime=json(path.join(PRIVATE,'runtime.json')),fixtures=json(path.join(PRIVATE,'acceptance-fixtures.json'));
  check(fixtures.version===1&&fixtures.phase==='active'&&/^qa-\d{8}-[a-f0-9]{12}$/.test(fixtures.run_marker),'Active reviewed fixture manifest required');
  check(runtime.APP_HOST===new URL(ORIGIN).hostname&&runtime.RAILS_ENV==='production'&&runtime.ISP_DEMO_MODE==='false','Exact hosted production mode required');
  check(runtime.ISP_ACCOUNT_EMAILS_ENABLED==='false'&&runtime.ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED==='false','Disabled identity mail flags required');
  check(/^[a-f0-9]{40}$/.test(runtime.CANDIDATE_COMMIT??'')&&/^[a-zA-Z0-9_-]{6,128}$/.test(runtime.CLOUDFLARE_DEPLOYMENT_ID??''),'Pinned candidate commit and deployment ID required');
  check(BATCHES.includes(batch),'Choose one listed batch');
  let state;if(fs.existsSync(HTTP_FILE))state=json(HTTP_FILE);
  if(state){check(state.run_marker===fixtures.run_marker&&state.candidate===runtime.CANDIDATE_COMMIT&&state.deployment_id===runtime.CLOUDFLARE_DEPLOYMENT_ID&&JSON.stringify(state.target)===JSON.stringify(fixtures.target),'Checkpoint candidate/deployment/target mismatch');check(!state.halted&&!state.running_batch,'Prior interrupted/failed execution requires inspection; automatic retry refused');check(!state.completed_batches?.includes(batch),'Completed batch cannot be replayed');reconcile(state);check(!Object.values(state.cases).some(c=>c.http==='PASS'&&c.db?.length&&c.status!=='PASS'),'Capture fresh independent observations and reconcile before another batch');}
  else {check(batch==='identity','Identity must be the first batch');state={version:1,run_marker:fixtures.run_marker,target:fixtures.target,candidate:runtime.CANDIDATE_COMMIT,deployment_id:runtime.CLOUDFLARE_DEPLOYMENT_ID,execution_started:new Date().toISOString(),cases:{},actors:{},completed_batches:[],created:{events:[],publications:[],consultations:[],imports:[],discover:[]}};}
  check(BATCHES.slice(0,BATCHES.indexOf(batch)).every(b=>state.completed_batches.includes(b)),'Prior batches must finish with independent evidence');
  state.running_batch=batch;
  const t=new Transport(runtime,state),mark=fixtures.run_marker;atomic(HTTP_FILE,state);
  function save(){t.save();state.request_count=t.calls;atomic(HTTP_FILE,state);reconcile(state);atomic(HTTP_FILE,state);atomic(RESULT_FILE,publicReport(state));}
  async function run(id,fn){const [,area]=INVENTORY[id]??[];check(area&&INVENTORY[id][0]===batch,'Case inventory/batch mismatch');const c={id,area,status:'NOT RUN',http:'NOT RUN',started_at:new Date().toISOString(),assertions:[],db:[]},start=t.traces.length;state.cases[id]=c;try{if(state.halted)throw new Blocked('Earlier failure halted the run; inspect before any further requests');await fn(c);c.http='PASS';c.status=c.db.length?'BLOCKED':'PASS';if(c.db.length)c.reason='Awaiting fresh independent DB observation';}catch(error){c.http=error instanceof Blocked?'BLOCKED':'FAIL';c.status=c.http;c.reason=error instanceof Blocked?error.message:'HTTP assertion failed; inspect private checkpoint';c.private_failure=error.message;state.halted=true;}c.requests=t.traces.slice(start);c.observed_after=new Date().toISOString();c.finished_at=c.observed_after;save();}
  async function otp(alias){const actor=state.actors[alias];check(actor?.totp_secret,'Protected authenticator setup key required');let step=Math.floor(Date.now()/30000);if(step<=(actor.last_otp_step??-1)){const wait=(step+1)*30000-Date.now()+50;if(Date.now()+wait+45000>=t.stopAt)throw new Blocked('Cleanup reserve prevents waiting for a fresh TOTP');await new Promise(resolve=>setTimeout(resolve,wait));step=Math.floor(Date.now()/30000);}actor.last_otp_step=step;return totp(actor.totp_secret);}
  async function login(alias,{admin=false}={}){const actor=fixtures.actors[alias];check(actor?.email&&actor?.password,'Reviewed actor fixture missing');const page=await t.page(alias,'/login');expectStatus(page,200);let r=await submit(t,alias,form(page,'/session'),{email:actor.email,password:actor.password,role:'admin',user_id:fixtures.actors.admin_a.id});if(!admin){expectRedirect(r,'/member/dashboard');return;}expectRedirect(r,'/two-factor');expectRedirect(await t.request(alias,'/admin/events'),'/login');const factor=await t.page(alias,'/two-factor');expectStatus(factor,200);const secret=decode(factor.text.match(/<code[^>]*class="auth-setup-key"[^>]*>([^<]+)<\/code>/)?.[1]??'');check(secret,'Real protected MFA enrollment key absent');state.actors[alias]={totp_secret:secret};atomic(HTTP_FILE,state);r=await submit(t,alias,form(factor,'/two-factor'),{otp_code:await otp(alias)});expectRedirect(r,'/two-factor/recovery-codes');const codes=await t.request(alias,'/two-factor/recovery-codes');expectStatus(codes,200);state.actors[alias].recovery_codes=[...codes.text.matchAll(/<code>([^<]+)<\/code>/g)].map(m=>decode(m[1]));check(state.actors[alias].recovery_codes.length>0,'Recovery codes absent');expectRedirect(await t.request(alias,'/two-factor/recovery-codes'),'/admin/events');}
  const actorRule=(alias,equals)=>({collection:'actors',alias,count:1,equals});
  const eventRule=(equals,extra={})=>({collection:'events',where:{slug:state.event.slug},count:1,equals,...extra});
  const pubRule=equals=>({collection:'publications',where:{slug:state.publication.slug},count:1,equals});
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYZkAAAAASUVORK5CYII=','base64');
  const pdf=benignPdf(mark);
  const file=(field,kind)=>({field,name:mark+'-'+kind+(kind.includes('image')||kind==='cover'?'.png':'.pdf'),type:kind.includes('image')||kind==='cover'?'image/png':'application/pdf',bytes:kind.includes('image')||kind==='cover'?png:pdf});
  async function fresh(){let page=await t.request('admin_a','/admin/events/new');if([302,303].includes(page.status)&&sameOrigin(page.headers.location).pathname==='/admin/verification'){page=await t.page('admin_a',page.headers.location);expectStatus(page,200);const r=await submit(t,'admin_a',form(page,'/admin/verification'),{password:fixtures.actors.admin_a.password,otp_code:await otp('admin_a')});check([302,303].includes(r.status),'Administrator step-up did not succeed');page=await t.page('admin_a','/admin/events/new');}expectStatus(page,200);return page;}
  async function download(alias,url,expected){const r=await t.request(alias,url,{upload:true});expectStatus(r,200);check(r.sha256===hash(expected),'Protected file bytes/hash differed');return r;}
  function recordLocation(r,re){check([302,303].includes(r.status),'Creation did not redirect');const url=sameOrigin(r.headers.location);const match=url.pathname.match(re);check(match,'Created record location did not match the live route');return{url,slug:match[1]};}
  function csrf(page) {
  for (const tag of page.text.matchAll(/<meta\b([^>]*)>/gi)) {
    const a = attrs(tag[1]);
    if (a.name === 'csrf-token' && a.content) return a.content;
  }
  const found = forms(page.text).find(f => f.fields.has('authenticity_token'));
  check(found, 'Live caller CSRF token required');
  return found.fields.get('authenticity_token');
}
  function forgedForm(page,action,method='patch'){return{action:sameOrigin(action),method:'POST',fields:new Map([['authenticity_token',csrf(page)],['_method',method]])};}
  if(batch==='identity'){
    await run('edge_denial',async c=>{for(const key of[null,'0'.repeat(64)]){const r=await t.request('edge','/member/dashboard',{key,omitCookie:true,accept:'application/json'});expectStatus(r,503);check(r.text==='ISP member service is not available yet.'&&String(r.headers['cache-control']).includes('no-store'),'Private edge denial must be generic and uncached');}const html=await t.request('edge','/member/dashboard',{key:null,omitCookie:true});expectRedirect(html,'/__isp_review');c.assertions.push('Missing and wrong API keys denied generically; HTML opens private review; Rails authentication not claimed');});
    await run('health',async c=>{for(const route of['/ready','/up'])expectStatus(await t.request('visitor',route,{startup:route==='/ready'}),200);c.assertions.push('Hosted process and dependency readiness returned 200');});
    await run('visitor_denial',async c=>{for(const route of['/member/dashboard','/member/membership','/admin/events','/admin/publications','/admin/discover','/admin/consultation_requests','/member/consultation_requests'])expectRedirect(await t.request('visitor',route),'/login');c.assertions.push('Rails visitor denied across member and administrator routes');});
    await run('credential_rejection',async c=>{for(const alias of['pending','suspended','unverified','ineligible','unknown','sample']){const a=fixtures.actors[alias],page=await t.page('reject_'+alias,'/login');const r=await submit(t,'reject_'+alias,form(page,'/session'),{email:a?.email??(alias==='sample'?'member@example.com':mark+'-unknown@staging.planterapp.co'),password:a?.password??crypto.randomBytes(24).toString('hex')});expectStatus(r,422);expectText(r,'The email or password did not match.');expectRedirect(await t.request('reject_'+alias,'/member/dashboard'),'/login');}for(const alias of['pending','suspended','unverified','ineligible'])c.db.push(actorRule(alias,{active_session_count:0}));c.assertions.push('Pending, suspended, unverified, ineligible, unknown and sample identities receive generic rejection');});
    await run('member_login',async c=>{await login('member_a');await login('member_b');for(const alias of['member_a','member_b']){const r=await t.request(alias,'/member/membership');expectStatus(r,200);expectText(r,fixtures.actors[alias].member_reference);c.db.push(actorRule(alias,{email:fixtures.actors[alias].email,role:'member',account_status:'active'}));}c.assertions.push('Two independent synthetic members signed in; stored leading-zero references rendered');});
    await run('admin_enrollment',async c=>{await login('admin_a',{admin:true});await login('admin_b',{admin:true});for(const alias of['admin_a','admin_b'])c.db.push(actorRule(alias,{mfa_enabled:true,role:'admin',account_status:'active'}));c.assertions.push('Two actual protected setup keys enrolled via current TOTP; pending challenge denied admin routes; recovery display shown once');});
    await run('profile_forgery',async c=>{const p=await t.page('member_a','/member/profile/edit'),r=await submit(t,'member_a',form(p,'/member/profile'),fields('user',{name:mark+' updated member',company:'Synthetic updated estate',branch:'Synthetic updated branch',phone:'+60000000000',email:fixtures.actors.admin_a.email,role:'admin',account_status:'suspended',id:fixtures.actors.member_b.id,user_id:fixtures.actors.member_b.id}));expectRedirect(r,'/member/dashboard');c.db.push(actorRule('member_a',{name:mark+' updated member',company:'Synthetic updated estate',branch:'Synthetic updated branch',phone:'+60000000000',email:fixtures.actors.member_a.email,role:'member',account_status:'active'}),actorRule('member_b',{name:mark+' member_b',email:fixtures.actors.member_b.email,role:'member',account_status:'active'}));c.assertions.push('Allowed profile fields saved; forged security and ownership fields ignored');});
    await run('role_boundaries',async c=>{for(const route of['/admin/events','/admin/publications','/admin/discover','/admin/membership_imports/new','/admin/consultation_requests'])expectStatus(await t.request('member_a',route),403);for(const route of['/member/membership','/member/consultation_requests/new','/member/profile/edit'])expectStatus(await t.request('admin_a',route),403);c.assertions.push('Member/admin read boundaries enforced');});
    await run('response_headers',async c=>{const r=await t.request('member_a','/member/dashboard');expectStatus(r,200);check(/no-store/.test(r.headers['cache-control']??''),'Private no-store missing');check(r.headers['x-content-type-options']==='nosniff','nosniff missing');check((r.headers['content-security-policy']??'').includes('nonce-'),'CSP nonce missing');const cookies=[...t.jar('member_a').items.values()];check(cookies.some(x=>x.secure&&x.httpOnly),'Secure HttpOnly session cookie absent');const loginPage=await t.page('header_probe','/login');check(loginPage.headers['referrer-policy']==='no-referrer','Authentication no-referrer missing');c.assertions.push('No-store, nosniff, CSP nonce and secure HttpOnly session cookie verified');});
  }
  if(batch==='event-draft'){
    await run('event_draft',async c=>{const p=await fresh(),values=fields('event',{title:mark+' paid event',format:'Workshop',summary:'Synthetic hosted acceptance workshop',description:'Synthetic event. DO NOT PAY OR TRANSFER.',audience:'Synthetic acceptance actors',programme:'09:00 Synthetic session',date:new Date(Date.now()+7*86400000).toISOString().slice(0,10),starts_at:'09:00',ends_at:'10:00',timezone:'Asia/Kuala_Lumpur',venue:'Synthetic online venue',venue_details:'No real attendance',admission:'paid',fee:'12.34',payment_method:'bank',bank_name:'SYNTHETIC DO NOT TRANSFER',account_name:'SYNTHETIC ACCEPTANCE ONLY',account_number:'SYNTHETIC-0000',receipt_email:mark+'-receipts@staging.planterapp.co',payment_notes:'DO NOT TRANSFER. Acceptance fixture only.'});const r=await submit(t,'admin_a',form(p,'/admin/events'),{...values,intent:'preview'},[file('event[images][]','event-image'),file('event[brochure]','brochure')]);const location=recordLocation(r,/^\/admin\/events\/([^/]+)\/preview$/);state.event={slug:location.slug,title:values['event[title]']};state.created.events.push(state.event.slug);const preview=await t.request('admin_a',location.url);expectStatus(preview,200);expectText(preview,state.event.title);state.event.publish_form=form(preview,'/admin/events/'+state.event.slug+'/publish');state.event.publish_fields=[...state.event.publish_form.fields];delete state.event.publish_form;state.event.preview_links=links(preview.text).filter(x=>/\/event-files\//.test(x));check(state.event.preview_links.length>=2,'Preview upload links missing');c.db.push(eventRule({draft_title:state.event.title,published_title:null,preview_revision:Number(new Map(state.event.publish_fields).get('revision'))}));c.assertions.push('Actual editor created paid synthetic draft with scanned image/PDF and current preview revision');});
    await run('event_draft_files',async c=>{const slug=state.event.slug;expectStatus(await t.request('visitor','/events/'+slug),404);for(const target of state.event.preview_links){const r=await t.request('admin_a',target,{upload:true});expectStatus(r,200);check([hash(pdf),hash(png)].includes(r.sha256),'Draft file hash differs');expectStatus(await t.request('visitor',target),404);expectStatus(await t.request('member_a',target),404);}c.assertions.push('Draft event and exact uploaded bytes private from visitor and member');});
    await run('event_stale_edit',async c=>{const slug=state.event.slug,p=await t.page('admin_a','/admin/events/'+slug+'/edit'),f=form(p,'/admin/events/'+slug);for(const version of['','not-a-version','999999'])expectStatus(await submit(t,'admin_a',f,{...fields('event',{lock_version:version,title:mark+' forbidden stale overwrite'}),intent:'draft'}),422);c.db.push(eventRule({draft_title:state.event.title,published_title:null}));c.assertions.push('Missing/malformed/stale edit versions rejected without draft overwrite');});
  }
  if(batch==='event-publish'){
    await run('event_publish',async c=>{await fresh();const slug=state.event.slug,p=await t.page('admin_a','/admin/events/'+slug+'/preview'),f=form(p,'/admin/events/'+slug+'/publish');expectRedirect(await submit(t,'admin_a',f,{revision:'999999'}),'/admin/events/'+slug+'/edit');const r=await submit(t,'admin_a',f);expectRedirect(r,'/events/'+slug);const published=await t.request('visitor',r.headers.location);expectStatus(published,200);expectText(published,state.event.title);expectText(published,'SYNTHETIC DO NOT TRANSFER');state.event.public_links=links(published.text).filter(x=>/\/event-files\//.test(x));state.event.published_revision=Number(f.fields.get('revision'));c.db.push(eventRule({published_title:state.event.title,published_revision:state.event.published_revision,'published_data.admission':'paid','published_data.payment_method':'bank','published_data.fee':'12.34'}));c.assertions.push('Stale reviewed revision rejected; exact paid-bank preview published via actual form');});
    await run('event_public_files',async c=>{check(state.event.public_links.length>=2,'Public event upload links absent');for(const target of state.event.public_links){const r=await t.request('visitor',target,{upload:true});expectStatus(r,200);check([hash(pdf),hash(png)].includes(r.sha256),'Public event file hash differs');const bad=sameOrigin(target);bad.pathname=bad.pathname.replace(/[^/]+$/,'invalid-key');expectStatus(await t.request('visitor',bad),404);}c.assertions.push('Published images/PDF served exact bytes; invalid keys denied');});
  }
  if(batch==='publication-draft'){
    await run('publication_draft',async c=>{await fresh();const p=await t.page('admin_a','/admin/publications/new'),r=await submit(t,'admin_a',form(p,'/admin/publications'),{...fields('publication',{title:mark+' publication',subtitle:'Synthetic issue',author:'Synthetic acceptance',issue_date:new Date().toISOString().slice(0,10),description:'Synthetic hosted publication with harmless PDF and image.'}),intent:'preview'},[file('publication[pdf]','publication'),file('publication[cover]','cover')]);const location=recordLocation(r,/^\/admin\/publications\/([^/]+)\/preview$/);state.publication={slug:location.slug,title:mark+' publication'};state.created.publications.push(location.slug);const preview=await t.request('admin_a',location.url);expectStatus(preview,200);expectText(preview,state.publication.title);state.publication.preview_links=links(preview.text).filter(x=>/\/files\/(pdf|cover)\//.test(x));check(state.publication.preview_links.length===2,'Publication preview cover/PDF absent');const f=form(preview,'/admin/publications/'+location.slug+'/publish');state.publication.preview_revision=Number(f.fields.get('revision'));c.db.push(pubRule({draft_title:state.publication.title,published_title:null,preview_revision:state.publication.preview_revision}));c.assertions.push('Protected editor created and previewed real scanned cover and PDF');});
    await run('publication_draft_privacy',async c=>{const slug=state.publication.slug;expectStatus(await t.request('member_a','/member/publications/'+slug),404);for(const target of state.publication.preview_links){await download('admin_a',target,/\/pdf\//.test(target)?pdf:png);expectRedirect(await t.request('visitor',target),'/login');expectStatus(await t.request('member_a',target),403);}c.assertions.push('Draft publication files available only to verified administrator');});
  }
  if(batch==='publication-publish'){
    await run('publication_publish',async c=>{await fresh();const slug=state.publication.slug,p=await t.page('admin_a','/admin/publications/'+slug+'/preview'),f=form(p,'/admin/publications/'+slug+'/publish');expectRedirect(await submit(t,'admin_a',f,{revision:'999999'}),'/admin/publications/'+slug+'/edit');expectRedirect(await submit(t,'admin_a',f),'/admin/publications');c.db.push(pubRule({published_title:state.publication.title,published_revision:state.publication.preview_revision,pdf_sha256:hash(pdf),cover_sha256:hash(png)}));c.assertions.push('Wrong revision rejected; actual reviewed publication published with expected file hashes');});
    await run('publication_member_hash',async c=>{const slug=state.publication.slug,p=await t.request('member_a','/member/publications/'+slug);expectStatus(p,200);expectText(p,state.publication.title);state.publication.member_pdf=matchingLink(p.text,/\/files\/pdf\//).href;state.publication.member_cover=matchingLink(p.text,/\/files\/cover\//).href;await download('member_a',state.publication.member_pdf,pdf);await download('member_a',state.publication.member_cover,png);expectRedirect(await t.request('visitor',state.publication.member_pdf),'/login');const bad=sameOrigin(state.publication.member_pdf);bad.pathname=bad.pathname.replace('/files/pdf/','/files/unknown/');expectStatus(await t.request('member_a',bad),404);const active=state.publication.preview_links.find(x=>/\/pdf\//.test(x));const key=sameOrigin(active).pathname.split('/').at(-1);expectStatus(await t.request('member_a','/rails/active_storage/blobs/redirect/'+encodeURIComponent(key)+'/'+mark+'.pdf'),404);const home=await t.request('visitor','/');check(!home.text.includes(state.publication.title),'Visitor homepage exposed publication metadata');expectText(await t.request('member_a','/'),state.publication.title);c.assertions.push('Member cover/PDF hashes exact; visitor/wrong kind/default storage bypass denied; visitor homepage metadata absent');});
    await run('publication_later_draft',async c=>{const slug=state.publication.slug,p=await t.page('admin_a','/admin/publications/'+slug+'/edit'),f=form(p,'/admin/publications/'+slug),old=f.fields.get('publication[lock_version]');expectRedirect(await submit(t,'admin_a',f,{...fields('publication',{title:mark+' later publication draft'}),intent:'draft'}),'/admin/publications');expectStatus(await submit(t,'admin_a',f,{...fields('publication',{title:mark+' rejected publication overwrite',lock_version:old}),intent:'draft'}),422);const member=await t.request('member_a','/member/publications/'+slug);expectText(member,state.publication.title);check(!member.text.includes(mark+' later publication draft'),'Later publication draft leaked');await download('member_a',state.publication.member_pdf,pdf);c.db.push(pubRule({draft_title:mark+' later publication draft',published_title:state.publication.title,pdf_sha256:hash(pdf),cover_sha256:hash(png)}));c.assertions.push('Later draft retained published files and content; stale draft overwrite rejected');});
  }
  if(batch==='discover'){
    await run('discover_setup',async c=>{await fresh();const p=await t.page('admin_a','/admin/discover');const f=forms(p.text).find(x=>x.action.pathname==='/admin/discover/setup')??forgedForm(p,'/admin/discover/setup','post');expectRedirect(await submit(t,'admin_a',f),'/admin/discover');const results=await Promise.all([submit(t,'admin_a',f),submit(t,'admin_a',f)]);for(const r of results)expectRedirect(r,'/admin/discover');const cards=forms((await t.request('admin_a','/admin/discover')).text).filter(x=>/^\/admin\/discover\/\d+$/.test(x.action.pathname));check(cards.length===3,'Setup did not leave exactly three cards');state.discover={id:Number(cards[0].action.pathname.split('/').at(-1)),position:1};c.db.push({collection:'discover',count:3});c.assertions.push('Initial/repeated/two concurrent missing-slot setup requests retain exactly three cards');});
    await run('discover_save',async c=>{const p=await t.page('admin_a','/admin/discover'),f=form(p,'/admin/discover/'+state.discover.id);state.discover.old_fields=[...f.fields];state.discover.title=mark+' Discover card';state.discover.url='https://www.isp.org.my/?qa='+mark;const values=fields('discover_slide',{tag:'Synthetic acceptance',title:state.discover.title,description:'Synthetic Discover acceptance card.',website_url:state.discover.url,image_alt:'Synthetic acceptance image',position:'999',default_image:'unsafe-default'});expectRedirect(await submit(t,'admin_a',f,values,[file('discover_slide[image]','discover-image')]),'/admin/discover');const home=await t.request('visitor','/');expectStatus(home,200);expectText(home,state.discover.title);check(links(home.text).includes(state.discover.url),'Exact external CTA absent');state.discover.image=matchingLink(home.text,new RegExp('/discover-images/'+state.discover.id+'/')).href;await download('visitor',state.discover.image,png);c.db.push({collection:'discover',where:{id:state.discover.id},count:1,equals:{title:state.discover.title,website_url:state.discover.url,position:state.discover.position}});c.assertions.push('Copy, HTTPS CTA and uploaded image immediately visible; spoofed position/default asset ignored');});
    await run('discover_rejections',async c=>{const route='/admin/discover/'+state.discover.id,p=await t.page('admin_a','/admin/discover'),f=form(p,route),stale={...f,fields:new Map(state.discover.old_fields)};expectStatus(await submit(t,'admin_a',stale,fields('discover_slide',{title:mark+' rejected stale card'})),422);expectStatus(await submit(t,'admin_a',f,fields('discover_slide',{website_url:'javascript:alert(1)'})),422);expectStatus(await submit(t,'admin_a',f,{},[{field:'discover_slide[image]',name:mark+'-invalid.png',type:'image/png',bytes:Buffer.from('synthetic invalid image')}]),422);expectStatus(await submit(t,'admin_a',f,{},[],{noCsrf:true}),422);const home=await t.request('visitor','/');expectText(home,state.discover.title);check(matchingLink(home.text,new RegExp('/discover-images/'+state.discover.id+'/')).href===state.discover.image,'Rejected save replaced image');await download('visitor',state.discover.image,png);c.db.push({collection:'discover',where:{id:state.discover.id},count:1,equals:{title:state.discover.title,website_url:state.discover.url,position:1}});c.assertions.push('Stale version, unsafe URL, invalid image and missing CSRF rejected; saved copy/image preserved');});
  }
  if(batch==='engagement'){
    await run('interest_concurrency',async c=>{const slug=state.event.slug,route='/events/'+slug+'/interest';for(const alias of['member_a','member_b']){const p=await t.page(alias,route+'/new'),f=form(p,route),values=fields('event_interest',{name:mark+' submitted '+alias,email:fixtures.actors[alias].email,company:'Synthetic submitted estate',user_id:fixtures.actors[alias==='member_a'?'member_b':'member_a'].id,event_id:999999});for(const r of await Promise.all([submit(t,alias,f,values),submit(t,alias,f,values)]))expectRedirect(r,'/events/'+slug);c.db.push(eventRule({}, {interest_count:1,user_id:fixtures.actors[alias].id,interest_equals:{name:mark+' submitted '+alias,email:fixtures.actors[alias].email,company:'Synthetic submitted estate',event_revision:state.event.published_revision,'event_snapshot.admission':'paid','event_snapshot.title':state.event.title}}));}c.assertions.push('Two members and concurrent duplicate submissions retain exactly one own row with original paid publication snapshot');});
    await run('consultation_concurrency',async c=>{const p=await t.page('member_a','/member/consultation_requests/new'),f=form(p,'/member/consultation_requests'),key=f.fields.get('consultation_request[request_key]');check(/^[a-f0-9-]{36}$/.test(key),'Actual consultation UUID absent');const values=fields('consultation_request',{category:'Other enquiry',subject:mark+' consultation',message:'Synthetic enquiry <script>alert(1)</script> & no appointment or email requested.',user_id:fixtures.actors.member_b.id});const results=await Promise.all([submit(t,'member_a',f,values),submit(t,'member_a',f,values)]);const paths=results.map(r=>recordLocation(r,/^\/member\/consultation_requests\/(\d+)$/).url.pathname);check(paths[0]===paths[1],'Concurrent consultation UUID returned different rows');state.consultation={id:Number(paths[0].split('/').at(-1)),key,subject:values['consultation_request[subject]']};state.created.consultations.push(state.consultation.id);const show=await t.request('member_a',paths[0]);expectStatus(show,200);expectText(show,state.consultation.subject);check(show.text.includes('&lt;script&gt;')&&!show.text.includes('<script>alert(1)</script>'),'Consultation text was not escaped');c.db.push({collection:'consultations',where:{request_key:key},count:1,equals:{id:state.consultation.id,user_id:fixtures.actors.member_a.id,category:'Other enquiry',subject:state.consultation.subject,message:values['consultation_request[message]']}});c.assertions.push('Concurrent UUID submission retained one unchanged current-member enquiry and escaped message');});
    await run('consultation_boundaries',async c=>{const id=state.consultation.id;expectStatus(await t.request('member_b','/member/consultation_requests/'+id),404);expectRedirect(await t.request('visitor','/member/consultation_requests/'+id),'/login');expectStatus(await t.request('member_a','/admin/consultation_requests/'+id),403);const r=await t.request('admin_a','/admin/consultation_requests/'+id);expectStatus(r,200);expectText(r,state.consultation.subject);expectText(r,fixtures.actors.member_a.email);expectStatus(await t.request('admin_a','/admin/consultation_requests'),200);expectText(await t.request('member_a','/member/consultation_requests'),state.consultation.subject);c.assertions.push('Own history and admin read-only enquiry/contact view work; another member direct ID and visitor denied');});
    await run('roster_boundaries',async c=>{const route='/admin/events/'+state.event.slug+'/interests',r=await t.request('admin_a',route);expectStatus(r,200);expectText(r,mark+' submitted member_a');expectText(r,mark+' submitted member_b');expectRedirect(await t.request('visitor',route),'/login');expectStatus(await t.request('member_a',route),403);for(const page of['0','-1','abc','999999'])expectStatus(await t.request('admin_a',route+'?page='+page),404);c.assertions.push('Scoped roster renders submitted contacts; visitor/member and invalid pages denied');});
  }
  if(batch==='event-republish'){
    await run('event_free_republish',async c=>{await fresh();const slug=state.event.slug,p=await t.page('admin_a','/admin/events/'+slug+'/edit'),f=form(p,'/admin/events/'+slug),r=await submit(t,'admin_a',f,{...fields('event',{title:mark+' free event',admission:'free'}),intent:'preview'});expectRedirect(r,'/admin/events/'+slug+'/preview');const still=await t.request('visitor','/events/'+slug);expectText(still,state.event.title);check(!still.text.includes(mark+' free event'),'Unpublished event draft leaked');const preview=await t.request('admin_a',r.headers.location),publish=form(preview,'/admin/events/'+slug+'/publish');expectRedirect(await submit(t,'admin_a',publish),'/events/'+slug);const now=await t.request('visitor','/events/'+slug);expectText(now,mark+' free event');check(!now.text.includes('SYNTHETIC DO NOT TRANSFER'),'Free event retained stale bank instruction');c.db.push(eventRule({published_title:mark+' free event','published_data.admission':'free','published_data.fee':'','published_data.payment_method':'','published_data.bank_name':'','published_data.account_name':'','published_data.account_number':'','published_data.receipt_email':'','published_data.payment_notes':''}));c.assertions.push('Later draft retained old public event until reviewed; free republish clears all payment snapshot fields');});
    await run('interest_snapshot',async c=>{const p=await t.page('member_a','/member/profile/edit');expectRedirect(await submit(t,'member_a',form(p,'/member/profile'),fields('user',{company:'Synthetic profile after interest'})),'/member/dashboard');const roster=await t.request('admin_a','/admin/events/'+state.event.slug+'/interests');expectText(roster,'Synthetic submitted estate');for(const alias of['member_a','member_b'])c.db.push(eventRule({}, {interest_count:1,user_id:fixtures.actors[alias].id,interest_equals:{company:'Synthetic submitted estate',event_revision:state.event.published_revision,'event_snapshot.admission':'paid','event_snapshot.title':state.event.title}}));c.assertions.push('Original event/payment and submitted-contact snapshots survive profile change and free republish');});
  }
  if(batch==='snapshot-withdraw'){
    await run('interest_withdraw',async c=>{const slug=state.event.slug,p=await t.page('member_a','/member/dashboard'),f=form(p,'/events/'+slug+'/interest');check(f.fields.get('_method')==='delete','Actual withdrawal form missing DELETE override');expectRedirect(await submit(t,'member_a',f),'/member/dashboard');c.db.push(eventRule({}, {interest_count:0,user_id:fixtures.actors.member_a.id}),eventRule({}, {interest_count:1,user_id:fixtures.actors.member_b.id}));c.assertions.push('Actual withdrawal removes only current member interest; other member row retained');});
  }
  if(batch==='imports'){
    await run('csv_confirm',async c=>{const p=await t.page('admin_a','/admin/membership_imports/new'),f=form(p,'/admin/membership_imports');const email=mark+'-csv-added@staging.planterapp.co',reference='000CSV-'+mark,csv='name,email,member_reference,status\n'+mark+' CSV member,'+email+','+reference+',eligible\n';const r=await submit(t,'admin_a',f,{},[{field:'membership_import[csv]',name:mark+'-registry.csv',type:'text/csv',bytes:Buffer.from(csv)}]);const record=recordLocation(r,/^\/admin\/membership_imports\/([a-f0-9-]+)$/);state.import={public_id:record.slug,email,reference};state.created.imports.push(record.slug);const preview=await t.request('admin_a',record.url),confirmation=form(preview,record.url.pathname+'/confirm');expectText(preview,reference);expectRedirect(await submit(t,'admin_a',confirmation),record.url.pathname);const confirmed=await t.request('admin_a',record.url);expectText(confirmed,'Membership list confirmed.');c.db.push({collection:'imports',where:{public_id:record.slug},count:1,equals:{actor_id:fixtures.actors.admin_a.id,state:'confirmed'}},{collection:'registry',where:{email},count:1,equals:{member_reference:reference,status:'eligible',user_id:null}},actorRule('member_b',{'registry.member_reference':fixtures.actors.member_b.member_reference,account_status:'active'}));c.assertions.push('Actual CSV preview/hidden digest/version confirmation created leading-zero registry row; omitted membership retained; no account activation');});
    await run('csv_other_admin',async c=>{expectStatus(await t.request('admin_b','/admin/membership_imports/'+state.import.public_id),404);c.assertions.push('Other administrator cannot access owned CSV preview/confirmation record');});
    await run('csv_malformed',async c=>{const p=await t.page('admin_a','/admin/membership_imports/new'),r=await submit(t,'admin_a',form(p,'/admin/membership_imports'),{},[{field:'membership_import[csv]',name:mark+'-malformed.csv',type:'text/csv',bytes:Buffer.from('wrong,headers\nsynthetic,row\n')}]);const record=recordLocation(r,/^\/admin\/membership_imports\/([a-f0-9-]+)$/);state.created.imports.push(record.slug);const preview=await t.request('admin_a',record.url);check(!forms(preview.text).some(x=>x.action.pathname.endsWith('/confirm')),'Malformed CSV unexpectedly confirmable');c.db.push({collection:'imports',where:{public_id:record.slug},count:1,equals:{state:'invalid',actor_id:fixtures.actors.admin_a.id}},{collection:'registry',where:{email:state.import.email},count:1});c.assertions.push('Malformed CSV produces invalid private preview without confirmation/write');});
    await run('mail_disabled', async c => {
  const p = await t.page('admin_a', '/admin/membership_registry_entries');
  const route = '/admin/membership_registry_entries/' +
    fixtures.actors.pending.registry_id + '/invitation';
  const r = await submit(t, 'admin_a', forgedForm(p, route, 'post'));
  expectRedirect(r, '/admin/membership_registry_entries');
  expectText(await t.page('admin_a', r.headers.location),
    'Account email is not enabled. No invitation was sent.');

  const recovery = await t.page('mail_probe', '/password-recovery');
  const result = await submit(t, 'mail_probe',
    form(recovery, '/password-recovery'),
    { email: fixtures.actors.member_b.email });
  expectRedirect(result, '/password-recovery');
  expectText(await t.page('mail_probe', result.headers.location),
    'If an eligible account exists, a reset link has been requested.');

  c.db.push({
    collection: 'mail', count: 1,
    equals: { delivery_count_observable: false, pending_outbox_count: 0 }
  });
  c.assertions.push(
    'Invitation disabled; recovery generic; independent observation confirms no pending token outbox. External delivery is not measured.'
  );
});
  }
if(batch==='aged-stepup'){
 await run('mfa_aged_stepup_revocation',async c=>{
  if(Date.now()+605000+150000>=t.stopAt)throw new Blocked('Natural-aging check deferred: fixed window cannot fit wait plus remaining reserve');
  await fresh();
  const route='/admin/events/'+state.event.slug;
  const page=await t.page('admin_a',route+'/edit'),editor=form(page,route);
  t.jars.set('aged_editor_copy',new CookieJar(t.jar('admin_a').save()));
  const baseline=json(OBS_FILE),before=baseline.events.find(e=>e.slug===state.event.slug);
  check(before&&baseline.counts,'Independent pre-aging state required');
  const wait=605000;
  if(Date.now()+wait+150000>=t.stopAt)throw new Blocked('Insufficient fixed window for natural verification aging');
  state.natural_aging={started_at:new Date().toISOString(),duration_ms:wait};atomic(HTTP_FILE,state);
  await new Promise(resolve=>setTimeout(resolve,wait));
  const wd=json(path.join(PRIVATE,'watchdog-state.json')),stamp=Date.parse(wd.updated_at);
  check(wd.armed===true&&wd.application_id==='a03ae965-44e9-40b6-9c10-3f8f2c659c34'&&Number.isFinite(stamp)&&stamp<=Date.now()+5000&&Date.now()-stamp<=45000,'Live watchdog required after natural aging');
  expectStatus(await t.request('visitor','/ready',{startup:true}),200);
  const rejected=await submit(t,'admin_a',editor,{...fields('event',{title:mark+' rejected aged editor'}),intent:'draft'});
  expectStatus(rejected,422);expectText(rejected,'Nothing was saved.');
  await fresh();
  expectRedirect(await t.request('aged_editor_copy','/admin/events'),'/login');
  expectStatus(await t.request('admin_a',route+'/edit'),200);
  c.db.push(eventRule({revision:before.revision,lock_version:before.lock_version,draft_data:before.draft_data,published_data:before.published_data}),{collection:'counts',count:1,equals:baseline.counts},actorRule('admin_a',{active_session_count:1,mfa_enabled:true}));
  c.assertions.push('Actual editor naturally aged beyond ten minutes; stale mutation rejected without saved changes; real password/TOTP step-up restored editor access and invalidated copied old session');
 });
}
// BEGIN ACCEPTANCE_CRITICAL_BATCHES
if (batch === 'critical-guards') {
  const baseline = json(OBS_FILE);
  check(baseline.run_marker === mark &&
    JSON.stringify(baseline.target) === JSON.stringify(state.target),
    'Matching independent baseline required');

  const beforeEvent = baseline.events.find(e => e.slug === state.event.slug);
  const beforePublication = baseline.publications.find(
    p => p.slug === state.publication.slug);
  check(beforeEvent && beforePublication && baseline.counts,
    'Independent content/count baseline missing');

  function unchanged(c) {
    c.db.push(
      { collection: 'counts', count: 1, equals: baseline.counts },
      eventRule({
        revision: beforeEvent.revision,
        lock_version: beforeEvent.lock_version,
        draft_data: beforeEvent.draft_data,
        published_data: beforeEvent.published_data
      }),
      pubRule({
        revision: beforePublication.revision,
        lock_version: beforePublication.lock_version,
        draft_data: beforePublication.draft_data,
        published_data: beforePublication.published_data
      })
    );
  }

  await run('mfa_replay_recovery_cancel', async c => {
    const a = fixtures.actors.admin_b;

    async function challenge(alias) {
      const loginPage = await t.page(alias, '/login');
      expectStatus(loginPage, 200);
      expectRedirect(await submit(t, alias, form(loginPage, '/session'), {
        email: a.email, password: a.password
      }), '/two-factor');
      const factor = await t.page(alias, '/two-factor');
      expectStatus(factor, 200);
      return factor;
    }

    // Accept a fresh TOTP, then replay that same still-current code.
    let page = await challenge('mfa_current');
    const code = await otp('admin_b');
    const step = state.actors.admin_b.last_otp_step;
    expectRedirect(await submit(t, 'mfa_current',
      form(page, '/two-factor'), { otp_code: code }), '/admin/events');

    t.jars.set('mfa_captured_old',
      new CookieJar(t.jar('mfa_current').save()));

    page = await challenge('mfa_replay');
    check(Date.now() < (step + 2) * 30000,
      'Replay code left accepted drift window; result inconclusive');
    expectStatus(await submit(t, 'mfa_replay',
      form(page, '/two-factor'), { otp_code: code }), 422);
    let cancel = forms(page.text).find(f =>
      f.action.pathname === '/two-factor' &&
      f.fields.get('_method') === 'delete');
    check(cancel, 'Actual MFA cancellation form missing');
    expectRedirect(await submit(t, 'mfa_replay', cancel), '/login');

    // Consume one actual enrollment recovery code.
    const recovery = state.actors.admin_b.recovery_codes?.[0];
    check(recovery, 'Private enrollment recovery code missing');
    page = await challenge('mfa_recovery');
    expectRedirect(await submit(t, 'mfa_recovery',
      form(page, '/two-factor'), { otp_code: recovery }), '/admin/events');
    state.actors.admin_b.recovery_codes.shift();

    expectRedirect(await t.request('mfa_captured_old', '/admin/events'), '/login');
    expectStatus(await t.request('mfa_recovery', '/admin/events'), 200);

    // The consumed recovery code cannot authenticate a new challenge.
    page = await challenge('mfa_recovery_reuse');
    expectStatus(await submit(t, 'mfa_recovery_reuse',
      form(page, '/two-factor'), { otp_code: recovery }), 422);
    cancel = forms(page.text).find(f =>
      f.action.pathname === '/two-factor' &&
      f.fields.get('_method') === 'delete');
    check(cancel, 'Actual MFA cancellation form missing');
    expectRedirect(await submit(t, 'mfa_recovery_reuse', cancel), '/login');

    // Cancel a pending challenge; a copied challenge cookie cannot redeem it.
    page = await challenge('mfa_cancel');
    const pendingForm = form(page, '/two-factor');
    t.jars.set('mfa_cancel_copy',
      new CookieJar(t.jar('mfa_cancel').save()));
    cancel = forms(page.text).find(f =>
      f.action.pathname === '/two-factor' &&
      f.fields.get('_method') === 'delete');
    check(cancel, 'Actual MFA cancellation form missing');
    expectRedirect(await submit(t, 'mfa_cancel', cancel), '/login');
    expectRedirect(await submit(t, 'mfa_cancel_copy', pendingForm, {
      otp_code: totp(state.actors.admin_b.totp_secret)
    }), '/login');

    c.db.push(actorRule('admin_b', {
      mfa_enabled: true, session_count: 1, usable_challenge_count: 0
    }));
    c.assertions.push(
      'Still-current TOTP replay rejected; recovery code consumed once; recovery change revoked captured old session; copied canceled challenge denied'
    );
  });

  if(!state.halted) await fresh();

  await run('event_csrf_negative', async c => {
    const route = '/admin/events/' + state.event.slug;
    const p = await t.page('admin_a', route + '/edit');
    expectStatus(await submit(t, 'admin_a', form(p, route), {
      ...fields('event', { title: mark + ' rejected CSRF event' }),
      intent: 'draft'
    }, [], { noCsrf: true }), 422);
    unchanged(c);
    c.assertions.push(
      'Otherwise valid current event save without CSRF rejected; exact rows, versions, snapshots and blob count must remain unchanged'
    );
  });

  await run('publication_csrf_negative', async c => {
    const route = '/admin/publications/' + state.publication.slug;
    const p = await t.page('admin_a', route + '/edit');
    expectStatus(await submit(t, 'admin_a', form(p, route), {
      ...fields('publication', {
        title: mark + ' rejected CSRF publication'
      }), intent: 'draft'
    }, [], { noCsrf: true }), 422);
    unchanged(c);
    c.assertions.push(
      'Otherwise valid current publication save without CSRF rejected; independent exact state/count preservation required'
    );
  });

  await run('consultation_csrf_negative', async c => {
    const p = await t.page('member_a', '/member/consultation_requests/new');
    expectStatus(await submit(t, 'member_a',
      form(p, '/member/consultation_requests'),
      fields('consultation_request', {
        category: 'Other enquiry',
        subject: mark + ' rejected CSRF enquiry',
        message: 'Synthetic request must not be persisted.'
      }), [], { noCsrf: true }), 422);
    unchanged(c);
    c.assertions.push(
      'Valid current enquiry form without CSRF rejected; exact consultation and blob counts unchanged'
    );
  });

  await run('scanner_eicar_rejection', async c => {
    const route = '/admin/events/' + state.event.slug;
    const p = await t.page('admin_a', route + '/edit');
    const bytes = eicarPdf();
    const r = await submit(t, 'admin_a', form(p, route),
      { intent: 'draft' }, [{
        field: 'event[brochure]',
        name: mark + '-eicar.pdf',
        type: 'application/pdf',
        bytes
      }]);
    expectStatus(r, 422);
    expectText(r,
      'This file did not pass the upload safety check. Choose another file.');
    unchanged(c);
    c.assertions.push(
      'PDF signature/type passed local validation; actual scanner-derived EICAR rejection displayed; exact persisted draft/version/blob counts unchanged'
    );
  });
}

if (batch === 'critical-replace') {
  await fresh();
  const before = json(OBS_FILE);
  check(before.run_marker === mark, 'Matching replacement baseline required');

  await run('discover_replaced_key', async c => {
    const row = before.discover.find(s => s.id === state.discover.id);
    check(row, 'Independent Discover baseline missing');
    const oldUrl = state.discover.image;
    const route = '/admin/discover/' + state.discover.id;
    const p = await t.page('admin_a', '/admin/discover');
    const replacement = Buffer.concat([
      png, Buffer.from('\n' + mark + ' replacement image\n')
    ]);
    expectRedirect(await submit(t, 'admin_a', form(p, route), {}, [{
      field: 'discover_slide[image]',
      name: mark + '-replacement-image.png',
      type: 'image/png',
      bytes: replacement
    }]), '/admin/discover');

    const home = await t.request('visitor', '/');
    const current = matchingLink(home.text,
      new RegExp('/discover-images/' + state.discover.id + '/')).href;
    check(current !== oldUrl, 'Discover replacement retained old key');
    await download('visitor', current, replacement);
    expectStatus(await t.request('visitor', oldUrl), 404);
    state.discover.image = current;

    c.db.push({
      collection: 'discover', where: { id: state.discover.id }, count: 1,
      equals: {
        title: state.discover.title,
        website_url: state.discover.url,
        position: 1,
        lock_version: row.lock_version + 1
      }
    });
    c.assertions.push(
      'Actual replacement image serves exact new bytes; previous Discover key returns 404; persisted card version advanced once'
    );
  });

  await run('publication_replaced_key', async c => {
    const slug = state.publication.slug;
    const route = '/admin/publications/' + slug;
    const oldPdf = state.publication.member_pdf;
    const replacement = benignPdf(mark + ' replacement publication');
    const title = mark + ' replacement publication';

    const p = await t.page('admin_a', route + '/edit');
    const saved = await submit(t, 'admin_a', form(p, route), {
      ...fields('publication', { title }), intent: 'preview'
    }, [{
      field: 'publication[pdf]',
      name: mark + '-replacement-publication.pdf',
      type: 'application/pdf',
      bytes: replacement
    }]);
    expectRedirect(saved, route + '/preview');

    // Existing members retain the previous reviewed file before publication.
    await download('member_a', oldPdf, pdf);
    const preview = await t.request('admin_a', saved.headers.location);
    expectStatus(preview, 200);
    const publish = form(preview, route + '/publish');
    expectRedirect(await submit(t, 'admin_a', publish), '/admin/publications');

    const member = await t.request('member_a',
      '/member/publications/' + slug);
    expectStatus(member, 200);
    expectText(member, title);
    const current = matchingLink(member.text, /\/files\/pdf\//).href;
    check(current !== oldPdf, 'Publication replacement retained old PDF key');
    await download('member_a', current, replacement);
    expectStatus(await t.request('member_a', oldPdf), 404);

    state.publication.title = title;
    state.publication.member_pdf = current;
    c.db.push(pubRule({
      draft_title: title,
      published_title: title,
      published_revision: Number(publish.fields.get('revision')),
      pdf_sha256: hash(replacement),
      cover_sha256: hash(png)
    }));
    c.assertions.push(
      'Replacement preview preserved previous member PDF until publish; exact new PDF hash now served; old published PDF key denied'
    );
  });
}
// END ACCEPTANCE_CRITICAL_BATCHES

  if(batch==='logout'){
    await run('logout_revocation',async c=>{const p=await t.page('member_a','/member/dashboard'),f=form(p,'/session');check(f.fields.get('_method')==='delete','Actual logout form missing DELETE');state.jars??={};t.jars.set('captured_member_a',new CookieJar(t.jar('member_a').save()));expectRedirect(await submit(t,'member_a',f),'/');expectRedirect(await t.request('member_a','/member/dashboard'),'/login');expectRedirect(await t.request('captured_member_a','/member/dashboard'),'/login');c.db.push(actorRule('member_a',{active_session_count:0}));c.assertions.push('Actual sign-out invalidates current and previously captured cookies; server session absence required');});
  }
  if(batch==='throttle'){
    await run('login_throttle',async c=>{const a=fixtures.actors.throttle,p=await t.page('throttle','/login'),f=form(p,'/session');const window=Math.floor(Date.now()/180000);check(Date.now()%180000<155000,'Too close to throttle window boundary; do not start this batch yet');for(let n=0;n<10;n++){check(Math.floor(Date.now()/180000)===window,'Throttle window changed; result inconclusive');expectStatus(await submit(t,'throttle',f,{email:a.email,password:'synthetic-wrong-password'}),422);}check(Math.floor(Date.now()/180000)===window,'Throttle window changed; result inconclusive');expectRedirect(await submit(t,'throttle',f,{email:a.email,password:'synthetic-wrong-password'}),'/login');c.db.push(actorRule('throttle',{active_session_count:0}),{collection:'throttle',where:{alias:'throttle',purpose:'login'},count:1,equals:{attempts:11,window_started_epoch:window*180}});c.assertions.push('First ten wrong credentials rejected generically; eleventh throttled in same shared account window without proxy spoofing');});
  }
  for(const[id,[owner,area]]of Object.entries(INVENTORY))if(!BATCHES.includes(owner)&&!state.cases[id])state.cases[id]={id,area,status:'BLOCKED',http:'NOT RUN',assertions:[],reason:'Requires '+owner+' execution/evidence; this HTTP driver does not claim it'};
  if(!state.halted){state.completed_batches.push(batch);delete state.running_batch;}save();
  const report=publicReport(state);console.log(JSON.stringify({ok:!state.halted,batch,requests:state.request_count,cases:Object.fromEntries(report.cases.filter(c=>c.batch===batch).map(c=>[c.id,c.status])),next:state.halted?'Inspect private checkpoint; automatic retry refused':'Capture operator status, then run --reconcile before next batch'}));
  if(state.halted)process.exitCode=1;
}

function selftest(){
  const parsed=forms('<form action="/session" method="post"><input type="hidden" name="authenticity_token" value="a&amp;b"><input type="hidden" name="_method" value="patch"><input name="ignored" disabled value="x"><select name="s"><option value="a">A</option><option selected value="b">B</option></select><textarea name="t">&lt;safe&gt;</textarea><input type="checkbox" name="c" value="yes" checked></form>')[0];
  check(parsed.fields.get('authenticity_token')==='a&b'&&parsed.fields.get('s')==='b'&&parsed.fields.get('t')==='<safe>'&&parsed.fields.get('c')==='yes'&&!parsed.fields.has('ignored'),'Form parser offline self-test failed');
  check(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',59000)==='287082','RFC TOTP offline self-test failed');
  check(!observationRulesMatch({events:[]},[{collection:'events',count:1,equals:{id:1}}]),'Empty observations must fail');
  check(!observationRulesMatch({},[{collection:'events',count:0}]),'Missing observation collections must fail');
  check(observationRulesMatch({events:[{id:1,published_data:{admission:'free'}}]},[{collection:'events',where:{id:1},count:1,equals:{'published_data.admission':'free'}}]),'Nested persisted assertions failed');
  let refused=false;try{sameOrigin('https://example.com/');}catch{refused=true;}check(refused,'External origin must be refused');
  check(new CookieJar([['a|/admin',{name:'a',value:'private',path:'/admin'}]]).header(new URL(ORIGIN+'/administrator'))==='','Cookie path boundary failed');
  check(benignPdf('synthetic').subarray(0,5).toString()==='%PDF-','Harmless PDF fixture malformed');
  console.log(JSON.stringify({ok:true,offline:true,batches:BATCHES,cases:Object.keys(INVENTORY).length,network_requests:0}));
}
async function main(){const args=process.argv.slice(2);if(args.length===1&&args[0]==='--selftest')return selftest();if(args.length===1&&args[0]==='--reconcile'){const state=json(HTTP_FILE);reconcile(state);atomic(HTTP_FILE,state);atomic(RESULT_FILE,publicReport(state));return console.log(JSON.stringify({ok:true,network_requests:0,pending_db:Object.values(state.cases).filter(c=>c.http==='PASS'&&c.db?.length&&c.status==='BLOCKED').map(c=>c.id),failed:Object.values(state.cases).filter(c=>c.status==='FAIL').map(c=>c.id)}));}if(args[0]==='--execute'&&args[1]==='--batch'&&args.length===3)return execute(args[2]);check(args.length===0||(args.length===1&&args[0]==='--plan'),'Use --plan, --selftest, --reconcile, or --execute --batch NAME');console.log(JSON.stringify({network_requests:0,origin:ORIGIN,batches:BATCHES,inventory:INVENTORY,observation:'After each batch, run the private fixture operator status command, then --reconcile. Never replay a started batch.',limits:{requests:350,concurrency:2,ordinary_ms:20000,files_ms:45000,cleanup_reserve_minutes:10}}));}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Hosted acceptance refused or interrupted. Inspect the private prerequisites/checkpoint; no secrets were printed.');process.exitCode=1;});
