import { randomBytes } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';

export const ACCOUNT_ID = 'a9720867333b64a4f8ee70cdfd673eb9';
export const WORKER_NAME = 'isp-member-production';
export const APPLICATION_NAME = 'isp-member-production';
export const BUCKET = 'isp-staging-private';
export const PROJECT_ROOT = 'D:\\Projects\\isp-member-rails';
export const PRIVATE_ROOT = 'D:\\Projects\\isp-rails-tools\\isp-staging-private';
export const OAUTH_PATH = 'D:\\Projects\\isp-rails-tools\\node-cache\\config\\.wrangler\\config\\default.toml';
export const MAX_WINDOW_MS = 55 * 60 * 1000;
const API_BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}`;
const APP_PATH = '/containers/applications';
const SECRET_LENGTHS = Object.freeze({ SECRET_KEY_BASE: 64, ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY: 32,
  ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY: 32, ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT: 32, ISP_STAGING_KEY: 32 });
const APP_ID = /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
const STATES = new Set(['provisioning', 'running', 'failed', 'stopping', 'stopped', 'unhealthy', 'inactive', 'unknown']);

export class SafeError extends Error {}
function fail(message) { throw new SafeError(message); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function stamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z') ? time : null;
}
export function validateWindow(startAt, expiresAt, now = Date.now()) {
  const start = stamp(startAt), end = stamp(expiresAt);
  if (start === null || end === null || end <= start || end - start > MAX_WINDOW_MS || end <= now || start > now + MAX_WINDOW_MS) {
    fail('Staging needs fixed UTC timestamps, an unexpired window, and no more than 55 minutes.');
  }
  return { ISP_STAGING_START_AT: startAt, ISP_STAGING_EXPIRES_AT: expiresAt };
}
export function validateHost(host) {
  if (typeof host !== 'string' || !new RegExp(`^${WORKER_NAME}\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.workers\\.dev$`).test(host)) {
    fail('APP_HOST must be this Worker\'s exact workers.dev hostname.');
  }
  return host;
}
export function verifiedNeonUrl(local) {
  let url;
  try { url = new URL(local.DATABASE_URL); } catch { fail('The private Neon DATABASE_URL is missing or invalid.'); }
  const approved = String(local.NEON_VERIFY_HOST || '').toLowerCase();
  const directHost = url.hostname.replace('-pooler.', '.').toLowerCase();
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.username || !url.password || url.pathname.length < 2 || url.hash ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.neon\.tech$/.test(approved) || approved.includes('-pooler.') || directHost !== approved ||
      (url.port && url.port !== '5432') || local.DB_SSLMODE !== 'verify-full' ||
      url.searchParams.getAll('sslmode').length !== 1 || url.searchParams.get('sslmode') !== 'verify-full' ||
      [...url.searchParams.keys()].some((key) => !['sslmode', 'channel_binding'].includes(key)) ||
      url.searchParams.getAll('channel_binding').length > 1 || (url.searchParams.has('channel_binding') && url.searchParams.get('channel_binding') !== 'require')) {
    fail('Neon must match the approved endpoint with verify-full TLS and no target or CA overrides.');
  }
  return local.DATABASE_URL;
}
function storageValues(r2) {
  if (!object(r2) || r2.STORAGE_BUCKET !== BUCKET || typeof r2.AWS_ACCESS_KEY_ID !== 'string' ||
      typeof r2.AWS_SECRET_ACCESS_KEY !== 'string' || !/^[A-Za-z0-9_+/=-]{16,256}$/.test(r2.AWS_ACCESS_KEY_ID) ||
      !/^[A-Za-z0-9_+/=-]{32,256}$/.test(r2.AWS_SECRET_ACCESS_KEY)) fail('The private staging R2 credential file is missing or invalid.');
  return { AWS_ACCESS_KEY_ID: r2.AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY: r2.AWS_SECRET_ACCESS_KEY };
}
export function buildRuntimeSecrets({ local, r2, host, startAt, expiresAt, existing = {}, now = Date.now(), random = randomBytes }) {
  if (!object(existing)) fail('Existing private runtime JSON is invalid.');
  if (existing.APP_HOST && existing.APP_HOST !== host) fail('Refusing to change the prepared staging hostname.');
  for (const [name, value] of [['ISP_STAGING_START_AT', startAt], ['ISP_STAGING_EXPIRES_AT', expiresAt]]) {
    if (existing[name] && value && existing[name] !== value) fail('Refusing to extend or replace the prepared staging window.');
  }
  const window = validateWindow(existing.ISP_STAGING_START_AT || startAt, existing.ISP_STAGING_EXPIRES_AT || expiresAt, now);
  const secrets = {};
  for (const [name, bytes] of Object.entries(SECRET_LENGTHS)) {
    const saved = existing[name];
    if (saved !== undefined && (typeof saved !== 'string' || !new RegExp(`^[a-f0-9]{${bytes * 2}}$`).test(saved))) {
      fail('An existing generated staging key is invalid; refusing to replace it.');
    }
    secrets[name] = saved || random(bytes).toString('hex');
  }
  if (new Set(Object.values(secrets)).size !== Object.keys(secrets).length) fail('Staging keys must be independent.');
  return { ...secrets, ...window, APP_HOST: validateHost(host), DATABASE_URL: verifiedNeonUrl(local), DB_SSLMODE: 'verify-full',
    STORAGE_BUCKET: BUCKET, AWS_REGION: 'auto', ...storageValues(r2),
    STORAGE_ENDPOINT: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`, STORAGE_FORCE_PATH_STYLE: 'true',
    MAIL_FROM: 'staging@planterapp.co', ISP_ACCOUNT_EMAILS_ENABLED: 'false', ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED: 'false' };
}
function privateFile(root, name) {
  // The coordinator provisions this directory with a restricted Windows ACL. Do
  // not create another directory or move credentials into the source checkout.
  try {
    if (lstatSync(root).isSymbolicLink() || realpathSync(root).toLowerCase() !== resolve(root).toLowerCase()) fail('The private staging directory must not be redirected.');
    const path = join(root, name);
    try { if (lstatSync(path).isSymbolicLink()) fail('Private secret files must not be redirected.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return path;
  } catch (error) { if (error instanceof SafeError) throw error; fail('The restricted private staging directory is unavailable.'); }
}
function readJson(path, optional = false) {
  try { return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { if (optional && error.code === 'ENOENT') return {}; fail('A required private JSON file is unavailable or invalid.'); }
}
export function prepareRuntimeSecretJson({ host, startAt, expiresAt, projectRoot = PROJECT_ROOT, privateRoot = PRIVATE_ROOT, now = Date.now() }) {
  const destination = privateFile(privateRoot, 'runtime.json');
  let local;
  try { local = parseEnv(readFileSync(join(projectRoot, '.env.local'), 'utf8')); }
  catch { fail('The project\'s ignored local Neon configuration is unavailable.'); }
  const runtime = buildRuntimeSecrets({ local, r2: readJson(privateFile(privateRoot, 'r2.json')), host, startAt, expiresAt,
    existing: readJson(destination, true), now });
  try { writeFileSync(destination, `${JSON.stringify(runtime, null, 2)}\n`, { mode: 0o600 }); }
  catch { fail('Could not save the private runtime JSON.'); }
  // Return only key names and window metadata. Never return credential values.
  return { prepared: true, path: destination, key_count: Object.keys(runtime).length, keys: Object.keys(runtime).sort(),
    start_at: runtime.ISP_STAGING_START_AT, expires_at: runtime.ISP_STAGING_EXPIRES_AT, account_emails_enabled: false };
}
export function parseOAuthToml(source) {
  // Read only the top-level property Wrangler persists; never eval TOML or print it.
  const prefix = String(source).split(/^\s*\[/m, 1)[0];
  const matches = [...prefix.matchAll(/^\s*oauth_token\s*=\s*("(?:[^"\\\r\n]|\\.)*"|'[^'\r\n]*')\s*(?:#.*)?$/gm)];
  if (matches.length !== 1) fail('Wrangler\'s saved OAuth token is unavailable.');
  let token;
  try { token = matches[0][1][0] === '"' ? JSON.parse(matches[0][1]) : matches[0][1].slice(1, -1); }
  catch { fail('Wrangler\'s saved OAuth token is unavailable.'); }
  if (!/^[A-Za-z0-9._~+/-]{20,4096}={0,2}$/.test(token)) fail('Wrangler\'s saved OAuth token is unavailable.');
  return token;
}
export function readOAuthToken(path = OAUTH_PATH) {
  try { return parseOAuthToml(readFileSync(path, 'utf8')); }
  catch { fail('Wrangler\'s saved OAuth token is unavailable; authenticate separately.'); }
}
export function validateApplicationId(id) { if (!APP_ID.test(id || '')) fail('A concrete valid staging application ID is required.'); return id; }
export function assertStagingApplication(app, expectedId) {
  if (!object(app) || app.name !== APPLICATION_NAME || app.account_id !== ACCOUNT_ID || !APP_ID.test(app.id || '') ||
      (expectedId && app.id !== expectedId)) fail('The application does not match the pinned ISP staging target.');
  return app;
}
const safeDate = (value) => stamp(value) === null ? undefined : value;
const safeCount = (value) => Number.isSafeInteger(value) && value >= 0 ? value : undefined;
export function summarizeApplication(app) {
  assertStagingApplication(app);
  const counts = app.instances || app.health?.instances || {};
  return { id: app.id, name: APPLICATION_NAME, account_id: ACCOUNT_ID, max_instances: safeCount(app.max_instances),
    instances: Object.fromEntries(['active', 'assigned', 'starting', 'scheduling', 'failed', 'stopped'].flatMap((key) => safeCount(counts[key]) === undefined ? [] : [[key, counts[key]]])),
    created_at: safeDate(app.created_at), updated_at: safeDate(app.updated_at) };
}
export function summarizeInstance(instance, appId) {
  if (!object(instance) || instance.application_id !== appId || !/^[a-f0-9]{64}$/i.test(instance.id || '')) fail('The API returned an unexpected staging instance.');
  return { id: instance.id, application_id: appId, state: STATES.has(instance.status?.state) ? instance.status.state : 'unknown',
    updated_at: safeDate(instance.status?.updated_at), started_at: safeDate(instance.started_at),
    exit_code: Number.isSafeInteger(instance.status?.exit_code) ? instance.status.exit_code : undefined };
}
export function createReadonlyClient({ token, fetchImpl = fetch }) {
  return async function get(path) {
    // This client has no mutation method and never accepts a user-supplied URL.
    if (!(path === `${APP_PATH}?name=${APPLICATION_NAME}&per_page=100` ||
      new RegExp(`^${APP_PATH}/[a-f0-9-]+(?:/instances-v2\\?per_page=100)?$`, 'i').test(path))) fail('Unapproved read-only Cloudflare API path.');
    let response;
    try { response = await fetchImpl(`${API_BASE}${path}`, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(20000) }); }
    catch { fail('The Cloudflare read-only request failed; no response details were logged.'); }
    if (!response.ok) { try { await response.body?.cancel(); } catch {} fail(`Cloudflare read-only request failed (HTTP ${Number(response.status) || 0}).`); }
    let data;
    try { data = await response.json(); } catch { fail('Cloudflare returned an invalid API envelope.'); }
    if (!object(data) || data.success !== true || !('result' in data)) fail('Cloudflare did not confirm the read-only request.');
    if (data.result_info?.next_page_token) fail('Staging inspection exceeded one bounded page; inspect a concrete application.');
    return data.result;
  };
}
export async function inspectApplications(client) {
  const apps = await client(`${APP_PATH}?name=${APPLICATION_NAME}&per_page=100`);
  if (!Array.isArray(apps)) fail('Cloudflare returned an invalid applications list.');
  // Name filtering is performed at the provider and again locally; do not expose
  // unrelated account resources even if the provider ignores its filter.
  return { account_id: ACCOUNT_ID, applications: apps.filter((app) => app?.name === APPLICATION_NAME).map(summarizeApplication) };
}
export async function inspectApplication(client, id, withInstances = true) {
  validateApplicationId(id);
  const app = assertStagingApplication(await client(`${APP_PATH}/${id}`), id);
  const result = { application: summarizeApplication(app) };
  if (withInstances) {
    const instances = await client(`${APP_PATH}/${id}/instances-v2?per_page=100`);
    if (!Array.isArray(instances)) fail('Cloudflare returned an invalid instances list.');
    result.instances = instances.map((item) => summarizeInstance(item, id));
  }
  return result;
}
export function stopPlan(app) {
  assertStagingApplication(app);
  // Verified 2026-10-26: public API deletion starts asynchronous removal.
  // https://developers.cloudflare.com/api/resources/containers/subresources/applications/methods/delete/
  // The coordinator must first close admission, then delete only this concrete
  // application, then poll GET until 404 and check there are no live instances.
  // This script intentionally cannot issue DELETE or act as a cost watchdog.
  return { executes: false, account_id: ACCOUNT_ID, application_id: app.id, application_name: APPLICATION_NAME,
    method: 'DELETE', api_path: `/accounts/${ACCOUNT_ID}${APP_PATH}/${app.id}`,
    docs: 'https://developers.cloudflare.com/api/resources/containers/subresources/applications/methods/delete/',
    prerequisite: 'Close staging admission and retain a bounded external watchdog before activation.',
    completion: 'Deletion is asynchronous: verify application absence and zero live instances; an expired request gate alone does not stop compute.' };
}
export function readDeploymentToken(privateRoot = PRIVATE_ROOT) {
  const value=readJson(privateFile(privateRoot, 'deployment-token.json')).CLOUDFLARE_API_TOKEN;
  if(typeof value !== 'string' || value.length < 32 || /\s/.test(value)) fail('The private ISP deployment token is unavailable.');
  return value;
}
function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i];
    if (!['--host', '--start-at', '--expires-at', '--application-id'].includes(name) || !args[i + 1] || Object.hasOwn(flags, name)) fail('Invalid staging helper arguments.');
    flags[name] = args[i + 1];
  }
  return flags;
}
export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  const flags = parseFlags(rest);
  let output;
  if (command === 'prepare-runtime-secret-json') {
    if (flags['--application-id']) fail('Application ID is not a runtime preparation argument.');
    output = prepareRuntimeSecretJson({ host: flags['--host'], startAt: flags['--start-at'], expiresAt: flags['--expires-at'] });
  } else if (['inspect', 'inspect-instances', 'stop-plan'].includes(command)) {
    if (Object.keys(flags).some((key) => key !== '--application-id')) fail('Inspection accepts only a concrete application ID.');
    const client = createReadonlyClient({ token: readDeploymentToken() });
    const id = flags['--application-id'];
    if (command === 'inspect') output = id ? await inspectApplication(client, id, false) : await inspectApplications(client);
    else if (command === 'inspect-instances') output = await inspectApplication(client, id);
    else {
      validateApplicationId(id);
      const app = assertStagingApplication(await client(`${APP_PATH}/${id}`), id);
      output = stopPlan(app);
    }
  } else fail('Usage: cloudflare-staging-ops.mjs prepare-runtime-secret-json --host <workers.dev-host> --start-at <UTC> --expires-at <UTC> | inspect [--application-id <id>] | inspect-instances --application-id <id> | stop-plan --application-id <id>');
  console.log(JSON.stringify(output, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); }
  catch (error) {
    // Unknown system/network/JSON errors can contain credential-bearing paths or
    // bodies. Only our fixed allowlisted error messages may reach the console.
    console.error(error instanceof SafeError ? error.message : 'The staging helper failed; private details were not logged.');
    process.exitCode = 1;
  }
}