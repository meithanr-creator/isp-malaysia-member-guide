// Fixed operator entry point. Importing or syntax-checking does not execute Rails.
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = 'D:/Projects/isp-member-rails';
import {LEGACY_LEASE,selectLease,leaseContext,assertWritableLease} from './staging-lease-context.mjs';
const TEMP = 'D:/Projects/isp-rails-tools/tmp';
const CA = 'D:/Projects/isp-rails-tools/ruby34-devkit/lib/ruby/3.4.0/etc/ssl/cert.pem';
const HOST = 'ep-delicate-frost-a1o15wrb.ap-southeast-1.aws.neon.tech';
const DATABASE = 'neondb';
const PROJECT = 'royal-glitter-45740959';
const APP_HOST = 'isp-member-production.meithan-r.workers.dev';
const BUCKET = 'isp-staging-private';
const ENDPOINT = 'https://a9720867333b64a4f8ee70cdfd673eb9.r2.cloudflarestorage.com';
const ACTIONS = new Set(['setup', 'capture-ids', 'status', 'cleanup']);
const KEY_LENGTHS = Object.freeze({
  SECRET_KEY_BASE: 128,
  ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY: 64,
  ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY: 64,
  ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT: 64,
  ISP_STAGING_KEY: 64,
});
class SafeError extends Error {}
function fail(message) { throw new SafeError(message); }
function normalized(path) { return resolve(path).replaceAll('\\', '/').toLowerCase(); }
function fixedPath(path, directory = false) {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) ||
        normalized(realpathSync(path)) !== normalized(path)) {
      fail('A required local path is redirected or invalid.');
    }
    return path;
  } catch (error) {
    if (error instanceof SafeError) throw error;
    fail('A required local staging file or directory is unavailable.');
  }
}
function json(path) {
  try { return JSON.parse(readFileSync(fixedPath(path), 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) {
    if (error instanceof SafeError) throw error;
    fail('A required private staging JSON file is invalid.');
  }
}
function directUrl(local) {
  let url;
  try { url = new URL(local.DATABASE_URL_UNPOOLED); }
  catch { fail('The approved direct Neon URL is unavailable.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.hostname !== HOST || url.pathname !== `/${DATABASE}` ||
      !url.username || !url.password || url.hash ||
      (url.port && url.port !== '5432') || local.NEON_VERIFY_HOST !== HOST ||
      local.DB_SSLMODE !== 'verify-full' ||
      url.searchParams.getAll('sslmode').length !== 1 ||
      url.searchParams.get('sslmode') !== 'verify-full' ||
      [...url.searchParams.keys()].some(key => !['sslmode', 'channel_binding'].includes(key)) ||
      url.searchParams.getAll('channel_binding').length > 1 ||
      (url.searchParams.has('channel_binding') && url.searchParams.get('channel_binding') !== 'require')) {
    fail('Direct maintenance requires the fixed approved staging database and verify-full TLS.');
  }
  return local.DATABASE_URL_UNPOOLED;
}

export function buildEnvironment({leaseId=LEGACY_LEASE}={}) {
  const selected=leaseContext(leaseId),PRIVATE=selected.privateRoot;
  if (process.platform !== 'win32') fail('This operator is restricted to the approved Windows staging workspace.');
  fixedPath(ROOT, true);
  fixedPath(PRIVATE, true);
  fixedPath(TEMP, true);
  fixedPath(CA);
  const ownRoot = fileURLToPath(new URL('../', import.meta.url));
  if (normalized(ownRoot) !== normalized(ROOT)) fail('The operator must run from the fixed staging checkout.');
  let local;
  try { local = parseEnv(readFileSync(fixedPath(join(ROOT, '.env.local')), 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) {
    if (error instanceof SafeError) throw error;
    fail('The ignored local Neon configuration is unavailable.');
  }
  const r2 = json(join(selected.credentialRoot, 'r2.json'));
  const runtime = json(join(PRIVATE, 'runtime.json'));
  if (r2.STORAGE_BUCKET !== BUCKET ||
      !/^[A-Za-z0-9_+/=-]{16,256}$/.test(r2.AWS_ACCESS_KEY_ID || '') ||
      !/^[A-Za-z0-9_+/=-]{32,256}$/.test(r2.AWS_SECRET_ACCESS_KEY || '')) {
    fail('Private R2 credentials must target the approved staging bucket.');
  }
  if (runtime.APP_HOST !== undefined && runtime.APP_HOST !== APP_HOST) {
    fail('Prepared runtime keys belong to a different hostname.');
  }
  const keys = {};
  for (const [name, length] of Object.entries(KEY_LENGTHS)) {
    if (typeof runtime[name] !== 'string' || !new RegExp(`^[a-f0-9]{${length}}$`).test(runtime[name])) {
      fail('Existing staging keys are incomplete or invalid; the operator never generates replacements.');
    }
    keys[name] = runtime[name];
  }
  if (new Set(Object.values(keys)).size !== Object.keys(keys).length) {
    fail('Existing staging keys must be independent.');
  }
  const env = {};
  // Preserve only Windows process essentials, never ambient application/PG/Ruby overrides.
  for (const name of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'windir', 'ComSpec', 'COMSPEC',
    'PATH', 'Path', 'PATHEXT', 'USERPROFILE', 'USERNAME', 'USERDOMAIN', 'NUMBER_OF_PROCESSORS',
    'PROCESSOR_ARCHITECTURE', 'OS']) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  const database = directUrl(local);
  return {
    ...env, ...keys,
    ...(selected.fresh?{ISP_STAGING_LEASE:selected.leaseId}:{}),
    DATABASE_URL: database, DATABASE_URL_UNPOOLED: database,
    NEON_VERIFY_HOST: HOST, PGSSLROOTCERT: CA, SSL_CERT_FILE: CA, AWS_CA_BUNDLE: CA, DB_SSLMODE: 'verify-full',
    RAILS_ENV: 'production', RAILS_LOG_LEVEL: 'fatal',
    APP_HOST, APP_ADDITIONAL_HOSTS: '', MAIL_FROM: 'staging@planterapp.co',
    STORAGE_BUCKET: BUCKET, STORAGE_ENDPOINT: ENDPOINT,
    STORAGE_FORCE_PATH_STYLE: 'true', AWS_REGION: 'auto',
    AWS_ACCESS_KEY_ID: r2.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: r2.AWS_SECRET_ACCESS_KEY,
    CLAMD_HOST: '127.0.0.1', CLAMD_PORT: '3310',
    ISP_DEMO_MODE: 'false',
    ISP_ACCOUNT_EMAILS_ENABLED: 'false',
    ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED: 'false',
    ISP_ACCEPTANCE_FIXTURES: 'true',
    ISP_ACCEPTANCE_NEON_PROJECT: PROJECT,
    TEMP, TMP: TEMP,
  };
}

export function main(args = process.argv.slice(2)) {
  if (args.length !== 1 || !ACTIONS.has(args[0])) {
    fail('Usage: node script/hosted-acceptance-operator.mjs setup|capture-ids|status|cleanup');
  }
  const action = args[0];
  const selected=leaseContext(selectLease());
  if(action!=='status')assertWritableLease(selected);
  const env = buildEnvironment({leaseId:selected.leaseId});
  const result = spawnSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', fixedPath(join(ROOT, 'script', 'rails.ps1')),
    'runner', 'script/hosted-acceptance-fixtures.rb', action,
  ], {
    cwd: ROOT, env, shell: false, windowsHide: true,
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180000, maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    writeFileSync(selected.privateRoot + '/fixture-last-error.txt', String(result.stderr || '') + '\n' + String(result.stdout || ''), {mode:0o600});
    fail('Fixture command failed; private child output was withheld. Inspect private state before retrying.');
  }
  const summaries = [];
  for (const line of String(result.stdout || '').split(/\r?\n/)) {
    try {
      const value = JSON.parse(line);
      if (value?.ok === true && value.action === action) summaries.push(value);
    } catch {}
  }
  if (summaries.length !== 1) fail('The fixture command returned no unique safe completion receipt.');
  const receipt = summaries[0];
  if (!['active', 'prepared', 'cleanup_started', 'cleaned', 'rolled_back'].includes(receipt.phase)) {
    fail('The fixture command returned an invalid completion phase.');
  }
  const counts = {};
  for (const name of ['actors', 'events', 'publications', 'consultations', 'imports', 'registry', 'blobs']) {
    if (!Number.isSafeInteger(receipt.counts?.[name]) || receipt.counts[name] < 0) {
      fail('The fixture command returned invalid completion counts.');
    }
    counts[name] = receipt.counts[name];
  }
  console.log(JSON.stringify({ ok: true, action, phase: receipt.phase, counts }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); }
  catch (error) {
    console.error(error instanceof SafeError ? error.message : 'The staging fixture operator failed; private details were withheld.');
    process.exitCode = 1;
  }
}
