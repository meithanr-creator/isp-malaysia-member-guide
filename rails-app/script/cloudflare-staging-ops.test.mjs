import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ACCOUNT_ID, APPLICATION_NAME, MAX_WINDOW_MS, SafeError, buildRuntimeSecrets, createReadonlyClient,
  inspectApplication, inspectApplications, parseOAuthToml, prepareRuntimeSecretJson, stopPlan,
  main, summarizeApplication, summarizeInstance, validateApplicationId, validateHost, validateWindow, verifiedNeonUrl } from './cloudflare-staging-ops.mjs';

const now = Date.parse('2026-10-26T12:00:00Z');
const startAt = '2026-10-26T12:00:00Z';
const expiresAt = '2026-10-26T12:55:00Z';
const host = 'isp-member-production.synthetic.workers.dev';
const id = '12a45678-1234-1234-1234-123456789abc';
const local = { DATABASE_URL: 'postgresql://synthetic:fixture@ep-synthetic-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full&channel_binding=require',
  NEON_VERIFY_HOST: 'ep-synthetic.ap-southeast-1.aws.neon.tech', DB_SSLMODE: 'verify-full', PGSSLROOTCERT: 'D:\\synthetic\\never-forward.pem',
  SMTP_PASSWORD: 'must-not-forward', ISP_ACCOUNT_EMAILS_ENABLED: 'true', ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED: 'true' };
const r2 = { AWS_ACCESS_KEY_ID: 'synthetic_access_key_fixture', AWS_SECRET_ACCESS_KEY: 'synthetic_secret_key_fixture_1234567890', STORAGE_BUCKET: 'isp-staging-private' };
const app = { id, name: APPLICATION_NAME, account_id: ACCOUNT_ID, max_instances: 1, instances: { active: 0, starting: 1 },
  created_at: startAt, configuration: { env: { DATABASE_URL: local.DATABASE_URL, OAuthToken: 'must-not-print' } },
  image: 'sensitive-unneeded-image', customer_metadata: 'must-not-print' };
function runtime(overrides = {}) { return buildRuntimeSecrets({ local, r2, host, startAt, expiresAt, now, ...overrides }); }
const scratchRoot = fileURLToPath(new URL('../tmp/', import.meta.url));
function fixture(t) {
  mkdirSync(scratchRoot, { recursive: true });
  const root = mkdtempSync(join(scratchRoot, 'cloudflare-staging-ops-'));
  t.after(() => { assert.ok(resolve(root).startsWith(resolve(scratchRoot) + sep)); rmSync(root, { recursive: true }); });
  return root;
}

test('runtime uses independent random keys, fixed storage and verified TLS; no local CA or SMTP reaches it', () => {
  const prepared = runtime();
  const names = ['SECRET_KEY_BASE', 'ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY', 'ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY', 'ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT', 'ISP_STAGING_KEY'];
  assert.match(prepared.SECRET_KEY_BASE, /^[a-f0-9]{128}$/);
  for (const name of names.slice(1)) assert.match(prepared[name], /^[a-f0-9]{64}$/);
  assert.equal(new Set(names.map((name) => prepared[name])).size, 5);
  assert.notEqual(runtime().ISP_STAGING_KEY, prepared.ISP_STAGING_KEY);
  assert.equal(prepared.DATABASE_URL, local.DATABASE_URL);
  assert.equal(prepared.STORAGE_ENDPOINT, `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`);
  assert.equal(prepared.STORAGE_BUCKET, 'isp-staging-private');
  assert.equal(prepared.DB_SSLMODE, 'verify-full');
  assert.equal(prepared.MAIL_FROM, 'staging@planterapp.co');
  assert.equal(prepared.ISP_ACCOUNT_EMAILS_ENABLED, 'false');
  assert.equal(prepared.ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED, 'false');
  for (const name of ['PGSSLROOTCERT', 'SMTP_PASSWORD', 'SMTP_ADDRESS', 'ISP_CONTAINER_ENABLED']) assert.equal(prepared[name], undefined);
});

test('repeated preparation retains every generated key and fixed window and refuses replacement or extension', () => {
  const existing = runtime();
  const repeated = runtime({ existing, startAt: undefined, expiresAt: undefined, random() { assert.fail('Unexpected key rotation'); } });
  assert.deepEqual(repeated, existing);
  assert.throws(() => runtime({ existing, expiresAt: '2026-10-26T12:56:00Z' }), SafeError);
  assert.throws(() => runtime({ existing, startAt: '2026-10-26T12:01:00Z' }), SafeError);
  assert.throws(() => runtime({ existing, host: 'isp-member-production.other.workers.dev' }), SafeError);
  assert.throws(() => runtime({ existing: { ...existing, ISP_STAGING_KEY: 'invalid' } }), SafeError);
  assert.throws(() => runtime({ existing: { ...existing, ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY: existing.ISP_STAGING_KEY } }), SafeError);
});

test('window admits at most 55 minutes, requires canonical UTC and refuses expired or excessive future preparation', () => {
  assert.equal(MAX_WINDOW_MS, 55 * 60 * 1000);
  assert.deepEqual(validateWindow(startAt, expiresAt, now), { ISP_STAGING_START_AT: startAt, ISP_STAGING_EXPIRES_AT: expiresAt });
  for (const [start, end] of [[startAt, '2026-10-26T12:55:01Z'], [startAt, startAt], ['2026-10-26T12:00:00+00:00', expiresAt],
    ['2026-02-30T12:00:00Z', expiresAt], ['2026-10-26T13:00:00Z', '2026-10-26T13:55:00Z']]) {
    assert.throws(() => validateWindow(start, end, now), SafeError);
  }
  assert.throws(() => validateWindow(startAt, expiresAt, Date.parse(expiresAt)), SafeError);
});

test('host permits only the pinned Worker workers.dev origin', () => {
  assert.equal(validateHost(host), host);
  for (const value of ['planterapp.co', 'other.synthetic.workers.dev', 'isp-member-production.synthetic.workers.dev.evil.test',
    'https://isp-member-production.synthetic.workers.dev', 'isp-member-production.synthetic.workers.dev:443', 'isp-member-production.synthetic.workers.dev/']) {
    assert.throws(() => validateHost(value), SafeError);
  }
});

test('Neon rejects TLS downgrades, wrong endpoint, overrides and unverified CA paths without reflecting input', () => {
  assert.equal(verifiedNeonUrl(local), local.DATABASE_URL);
  for (const invalid of [local.DATABASE_URL.replace('verify-full', 'require'), `${local.DATABASE_URL}&sslmode=disable`,
    `${local.DATABASE_URL}&host=secret-leak`, `${local.DATABASE_URL}&sslrootcert=D:/secret-leak`,
    local.DATABASE_URL.replace('ep-synthetic-pooler', 'ep-other-pooler'), local.DATABASE_URL.replace('postgresql:', 'https:'),
    local.DATABASE_URL.replace('channel_binding=require', 'channel_binding=disable')]) {
    assert.throws(() => verifiedNeonUrl({ ...local, DATABASE_URL: invalid }), (error) => error instanceof SafeError && !error.message.includes('secret-leak') && !error.message.includes('fixture'));
  }
  assert.throws(() => verifiedNeonUrl({ ...local, DB_SSLMODE: 'require' }), SafeError);
  assert.throws(() => verifiedNeonUrl({ ...local, NEON_VERIFY_HOST: undefined }), SafeError);
  assert.throws(() => runtime({ r2: { ...r2, STORAGE_BUCKET: 'other' } }), SafeError);
});

test('file preparation stores secrets only in the private output; console result contains only names and safe metadata', (t) => {
  const root = fixture(t), privateRoot = join(root, 'private');
  mkdirSync(privateRoot);
  writeFileSync(join(root, '.env.local'), Object.entries(local).map(([key, value]) => `${key}='${value}'`).join('\n'));
  writeFileSync(join(privateRoot, 'r2.json'), JSON.stringify(r2));
  const result = prepareRuntimeSecretJson({ projectRoot: root, privateRoot, host, startAt, expiresAt, now });
  const saved = JSON.parse(readFileSync(join(privateRoot, 'runtime.json'), 'utf8'));
  assert.equal(result.key_count, Object.keys(saved).length);
  assert.equal(result.path, join(privateRoot, 'runtime.json'));
  assert.ok(result.keys.includes('DATABASE_URL'));
  for (const secret of [saved.SECRET_KEY_BASE, saved.ISP_STAGING_KEY, saved.DATABASE_URL, saved.AWS_SECRET_ACCESS_KEY]) assert.equal(JSON.stringify(result).includes(secret), false);
  prepareRuntimeSecretJson({ projectRoot: root, privateRoot, host, now });
  assert.deepEqual(JSON.parse(readFileSync(join(privateRoot, 'runtime.json'), 'utf8')), saved);
});

test('unreadable or malformed private files produce generic errors and do not overwrite existing runtime', (t) => {
  const root = fixture(t), privateRoot = join(root, 'private');
  mkdirSync(privateRoot);
  writeFileSync(join(root, '.env.local'), 'DATABASE_URL=credential-bearing-invalid-value');
  writeFileSync(join(privateRoot, 'r2.json'), 'secret-body-not-json');
  writeFileSync(join(privateRoot, 'runtime.json'), 'existing-invalid-runtime');
  assert.throws(() => prepareRuntimeSecretJson({ projectRoot: root, privateRoot, host, startAt, expiresAt, now }),
    (error) => error instanceof SafeError && !/secret-body|credential-bearing|existing-invalid/.test(error.message));
  assert.equal(readFileSync(join(privateRoot, 'runtime.json'), 'utf8'), 'existing-invalid-runtime');
});

test('OAuth reader accepts Wrangler quoted top-level property and refuses missing, nested or duplicate tokens', () => {
  const token = 'synthetic_oauth_token_for_tests_1234';
  assert.equal(parseOAuthToml(`oauth_token = "${token}"\nexpiration_time = "2026-10-26"`), token);
  assert.equal(parseOAuthToml(`oauth_token = '${token}' # comment\n`), token);
  for (const text of [`[nested]\noauth_token = "${token}"`, `oauth_token="${token}"\noauth_token="${token}"`,
    `oauth_token="invalid token secret-fixture"`, `refresh_token="${token}"`, 'oauth_token = "bad\\q"']) {
    assert.throws(() => parseOAuthToml(text), (error) => error instanceof SafeError && !error.message.includes(token) && !error.message.includes('secret-fixture'));
  }
});

test('applications discovery filters by exact ISP name server-side and suppresses unrelated or sensitive fields', async () => {
  const paths = [];
  const result = await inspectApplications(async (path) => { paths.push(path); return [app, { id: 'other', name: 'unrelated', configuration: { env: { token: 'unrelated-secret' } } }]; });
  assert.deepEqual(paths, ['/containers/applications?name=isp-member-production&per_page=100']);
  assert.equal(result.applications.length, 1);
  assert.deepEqual(result.applications[0].instances, { active: 0, starting: 1 });
  const json = JSON.stringify(result);
  assert.equal(/must-not-print|unrelated|sensitive-unneeded|postgresql:/.test(json), false);
  assert.throws(() => summarizeApplication({ ...app, account_id: 'other' }), SafeError);
  assert.throws(() => summarizeApplication({ ...app, name: 'other' }), SafeError);
});

test('instance inspection pins concrete application identity and outputs only lifecycle fields', async () => {
  const paths = [];
  const instance = { id: 'a'.repeat(64), application_id: id, status: { state: 'running', updated_at: startAt, exit_code: 0 },
    configuration: { token: 'never-print' }, image: 'private-image', location: { name: 'irrelevant' } };
  const result = await inspectApplication(async (path) => { paths.push(path); return path.includes('/instances-v2') ? [instance] : app; }, id);
  assert.deepEqual(paths, [`/containers/applications/${id}`, `/containers/applications/${id}/instances-v2?per_page=100`]);
  assert.equal(result.instances[0].state, 'running');
  assert.equal(/never-print|private-image|irrelevant/.test(JSON.stringify(result)), false);
  assert.throws(() => summarizeInstance({ ...instance, application_id: 'other' }, id), SafeError);
  assert.equal(summarizeInstance({ ...instance, status: { state: 'secret-state' } }, id).state, 'unknown');
  await assert.rejects(inspectApplication(async () => ({ ...app, id: 'a'.repeat(32) }), id), SafeError);
  await assert.rejects(inspectApplication(async () => assert.fail('Must validate before network'), '../../other'), SafeError);
});

test('read-only API client permits only fixed filtered paths and prevents redirects, mutation and detailed errors', async () => {
  const calls = [], token = 'synthetic_oauth_token_for_tests_1234';
  const client = createReadonlyClient({ token, fetchImpl: async (url, options) => {
    calls.push({ url, options }); return { ok: true, json: async () => ({ success: true, result: [app] }) };
  } });
  await client('/containers/applications?name=isp-member-production&per_page=100');
  assert.equal(calls[0].url, `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/containers/applications?name=isp-member-production&per_page=100`);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${token}`);
  for (const path of ['/containers/applications', 'https://evil.test/', `/containers/applications/${id}/delete`, '/workers/scripts', '/containers/applications?name=other&per_page=100']) {
    await assert.rejects(client(path), SafeError);
  }
  assert.equal(calls.length, 1);
  const leaking = createReadonlyClient({ token, fetchImpl: async () => { throw new Error(`secret ${token}`); } });
  await assert.rejects(leaking(`/containers/applications/${id}`), (error) => error instanceof SafeError && !error.message.includes(token));
  let canceled = false;
  const denied = createReadonlyClient({ token, fetchImpl: async () => ({ ok: false, status: 403, body: { cancel: async () => { canceled = true; } }, json: () => assert.fail('Must not read error body') }) });
  await assert.rejects(denied(`/containers/applications/${id}`), (error) => error instanceof SafeError && error.message.endsWith('(HTTP 403).'));
  assert.equal(canceled, true);
});

test('ambiguous API envelopes and pagination fail closed', async () => {
  for (const envelope of [{ success: false, result: [app], errors: [{ message: 'secret-body' }] }, { success: true },
    { success: true, result: [app], result_info: { next_page_token: 'secret-cursor' } }]) {
    const client = createReadonlyClient({ token: 'fixture', fetchImpl: async () => ({ ok: true, json: async () => envelope }) });
    await assert.rejects(client('/containers/applications?name=isp-member-production&per_page=100'), (error) => error instanceof SafeError && !/secret-body|secret-cursor/.test(error.message));
  }
});

test('stop plan documents the concrete validated public API without executing a mutation', () => {
  const plan = stopPlan(app);
  assert.equal(plan.executes, false);
  assert.equal(plan.method, 'DELETE');
  assert.equal(plan.api_path, `/accounts/${ACCOUNT_ID}/containers/applications/${id}`);
  assert.match(plan.completion, /asynchronous/);
  assert.match(plan.completion, /expired request gate alone does not stop compute/);
  assert.throws(() => stopPlan({ ...app, name: 'unrelated' }), SafeError);
  for (const bad of ['', undefined, '../../delete', 'wrong', 'a'.repeat(33)]) assert.throws(() => validateApplicationId(bad), SafeError);
});
test('retired legacy CLI cannot prepare or rearm an expired runtime',async()=>{
 await assert.rejects(main(['prepare-runtime-secret-json']),/Legacy runtime preparation is retired/);
});