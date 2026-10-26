import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { directDatabaseEnvironment, loadLocalEnvironment } from './neon-run.mjs';

const scratchRoot = fileURLToPath(new URL('../tmp/', import.meta.url));

function fixture(t) {
  mkdirSync(scratchRoot, { recursive: true });
  const root = mkdtempSync(join(scratchRoot, 'neon-helper-'));
  t.after(() => {
    assert.ok(resolve(root).startsWith(resolve(scratchRoot) + sep));
    rmSync(root, { recursive: true });
  });
  return root;
}

test('local overrides base file, inherited environment wins, and parent remains unchanged', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, '.env'), 'NEON_HELPER_VALUE=base\nNEON_HELPER_FILE_ONLY=base\n');
  writeFileSync(join(root, '.env.local'), 'NEON_HELPER_VALUE=local\nNEON_HELPER_FILE_ONLY="local value"\n');
  const before = process.env.NEON_HELPER_VALUE;
  const inherited = { NEON_HELPER_VALUE: 'inherited' };
  const loaded = loadLocalEnvironment(root, inherited);
  assert.equal(loaded.NEON_HELPER_VALUE, 'inherited');
  assert.equal(loaded.NEON_HELPER_FILE_ONLY, 'local value');
  assert.deepEqual(inherited, { NEON_HELPER_VALUE: 'inherited' });
  assert.equal(process.env.NEON_HELPER_VALUE, before);
});

test('quoted shell syntax stays literal and is delivered only to a child environment', (t) => {
  const root = fixture(t);
  const literal = '$(echo should-never-execute); `literal` & value';
  writeFileSync(join(root, '.env.local'), `NEON_HELPER_VALUE='${literal}'\n`);
  const before = process.env.NEON_HELPER_VALUE;
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(process.env.NEON_HELPER_VALUE)'], {
    env: loadLocalEnvironment(root, {}), encoding: 'utf8', shell: false
  });
  assert.equal(child.status, 0);
  assert.equal(child.stdout, literal);
  assert.equal(process.env.NEON_HELPER_VALUE, before);
});

test('missing optional environment files retain the inherited values', (t) => {
  assert.deepEqual(loadLocalEnvironment(fixture(t), { NEON_HELPER_VALUE: 'inherited' }), { NEON_HELPER_VALUE: 'inherited' });
});

test('direct maintenance selects the direct URL without changing the pooled application environment', () => {
  const host = 'ep-synthetic.ap-southeast-1.aws.neon.tech';
  const env = {
    DATABASE_URL: `postgresql://synthetic:fixture@ep-synthetic-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full`,
    DATABASE_URL_UNPOOLED: `postgresql://synthetic:fixture@${host}/neondb?sslmode=verify-full`,
    NEON_VERIFY_HOST: host
  };
  const original = { ...env };
  assert.equal(directDatabaseEnvironment(env).DATABASE_URL, env.DATABASE_URL_UNPOOLED);
  assert.deepEqual(env, original);
});

test('direct maintenance rejects unverified TLS, a different endpoint, pooling and query target overrides', () => {
  const host = 'ep-synthetic.ap-southeast-1.aws.neon.tech';
  const base = `postgresql://synthetic:fixture@${host}/neondb?sslmode=verify-full`;
  for (const invalid of [
    base.replace('verify-full', 'require'),
    `${base}&sslmode=disable`,
    base.replace('ep-synthetic.', 'ep-other.'),
    base.replace('ep-synthetic.', 'ep-synthetic-pooler.'),
    `${base}&host=ep-other.ap-southeast-1.aws.neon.tech`
  ]) {
    assert.throws(() => directDatabaseEnvironment({ NEON_VERIFY_HOST: host, DATABASE_URL_UNPOOLED: invalid }));
  }
  assert.throws(() => directDatabaseEnvironment({ NEON_VERIFY_HOST: host }));
});