import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import worker, { RailsContainer } from "../src/index.js";
import { REQUIRED_VALUES, INSTANCE_NAME, EDGE_IP_HEADER, runtimeConfiguration, validClientIp } from "../src/runtime.js";
import { REQUEST_LIFETIME_MS } from "../src/lifetime.js";

function environment(overrides = {}) {
  return {
    ISP_CONTAINER_ENABLED: "true", APP_HOST: "planterapp.co",
    DATABASE_URL: "postgresql://synthetic:synthetic@db.internal/isp",
    SECRET_KEY_BASE: "synthetic-key-".repeat(8), STORAGE_BUCKET: "synthetic-private",
    AWS_REGION: "auto", AWS_ACCESS_KEY_ID: "synthetic-access", AWS_SECRET_ACCESS_KEY: "synthetic-storage-secret",
    MAIL_FROM: "membership@isp.org.my", ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY: "p".repeat(32),
    ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY: "d".repeat(32), ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT: "s".repeat(32),
    ...overrides
  };
}
function edgeRequest(path = "/", init = {}) {
  const request = new Request(`https://planterapp.co${path}`, {
    ...init, headers: { "CF-Connecting-IP": "203.0.113.7", ...init.headers }
  });
  Object.defineProperty(request, "cf", { value: { colo: "KUL" } });
  return request;
}
function binding(fetch) {
  const names = [];
  return { names, idFromName(name) { names.push(name); return name; }, get(id) { assert.equal(id, INSTANCE_NAME); return { fetch }; } };
}
function containerContext(options = {}) {
  const requests = [];
  const starts = [];
  const context = {
    requests, starts,
    async start(settings, env) { starts.push({ settings, env }); if (options.start) await options.start(settings); },
    container: {
      running: true,
      getTcpPort(port) {
        assert.equal(port, 3000);
        return { async fetch(request) {
          requests.push(request);
          if (new URL(request.url).pathname === "/ready") return new Response("ready", { status: options.readyStatus || 200 });
          return options.fetch ? options.fetch(request) : new Response("member page", { headers: { "Set-Cookie": "session=synthetic; Secure; HttpOnly", "Cache-Control": "public" } });
        } };
      }
    }
  };
  return context;
}
function internalRequest(path = "/", init = {}) {
  return new Request(`http://planterapp.co${path}`, { ...init, headers: { [EDGE_IP_HEADER]: "203.0.113.7", ...init.headers } });
}
async function advance(t, ms) { t.mock.timers.tick(ms); for (let i = 0; i < 12; i++) await Promise.resolve(); }

async function assertUnavailable(response) {
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await response.text(), "ISP member service is not available yet.");
}

test("disabled activation and missing required values never acquire an instance", async () => {
  const dangerousBinding = new Proxy({}, { get() { throw new Error("must not access binding"); } });
  await assertUnavailable(await worker.fetch(edgeRequest(), environment({ ISP_CONTAINER_ENABLED: "false", RAILS_CONTAINER: dangerousBinding })));
  for (const key of REQUIRED_VALUES) {
    const env = environment({ RAILS_CONTAINER: dangerousBinding });
    delete env[key];
    await assertUnavailable(await worker.fetch(edgeRequest(), env));
  }
});

test("configuration rejects unsafe database transport, bad origins and incomplete enabled mail", () => {
  for (const overrides of [
    { DATABASE_URL: "sqlite3:temporary.sqlite3" }, { DATABASE_URL: "postgresql://db.internal/isp?sslmode=disable" },
    { DB_SSLMODE: "disable" }, { APP_HOST: "https://planterapp.co" }, { APP_HOST: "*.planterapp.co" },
    { STORAGE_ENDPOINT: "http://private-files.invalid" }, { ISP_ACCOUNT_EMAILS_ENABLED: "true" }
  ]) assert.equal(runtimeConfiguration(environment(overrides)), null);
});

test("all paths use one named instance and rebuild trusted forwarding headers", async () => {
  const requests = [];
  const namespace = binding(async (request) => { requests.push(request); return new Response("ok"); });
  const env = environment({ RAILS_CONTAINER: namespace });
  const response = await worker.fetch(edgeRequest("/member/profile?tab=contact", {
    method: "POST", body: "submitted=synthetic",
    headers: {
      Host: "spoofed.invalid", Forwarded: "for=10.0.0.1;proto=http", "X-Forwarded-For": "10.0.0.1",
      "X-Forwarded-Host": "spoofed.invalid", "X-Forwarded-Proto": "http", "X-Real-IP": "10.0.0.1",
      "X-Original-Host": "spoofed.invalid", "CF-Container-Target-Port": "3310", [EDGE_IP_HEADER]: "10.0.0.1",
      Cookie: "session=synthetic", "X-CSRF-Token": "synthetic-csrf", Origin: "https://planterapp.co"
    }
  }), env);
  assert.equal(await response.text(), "ok");
  const forwarded = requests[0];
  assert.equal(new URL(forwarded.url).pathname, "/member/profile");
  assert.equal(new URL(forwarded.url).search, "?tab=contact");
  assert.equal(forwarded.method, "POST");
  assert.equal(await forwarded.text(), "submitted=synthetic");
  assert.equal(forwarded.redirect, "manual");
  assert.equal(forwarded.headers.get("host"), "planterapp.co");
  assert.equal(forwarded.headers.get("x-forwarded-host"), "planterapp.co");
  assert.equal(forwarded.headers.get("x-forwarded-proto"), "https");
  assert.equal(forwarded.headers.get("x-forwarded-port"), "443");
  assert.equal(forwarded.headers.get("x-forwarded-for"), null);
  assert.equal(forwarded.headers.get(EDGE_IP_HEADER), "203.0.113.7");
  for (const name of ["forwarded", "x-real-ip", "x-original-host", "cf-container-target-port", "cf-connecting-ip"]) assert.equal(forwarded.headers.get(name), null);
  assert.equal(forwarded.headers.get("cookie"), "session=synthetic");
  assert.equal(forwarded.headers.get("x-csrf-token"), "synthetic-csrf");
  assert.equal(forwarded.headers.get("origin"), "https://planterapp.co");
  await worker.fetch(edgeRequest("/events"), env);
  assert.deepEqual(namespace.names, [INSTANCE_NAME, INSTANCE_NAME]);
});

test("noncanonical requests and untrusted IP headers do not start a container", async () => {
  let calls = 0;
  const env = environment({ RAILS_CONTAINER: binding(() => { calls++; return new Response("unexpected"); }) });
  const missingMetadata = new Request("https://planterapp.co/", { headers: { "CF-Connecting-IP": "203.0.113.7" } });
  for (const request of [missingMetadata, new Request("http://planterapp.co/"), new Request("https://other.invalid/"), edgeRequest("/", { headers: { Upgrade: "websocket" } }), edgeRequest("/", { headers: { "CF-Connecting-IP": "203.0.113.7,10.0.0.1" } })]) await assertUnavailable(await worker.fetch(request, env));
  assert.equal(calls, 0);
  assert.equal(validClientIp("2001:db8::1"), true);
  assert.equal(validClientIp("::::"), false);
});

test("binding failures and backend errors never expose internal errors or secrets", async () => {
  const secret = "synthetic-provider-secret-that-must-not-leak";
  for (const fetch of [async () => { throw new Error(secret); }, async () => new Response(secret, { status: 500 })]) {
    await assertUnavailable(await worker.fetch(edgeRequest(), environment({ RAILS_CONTAINER: binding(fetch) })));
  }
});

test("runtime environment is explicitly allowlisted and sensitive unsafe knobs cannot override fixed settings", async () => {
  const ctx = containerContext();
  const env = environment({ CLOUDFLARE_API_TOKEN: "do-not-forward", SECRET_KEY_BASE_DUMMY: "1", ISP_DEMO_MODE: "true", RAILS_ENV: "development", CLAMD_HOST: "public.invalid" });
  const instance = new RailsContainer(ctx, env);
  const response = await instance.fetch(internalRequest());
  assert.equal(await response.text(), "member page");
  const forwarded = ctx.starts[0].env;
  assert.equal(forwarded.DATABASE_URL, env.DATABASE_URL);
  assert.equal(forwarded.RAILS_ENV, "production");
  assert.equal(forwarded.ISP_DEMO_MODE, "false");
  assert.equal(forwarded.CLAMD_HOST, "127.0.0.1");
  assert.equal(forwarded.CLAMD_PORT, "3310");
  assert.equal(forwarded.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(forwarded.SECRET_KEY_BASE_DUMMY, undefined);
  assert.equal(ctx.starts[0].settings.cancellationOptions.portReadyTimeoutMS, 360000);
  assert.equal(ctx.requests.length, 2);
  assert.equal(ctx.requests[1].headers.get(EDGE_IP_HEADER), null);
  assert.equal(ctx.requests[1].headers.get("x-forwarded-for"), "203.0.113.7");
  assert.equal(response.headers.get("set-cookie"), "session=synthetic; Secure; HttpOnly");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(instance.activeRequests, 0);
});

test("readiness failure blocks application traffic and releases activity", async () => {
  const ctx = containerContext({ readyStatus: 503 });
  const instance = new RailsContainer(ctx, environment());
  await assertUnavailable(await instance.fetch(internalRequest("/member/dashboard")));
  assert.equal(ctx.requests.length, 1);
  assert.equal(instance.activeRequests, 0);
});

test("startup errors and application transport failures produce generic responses without logs or replay", async () => {
  const logs = [];
  const previous = console.error;
  console.error = (...args) => logs.push(args);
  try {
    for (const options of [ { start: async () => { throw new Error("synthetic-database-secret"); } }, { fetch: async () => { throw new Error("synthetic-provider-secret"); } } ]) {
      const ctx = containerContext(options);
      const instance = new RailsContainer(ctx, environment());
      await assertUnavailable(await instance.fetch(internalRequest("/session", { method: "POST", body: "password=synthetic" })));
      assert.equal(instance.activeRequests, 0);
      assert.ok(ctx.requests.filter((request) => new URL(request.url).pathname === "/session").length <= 1);
      instance.onError(new Error("synthetic-secret"));
    }
    assert.deepEqual(logs, []);
  } finally { console.error = previous; }
});

test("startup longer than sixty seconds remains active until the response ends", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ctx = containerContext({ start: () => new Promise((resolve) => setTimeout(resolve, 90000)) });
  const instance = new RailsContainer(ctx, environment());
  const pending = instance.fetch(internalRequest());
  await advance(t, 61000);
  await instance.onActivityExpired();
  assert.equal(instance.activeRequests, 1);
  assert.equal(ctx.stopped, undefined);
  await advance(t, 30000);
  const response = await pending;
  assert.equal(await response.text(), "member page");
  assert.equal(instance.activeRequests, 0);
  await instance.onActivityExpired();
  assert.equal(ctx.stopped, true);
});

test("a response stream longer than sixty seconds remains protected through EOF", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let source;
  const stream = new ReadableStream({ start(controller) { source = controller; } });
  const ctx = containerContext({ fetch: async () => new Response(stream) });
  const instance = new RailsContainer(ctx, environment());
  const response = await instance.fetch(internalRequest("/member/publications/book.pdf"));
  await advance(t, 61000);
  await instance.onActivityExpired();
  assert.equal(instance.activeRequests, 1);
  assert.equal(ctx.stopped, undefined);
  source.enqueue(new TextEncoder().encode("synthetic PDF bytes"));
  source.close();
  assert.equal(await response.text(), "synthetic PDF bytes");
  assert.equal(instance.activeRequests, 0);
});

test("non-consuming clients hit the finite lifetime and cancel the upstream response", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let cancellations = 0;
  const stream = new ReadableStream({ cancel() { cancellations++; } });
  const ctx = containerContext({ fetch: async () => new Response(stream) });
  const instance = new RailsContainer(ctx, environment());
  const response = await instance.fetch(internalRequest());
  await advance(t, REQUEST_LIFETIME_MS + 1);
  assert.equal(instance.activeRequests, 0);
  assert.equal(cancellations, 1);
  await assert.rejects(response.text(), /cancelled/);
  await instance.onActivityExpired();
  assert.equal(ctx.stopped, true);
});

test("client cancellation releases activity without waiting for the lifetime deadline", async () => {
  let cancellations = 0;
  const ctx = containerContext({ fetch: async () => new Response(new ReadableStream({ cancel() { cancellations++; } })) });
  const instance = new RailsContainer(ctx, environment());
  const response = await instance.fetch(internalRequest());
  await response.body.cancel();
  assert.equal(instance.activeRequests, 0);
  assert.equal(cancellations, 1);
});

test("proposed configuration stays private, capped and disabled", async () => {
  const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(config.name, INSTANCE_NAME);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, []);
  assert.equal(config.vars.ISP_CONTAINER_ENABLED, "false");
  assert.equal(config.containers.length, 1);
  assert.equal(config.containers[0].max_instances, 1);
  assert.equal(config.containers[0].instance_type, "standard-2");
  assert.equal(config.containers[0].image_build_context, "..");
  assert.equal(config.containers[0].image, "../deployment/cloudflare/Dockerfile.runtime");
  assert.equal(new RailsContainer(containerContext(), environment()).sleepAfter, "60s");
});
