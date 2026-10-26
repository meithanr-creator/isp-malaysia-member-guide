import { mkdirSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

// Local file values are data, never shell input. Keep process.env unchanged.
export function loadLocalEnvironment(root = projectRoot, inherited = process.env) {
  let local = {};
  for (const name of ['.env', '.env.local']) {
    try {
      local = { ...local, ...parseEnv(readFileSync(join(root, name), 'utf8')) };
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Cannot load ${name}.`, { cause: error });
    }
  }
  return { ...local, ...inherited };
}

export function directDatabaseEnvironment(env) {
  if (!env.DATABASE_URL_UNPOOLED) throw new Error('DATABASE_URL_UNPOOLED is required for direct Neon maintenance.');
  let url;
  try { url = new URL(env.DATABASE_URL_UNPOOLED); }
  catch { throw new Error('DATABASE_URL_UNPOOLED must be a valid PostgreSQL URL.'); }
  const host = (env.NEON_VERIFY_HOST || '').toLowerCase();
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.neon\.tech$/.test(host) || host.includes('-pooler.') || url.hostname.toLowerCase() !== host || (url.searchParams.getAll('sslmode').length !== 1 || url.searchParams.get('sslmode') !== 'verify-full')) {
    throw new Error('Direct Neon maintenance requires the approved direct host and sslmode=verify-full.');
  }
  if (['host', 'hostaddr', 'dbname', 'service', 'user', 'password', 'port'].some((key) => url.searchParams.has(key))) {
    throw new Error('Connection target overrides are not allowed for direct Neon maintenance.');
  }
  return { ...env, DATABASE_URL: env.DATABASE_URL_UNPOOLED };
}
function run(command, args, env, cwd = projectRoot) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: false });
  if (result.error) throw new Error('Could not start the requested local tool.');
  if (result.status !== 0) throw new Error(`Local tool failed (exit ${result.status ?? 'signal'}).`);
}

function rails(args, env) {
  if (process.platform === 'win32') {
    run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(projectRoot, 'script', 'rails.ps1'), ...args], env);
  } else {
    run('ruby', ['bin/rails', ...args], env);
  }
}

function rubyScript(script, env) {
  let ruby = 'ruby';
  if (process.platform === 'win32') {
    const tools = join(dirname(projectRoot.replace(/[\\/]$/, '')), 'isp-rails-tools');
    const gems = join(tools, 'gems');
    const rubyBin = join(tools, 'ruby34-devkit', 'bin');
    env = { ...env, GEM_HOME: gems, GEM_PATH: gems, BUNDLE_USER_HOME: join(tools, 'bundle-home'), TEMP: join(tools, 'tmp'), TMP: join(tools, 'tmp'), PATH: [rubyBin, join(gems, 'bin'), env.PATH ?? env.Path ?? ''].join(delimiter) };
    ruby = join(rubyBin, 'ruby.exe');
  }
  run(ruby, ['-rbundler/setup', `script/${script}`], env);
}

export function main(args = process.argv.slice(2)) {
  const [action, ...rest] = args;
  const env = loadLocalEnvironment();
  switch (action) {
    case 'build': {
      if (rest.length) throw new Error('Usage: neon-run.mjs build');
      rubyScript('neon-build-assets.rb', { ...env, RAILS_ENV: 'production', SECRET_KEY_BASE_DUMMY: '1' });
      const npm = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
      run(process.execPath, [npm, '--prefix', 'cloudflare', 'run', 'check'], env);
      console.log('Rails assets (tmp/neon-build/assets) and Cloudflare configuration/bundle checks passed.');
      break;
    }
    case 'start':
      if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required for the Neon-backed local app.');
      rails(['server', '--binding=127.0.0.1', '--port=4181', '--pid=tmp/pids/neon-server.pid', ...rest], { ...env, RAILS_ENV: env.RAILS_ENV || 'development' });
      break;
    case 'rails':
      if (!rest.length) throw new Error('Usage: neon-run.mjs rails <Rails arguments>');
      rails(rest, env);
      break;
    case 'migrate':
      if (rest.length) throw new Error('Usage: neon-run.mjs migrate');
      mkdirSync(join(projectRoot, 'tmp', 'neon-build'), { recursive: true });
      rails(['db:migrate'], { ...directDatabaseEnvironment(env), RAILS_ENV: env.RAILS_ENV || 'development', SCHEMA: join(projectRoot, 'tmp', 'neon-build', 'schema.rb') });
      break;
    case 'e2e':
      if (rest.length) throw new Error('Usage: neon-run.mjs e2e');
      if ((env.RAILS_ENV || 'development') !== 'development') throw new Error('The bounded local E2E helper requires development mode.');
      directDatabaseEnvironment(env); // Validate the separate persistence-check target before Rails boots.
      rails(['runner', 'script/neon-e2e.rb'], { ...env, RAILS_ENV: 'development' });
      break;
    case 'verify-db':
      if (rest.length) throw new Error('Usage: neon-run.mjs verify-db (requires NEON_VERIFY_HOST)');
      if (!env.NEON_VERIFY_HOST) throw new Error('NEON_VERIFY_HOST must name the approved Neon endpoint.');
      rubyScript('neon-verify-db.rb', directDatabaseEnvironment(env));
      break;
    default:
      throw new Error('Usage: neon-run.mjs build|start|rails <arguments>|migrate|verify-db|e2e');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); }
  catch (error) {
    // Do not echo child environment values or database connection errors.
    console.error(error.message);
    process.exitCode = 1;
  }
}
