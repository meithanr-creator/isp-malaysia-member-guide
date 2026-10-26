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
      async transaction(callback) { return callback(this); },
      async get(key) { if (options.storageFailure) throw Error("synthetic"); return store.get(key); },
      async put(key, value) { events.push("put"); store.set(key, value); }
    },
    async start(settings) {
      events.push("start"); ctx.starts++;
      if(options.startFailure)throw new Error('private startup failure');
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
        if(new URL(req.url).pathname==='/app-ready')return new Response('application ready',{status:options.appReadyStatus||200});
        if(!['/ready','/app-ready','/up'].includes(new URL(req.url).pathname) && options.response) return options.response(req);
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
const TRACE='00000000-0000-4000-8000-000000000001';
const OPERATION='00000000-0000-4000-8000-000000000002';
function lookupRequest(id=TRACE,extra={}){
 return new Request(`http://${HOST}/__isp_diagnostics/${id}`,{headers:{'x-isp-staging-key':KEY,[EDGE_IP_HEADER]:'203.0.113.7'},...extra});
}
function mutation(){return new Request(`http://${HOST}/admin/events?member=synthetic`,{method:'POST',body:'synthetic-private-body',headers:{'x-isp-staging-key':KEY,[EDGE_IP_HEADER]:'203.0.113.7','x-isp-trace':TRACE}});}
test('backend500 keeps private metadata; freshDO lookup never starts or renews',async()=>{
 const env=environment(),h=harness(env,{response:req=>new Response('synthetic secret stack/member/body',{status:500,headers:{'x-isp-trace':req.headers.get('x-isp-trace'),'x-isp-diagnostic-operation':OPERATION,'x-isp-diagnostic-exception':'UploadOperation::StorageFailure'}})});
 const response=await h.instance.fetch(mutation());
 assert.equal(response.status,503);assert.equal(response.headers.get('x-isp-trace'),TRACE);
 assert.equal(response.headers.get('x-isp-diagnostic-operation'),null);assert.equal(response.headers.get('x-isp-diagnostic-exception'),null);
 assert.equal(await response.text(),'ISP member service is not available yet.');
 const fresh=harness(env,{},h.store);
 for(const name of ['armDeadline','startAndWaitForPorts','renewActivityTimeout','expireStaging'])fresh.instance[name]=()=>assert.fail(`lookup called ${name}`);
 fresh.ctx.storage.put=()=>assert.fail('lookup wrote state');fresh.ctx.storage.transaction=()=>assert.fail('lookup wrote ring');
 const lookup=await fresh.instance.fetch(lookupRequest());assert.equal(lookup.status,200);
 const row=(await lookup.json()).trace;
 assert.equal(row.stage,'backend_http');assert.equal(row.dispatched,true);assert.equal(row.response_received,true);assert.equal(row.status,500);assert.equal(row.operation_id,OPERATION);assert.equal(row.exception_class,'UploadOperation::StorageFailure');
 assert.equal(JSON.stringify(row).includes('synthetic'),false);
 assert.equal(fresh.ctx.starts,0);assert.equal(fresh.ctx.requests.length,0);assert.equal(fresh.instance.activeRequests,0);assert.equal(fresh.schedules.length,0);
});
test('transport failure records unknown response and never replays; duplicate ID cannot alter it',async()=>{
 const h=harness(environment(),{response:()=>{throw new TypeError('private URL/query/credential');}});
 const response=await h.instance.fetch(mutation());assert.equal(response.status,503);await response.text();
 const row=(await (await h.instance.fetch(lookupRequest())).json()).trace;
 assert.equal(row.stage,'transport');assert.equal(row.dispatched,true);assert.equal(row.response_received,false);assert.equal(row.status,null);assert.equal(row.exception_class,'TypeError');
 const again=await h.instance.fetch(mutation());assert.equal(again.status,503);
 assert.deepEqual((await (await h.instance.fetch(lookupRequest())).json()).trace,row);
 assert.equal(h.ctx.requests.filter(req=>new URL(req.url).pathname==='/admin/events').length,1);
});
test('diagnostic lookup refuses invalid requests without startup writes or activity',async()=>{
 const env=environment(),h=harness(env);
 await (await h.instance.fetch(mutation())).text();
 for(const req of [lookupRequest('bad'),lookupRequest(TRACE+'%0A'),lookupRequest(TRACE+'?query=private'),lookupRequest(TRACE,{method:'POST'}),lookupRequest(TRACE,{method:'HEAD'}),lookupRequest(TRACE,{headers:{'x-isp-staging-key':'b'.repeat(64)}}),lookupRequest(TRACE,{headers:{}}),new Request(`http://other.invalid/__isp_diagnostics/${TRACE}`,{headers:{'x-isp-staging-key':KEY}})]){
  const fresh=harness(env,{},h.store);fresh.ctx.storage.put=()=>assert.fail('lookup write');fresh.ctx.storage.transaction=()=>assert.fail('lookup ring write');
  const response=await fresh.instance.fetch(req);assert.equal(response.status,503);assert.equal(fresh.ctx.starts,0);assert.equal(fresh.schedules.length,0);assert.equal(fresh.ctx.renewed,undefined);
 }
 const fresh=harness(env,{},h.store);assert.equal((await fresh.instance.fetch(lookupRequest('00000000-0000-4000-8000-000000000099'))).status,404);
});
test('fresh lookup enforces stored earliest expiry and expired flags or storage failure',async()=>{
 for(const mode of ['deadline','expired','storage']){
  const env=environment(),h=harness(env);await (await h.instance.fetch(mutation())).text();
  if(mode==='deadline')h.store.set(DEADLINE,Date.now()-1);
  if(mode==='expired')h.store.set('isp:staging:expired',true);
  const fresh=harness(env,{storageFailure:mode==='storage'},h.store);
  const response=await fresh.instance.fetch(lookupRequest());assert.equal(response.status,503);assert.equal(fresh.ctx.starts,0);assert.equal(fresh.schedules.length,0);assert.equal(fresh.ctx.renewed,undefined);
 }
});
test('diagnostic admission and dispatch failures stop backend work; response telemetry failure preserves success',async()=>{
 for(const phase of ['admission','dispatch','response']){
  const h=harness(environment(),{response:()=>new Response('stored',{status:201})});
  const original=h.ctx.storage.transaction.bind(h.ctx.storage);
  h.ctx.storage.transaction=callback=>original(txn=>callback({get:txn.get.bind(txn),put:async(key,value)=>{
   const row=Array.isArray(value)?value.find(r=>r.id===TRACE):null;
   const fail=row&&((phase==='admission'&&row.revision===1)||(phase==='dispatch'&&row.stage==='backend_http'&&row.dispatched&&!row.response_received)||(phase==='response'&&row.response_received));
   if(fail)throw new Error('synthetic private persistence failure');
   return txn.put(key,value);
  }}));
  const response=await h.instance.fetch(mutation());
  assert.equal(response.status,phase==='response'?201:503);
  assert.equal(await response.text(),phase==='response'?'stored':'ISP member service is not available yet.');
  assert.equal(h.ctx.requests.filter(req=>new URL(req.url).pathname==='/admin/events').length,phase==='response'?1:0);
  if(phase==='response'){
   const row=(await (await h.instance.fetch(lookupRequest())).json()).trace;
   assert.equal(row.dispatched,true);assert.equal(row.response_received,false);assert.equal(row.status,null);
  }
 }
});
test('startup readiness and lease failures remain distinct and undispatched',async()=>{
 for(const [options,expected]of [[{startFailure:true},'startup'],[{appReadyStatus:503},'application_readiness'],[{waitForAbort:true},'lease']]){
  const h=harness(environment(),options);
  if(expected==='lease')h.instance.armedDeadline=Date.now()+20;
  const pending=h.instance.fetch(mutation());
  if(expected==='lease')await new Promise(resolve=>setTimeout(resolve,60));
  const response=await pending;assert.equal(response.status,503);await response.text();
  const rows=h.store.get('isp:staging:diagnostics:v1');
  assert.equal(rows.length,1);assert.equal(rows[0].stage,expected);assert.equal(rows[0].dispatched,false);assert.equal(rows[0].response_received,false);
  assert.equal(h.ctx.requests.filter(req=>new URL(req.url).pathname==='/admin/events').length,0);
 }
});