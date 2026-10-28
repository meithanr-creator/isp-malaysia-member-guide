import {createHash} from 'node:crypto';
export const OFFLINE_DASHBOARD_URL=(process.env.ISP_PRIVATE_ACCEPTANCE==='true'&&process.env.ISP_STAGING_LEASE==='rails-private-acceptance'?'https://isp-rails-startup.meithan-r.workers.dev':'https://isp-member-production.meithan-r.workers.dev')+'/member/dashboard';
export function classifyRequestFailure(facts={},state={}){
 const raw=typeof facts?.errorText==='string'?facts.errorText.trim():'';
 const excluded=/tim(?:e|ed)[\s_-]*out|closed|abort|cancel/i.test(raw);
 if(state.armed===true&&state.consumed===false&&facts?.url===OFFLINE_DASHBOARD_URL&&facts.method==='GET'&&facts.isNavigationRequest===true&&facts.isMainFrame===true&&raw.length>0&&!excluded)return 'expected-offline-navigation';
 if(/tim(?:e|ed)[\s_-]*out/i.test(raw))return 'Request timeout';
 if(/abort|cancel/i.test(raw))return 'Request cancelled';
 if(/closed/i.test(raw))return 'Request closed';
 return 'Request transport failure';
}
export function acceptableOfflineNavigationError(value){return typeof value==='string'&&value.trim().length>0&&!/tim(?:e|ed)[\s_-]*out|closed|abort|cancel/i.test(value);}

export const PRIVATE_FAILURE_FACT_LIMIT=64;
const categories=new Set(['expected-offline-navigation','Request timeout','Request cancelled','Request closed','Request transport failure','Asset HTTP failure','Application JavaScript error','Active browser admission unavailable','Browser operation or assertion failed','Browser context/server cleanup failed']);
const resources=new Set(['document','stylesheet','image','media','font','script','texttrack','xhr','fetch','eventsource','websocket','manifest','other']);
const phaseName=value=>typeof value==='string'&&/^[a-z_]{1,64}$/.test(value)?value:'unknown';
export function privateRequestFailureFact(facts={},category='Request transport failure'){
 const raw=typeof facts.url==='string'&&facts.url.length<=8192?facts.url:'';let path=':path',asset;
 try{const url=new URL(raw),p=url.pathname,basename=p.split('/').at(-1);if(p.startsWith('/assets/')&&/^[a-zA-Z0-9_-]+-[a-f0-9]{6,64}\.(?:js|css|woff2?|png|svg|jpe?g|webp)$/.test(basename)){asset=basename;path='/assets/:fingerprinted';}else if(p.startsWith('/brand/'))path='/brand/:asset';else if(p.startsWith('/discover-images/'))path='/discover-images/:id/:key';else if(p.startsWith('/member/'))path='/member/:route';else if(p.startsWith('/admin/'))path='/admin/:route';else if(p.startsWith('/events/'))path='/events/:route';else if(['/','/login','/manifest','/manifest.json','/service-worker','/__isp_review'].includes(p))path=p;}catch{}
 const fact={phase:phaseName(facts.phase),request_phase:phaseName(facts.requestPhase),cleanup:facts.cleanup===true,method:['GET','HEAD','POST','PATCH','PUT','DELETE','OPTIONS'].includes(facts.method)?facts.method:'OTHER',resource_type:resources.has(facts.resourceType)?facts.resourceType:'other',navigation:facts.isNavigationRequest===true,main_frame:facts.isMainFrame===true,path_template:path,url_sha256:createHash('sha256').update(raw).digest('hex'),category:categories.has(category)?category:'Request transport failure'};
 if(asset)fact.asset_basename=asset;if(Number.isInteger(facts.httpStatus)&&facts.httpStatus>=100&&facts.httpStatus<=599)fact.http_status=facts.httpStatus;return fact;
}
export function retainPrivateFailureFact(result,fact,{fatal=true}={}){
 const ledger=result.private_failure_facts??={version:1,limit:PRIVATE_FAILURE_FACT_LIMIT,entries:[],dropped:0,first_error:null};
 if(ledger.entries.length<PRIVATE_FAILURE_FACT_LIMIT)ledger.entries.push({...fact});else ledger.dropped++;
 if(fatal&&!ledger.first_error)ledger.first_error=Object.freeze({...fact});return ledger.first_error;
}
export function freezeFailureBeforeCleanup(result,phase){
 if(!result.private_failure_before_cleanup)result.private_failure_before_cleanup=Object.freeze({phase:phaseName(phase),error_count:result.errors?.length??0,first_error:result.private_failure_facts?.first_error?{...result.private_failure_facts.first_error}:null});
 return result.private_failure_before_cleanup;
}
