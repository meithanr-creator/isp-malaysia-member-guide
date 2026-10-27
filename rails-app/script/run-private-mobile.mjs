// Explicit native-run wrapper; real journeys and process-absence checks are shared.
import {main as controller} from './virtual-mobile-acceptance.mjs';
import {main as launcher} from './run-hosted-mobile-acceptance.mjs';
if(process.env.ISP_PRIVATE_ACCEPTANCE!=='true'||process.env.ISP_STAGING_LEASE!=='rails-private-acceptance')throw Error('Explicit private native run required');
const args=process.argv.slice(2);(args[0]==='--reconcile'?controller:launcher)(args).catch(()=>{console.error('Private mobile coverage incomplete; inspect preserved evidence; no replay.');process.exitCode=1;});
