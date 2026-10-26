// cloudflare/staging/staging.test.mjs
// Run: node --import ./test/register-loader.mjs --test staging/staging.test.mjs
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile } from "node:fs/promises";
import worker, { RailsContainer, allowedStagingRequest, stagingWindow } from "./index.js";
import { EDGE_IP_HEADER } from "../src/runtime.js";

const HOST = "isp-member-production.meithan-r.workers.dev";
const KEY = "a".repeat(64);
const DEADLINE = "isp:staging:earliest-deadline";
const NativeRequest = globalThis.Request;
globalThis.Request = class extends NativeRequest {
  constructor(input, init) {
    super(input, init);
    const cf = init?.cf ?? input?.cf;
    if (cf) Object.defineProperty(this, "cf", { value: cf });
  }
};
after(() => { globalThis.Request = NativeRequest; });

function environment(overrides = {}) {
  const now = Math.floor(Date.now() / 1000) * 1000;
  const iso = (time) => new Date(time).toISOString().replace(".000Z", "Z");
  return {
    ISP_CONTAINER_ENABLED: "true", APP_HOST: HOST, ISP_STAGING_KEY: KEY,
    ISP_STAGING_START_AT: iso(now - 10000), ISP_STAGING_EXPIRES_AT: iso(now + 120000),
    ISP_DEMO_MODE: "false", ISP_ACCOUNT_EMAILS_ENABLED: "false",
    ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED: "false", DB_SSLMODE: "verify-full",
    DATABASE_URL: "postgresql://synthetic:synthetic@db.internal/isp?sslmode=verify-full",
    SECRET_KEY_BASE: "synthetic-key-".repeat(8), STORAGE_BUCKET: "synthetic-private",
    AWS_REGION: "auto", AWS_ACCESS_KEY_ID: "synthetic-access",
    AWS_SECRET_ACCESS_KEY: "synthetic-storage-secret", MAIL_FROM: "membership@isp.org.my",
    ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY: "p".repeat(32),
    ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY: "d".repeat(32),
    ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT: "s".repeat(32), ...overrides
  };
}
function request(key = KEY, edge = false) {
  return new Request(`${edge ? "https" : "http"}://${HOST}/`, {
    headers: { "x-isp-staging-key": key, [EDGE_IP_HEADER]: "203.0.113.7",
      "CF-Connecting-IP": "203.0.113.7" }, ...(edge ? { cf: { colo: "KUL" } } : {})
  });
}
function harness(env, options = {}, store = new Map()) {
  const events = [], schedules = [], requests = [];
  const ctx = {
    events, requests, starts: 0, kills: 0,
    storage: {
      async get(key) { if (options.storageFailure) throw Error("synthetic"); return store.get(key); },
      async put(key, value) { events.push("put"); store.set(key, value); }
    },
    async start(settings) {
      events.push("start"); ctx.starts++;
      assert.ok(store.has(DEADLINE), "deadline must persist before startup");
      assert.ok(schedules.length, "shutdown must be armed before startup");
      if (options.waitForAbort) {
        const signal = settings.cancellationOptions.abort;
        await new Promise((resolve, reject) => {
          const abort = () => { ctx.observedAbort = true; reject(Error("synthetic")); };
          if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
        });
      }
    },
    container: {
      running: true,
      getTcpPort() { return { async fetch(req) {
        requests.push(req);
        if(new URL(req.url).pathname !== '/ready' && options.response) return options.response(req);
        return new Response(new URL(req.url).pathname === "/ready" ? "ready" : "synthetic page");
      } }; }
    }
  };
  const instance = new RailsContainer(ctx, env);
  instance.listSchedules = async () => schedules;
  instance.schedule = async (when, callback) => {
    if (options.scheduleFailure) throw Error("synthetic");
    events.push("schedule");
    const entry = { callback, when, time: when instanceof Date ? when.getTime() / 1000 : Date.now() / 1000 + when };
    schedules.push(entry); return entry;
  };
  instance.destroy = async () => {
    ctx.kills++;
    if (options.destroyFailure) throw Error("synthetic");
    ctx.container.running = false;
  };
  return { instance, ctx, store, schedules };
}

test("flags, keys, host and fixed time boundaries fail closed", async () => {
  const env = environment(), req = request(), window = stagingWindow(env);
  assert.equal(allowedStagingRequest(req, env, window.start - 1), false);
  assert.equal(allowedStagingRequest(req, env, window.end), false);
  assert.equal(allowedStagingRequest(request("b".repeat(64)), env), false);
  for (const change of [
    { ISP_CONTAINER_ENABLED: "false" }, { APP_HOST: "planterapp.co" },
    { ISP_ACCOUNT_EMAILS_ENABLED: "true" }, { ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED: "true" },
    { ISP_DEMO_MODE: "true" }, { ISP_STAGING_KEY: "" }, { ISP_STAGING_START_AT: "" },
    { ISP_STAGING_EXPIRES_AT: "invalid" }, { ISP_STAGING_EXPIRES_AT: "2026-02-30T00:00:00Z" },
    { ISP_STAGING_START_AT: "2026-01-01T00:00:00Z", ISP_STAGING_EXPIRES_AT: "2026-01-01T01:00:00Z" }
  ]) {
    const dangerous = new Proxy({}, { get() { assert.fail("must not acquire binding"); } });
    assert.equal((await worker.fetch(request(KEY, true), { ...env, ...change, RAILS_CONTAINER: dangerous })).status, 503);
    const h = harness({ ...env, ...change });
    assert.equal((await h.instance.fetch(req)).status, 503);
    assert.equal(h.ctx.starts, 0);
  }
});

test("Worker and DO independently require the key; authorized flow strips it before Rails", async () => {
  const env = environment(), h = harness(env);
  let acquired = 0;
  env.RAILS_CONTAINER = { idFromName: (name) => name, get() { acquired++; return h.instance; } };
  assert.equal((await worker.fetch(request("", true), env)).status, 503);
  assert.equal(acquired, 0);
  assert.equal((await h.instance.fetch(request(""))).status, 503);
  assert.equal(h.ctx.starts, 0);
  assert.equal(await (await worker.fetch(request(KEY, true), env)).text(), "synthetic page");
  assert.equal(acquired, 1);
  assert.equal(h.ctx.requests.length, 2);
  for (const req of h.ctx.requests) assert.equal(req.headers.get("x-isp-staging-key"), null);
  assert.ok(h.ctx.events.indexOf("schedule") < h.ctx.events.indexOf("start"));
});

test("earliest deadline survives a new instance and later configuration", async () => {
  const env = environment(), h = harness(env);
  assert.equal(await (await h.instance.fetch(request())).text(), "synthetic page");
  const earliest = h.store.get(DEADLINE);
  const later = new Date(earliest + 60000).toISOString().replace(".000Z", "Z");
  const restarted = harness({ ...env, ISP_STAGING_EXPIRES_AT: later }, {}, h.store);
  assert.equal(await (await restarted.instance.fetch(request())).text(), "synthetic page");
  assert.equal(restarted.store.get(DEADLINE), earliest);
  assert.equal(restarted.instance.armedDeadline, earliest);
});

test("storage or scheduling failure denies startup", async () => {
  for (const options of [{ storageFailure: true }, { scheduleFailure: true }]) {
    const h = harness(environment(), options);
    assert.equal((await h.instance.fetch(request())).status, 503);
    assert.equal(h.ctx.starts, 0);
  }
});

test("remaining deadline aborts startup before the base ten-minute lifetime", async () => {
  const h = harness(environment(), { waitForAbort: true });
  h.instance.armedDeadline = Date.now() + 40;
  const pending = h.instance.fetch(request());
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal((await pending).status, 503);
  assert.equal(h.ctx.observedAbort, true);
  assert.equal(h.instance.activeRequests, 0);
});

test("expired active container is destroyed without renewal; failed destroy retries in five seconds", async (t) => {
  const env = environment(), end = stagingWindow(env).end;
  const h = harness(env, { destroyFailure: true });
  await h.instance.armDeadline(end);
  h.instance.activeRequests = 2;
  t.mock.timers.enable({ apis: ["Date"], now: end + 1 });
  await h.instance.onActivityExpired();
  assert.equal(h.ctx.kills, 1);
  assert.equal(h.schedules.at(-1).when, 5);
  assert.equal(h.schedules.at(-1).callback, "expireStaging");
  const renewed = h.ctx.renewed;
  h.instance.renewActivityTimeout();
  assert.equal(h.ctx.renewed, renewed);
});

test("source configuration stays disabled, isolated and limited to one instance", async () => {
  const source = await readFile(new URL("./wrangler.jsonc", import.meta.url), "utf8");
  const config = JSON.parse(source.replace(/^\s*\/\/.*$/gm, ""));
  assert.equal(config.workers_dev, false); assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, []); assert.equal(config.vars.ISP_CONTAINER_ENABLED, "false");
  assert.equal(config.vars.ISP_STAGING_START_AT, ""); assert.equal(config.vars.ISP_STAGING_EXPIRES_AT, "");
  for (const key of ["ISP_DEMO_MODE", "ISP_ACCOUNT_EMAILS_ENABLED", "ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED"]) assert.equal(config.vars[key], "false");
  assert.equal(config.vars.ISP_STAGING_KEY, undefined); assert.equal(config.containers.length, 1);
  assert.equal(config.containers[0].name, "isp-member-production");
  assert.equal(config.containers[0].max_instances, 1); assert.equal(config.containers[0].instance_type, "standard-2");
});

test('remaining deadline cancels an unfinished response stream and releases activity',async()=>{
 let cancelled=0;
 const h=harness(environment(),{response:()=>new Response(new ReadableStream({cancel(){cancelled++;}}))});
 h.instance.armedDeadline=Date.now()+50;
 const response=await h.instance.fetch(request());
 assert.equal(response.status,200);assert.equal(h.instance.activeRequests,1);
 await new Promise(resolve=>setTimeout(resolve,90));
 await assert.rejects(response.text());assert.equal(h.instance.activeRequests,0);assert.equal(cancelled,1);
});
test('idle renewal is clamped to absolute expiry and cannot renew afterward',t=>{
 const h=harness(environment());const cutoff=Date.now()+100;
 h.instance.armedDeadline=cutoff;h.instance.renewActivityTimeout();
 assert.equal(h.instance.sleepAfterMs,cutoff);assert.equal(h.ctx.renewed,1);
 t.mock.timers.enable({apis:['Date'],now:cutoff+1});h.instance.renewActivityTimeout();
 assert.equal(h.ctx.renewed,1);
});