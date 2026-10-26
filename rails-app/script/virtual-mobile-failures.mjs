export const OFFLINE_DASHBOARD_URL='https://isp-member-production.meithan-r.workers.dev/member/dashboard';
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
