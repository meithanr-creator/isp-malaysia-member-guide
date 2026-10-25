import assert from 'node:assert/strict';
import { unstable_readConfig } from 'wrangler';
import { build } from 'esbuild';

const config = unstable_readConfig({ config: 'wrangler.jsonc' });
assert.equal(config.name, 'isp-member-production');
assert.equal(config.workers_dev, false);
assert.equal(config.preview_urls, false);
assert.equal(config.containers.length, 1);
assert.equal(config.containers[0].max_instances, 1);
assert.equal(config.vars.ISP_CONTAINER_ENABLED, 'false');
const result = await build({
  entryPoints: ['src/index.js'], bundle: true, write: false,
  format: 'esm', platform: 'neutral', target: 'es2022', external: ['cloudflare:*']
});
console.log(`Wrangler configuration valid; real SDK bundle built (${result.outputFiles[0].contents.length} bytes). No deployment performed.`);