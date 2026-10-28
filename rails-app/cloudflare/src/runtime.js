import { TRACE_HEADER, validUuid } from "./diagnostics.js";
export const INSTANCE_NAME = "isp-member-production";
export const EDGE_IP_HEADER = "x-isp-edge-client-ip";
export const REQUIRED_VALUES = Object.freeze([
  "APP_HOST", "DATABASE_URL", "SECRET_KEY_BASE", "STORAGE_BUCKET", "AWS_REGION",
  "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "MAIL_FROM",
  "ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY", "ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY",
  "ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT"
]);
const OPTIONAL_VALUES = Object.freeze([
  "STORAGE_ENDPOINT", "STORAGE_FORCE_PATH_STYLE", "DB_SSLMODE", "SMTP_ADDRESS",
  "SMTP_PORT", "SMTP_DOMAIN", "SMTP_USERNAME", "SMTP_PASSWORD"
]);
const STRIPPED_HEADERS = new Set([
  "forwarded", "x-real-ip", "client-ip", "x-client-ip", "true-client-ip",
  "cf-connecting-ip", "cf-connecting-ipv6", "cf-visitor", "cf-container-target-port",
  "x-original-host", "x-original-url", "x-rewrite-url", "x-http-host-override",
  "x-request-id", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "content-length", EDGE_IP_HEADER
]);

export function unavailable(traceId = null) {
  return new Response("ISP member service is not available yet.", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...(validUuid(traceId) ? { [TRACE_HEADER]: traceId } : {}) }
  });
}

// Shape validation cannot certify database, mail, scanner or release readiness.
export function runtimeConfiguration(env) {
  try {
    if (env.ISP_CONTAINER_ENABLED !== "true") return null;
    if (REQUIRED_VALUES.some((key) => typeof env[key] !== "string" || !env[key].trim())) return null;
    const host = env.APP_HOST;
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return null;
    if (/(?:^|\.)(?:localhost|example\.(?:com|org|net)|invalid|test)$/.test(host)) return null;
    if (env.SECRET_KEY_BASE.length < 64) return null;
    if (REQUIRED_VALUES.filter((key) => key.startsWith("ACTIVE_RECORD_ENCRYPTION_")).some((key) => env[key].length < 32)) return null;
    const database = new URL(env.DATABASE_URL);
    if (!["postgres:", "postgresql:"].includes(database.protocol) || !database.hostname || database.pathname.length < 2) return null;
    if (!["require", "verify-full"].includes(env.DB_SSLMODE || "require")) return null;
    if (database.searchParams.has("sslmode") && !["require", "verify-full"].includes(database.searchParams.get("sslmode"))) return null;
    if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(env.MAIL_FROM)) return null;
    if (env.STORAGE_ENDPOINT) {
      const endpoint = new URL(env.STORAGE_ENDPOINT);
      if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return null;
    }
    for (const key of ["SMTP_PORT"]) {
      if (env[key] && (!/^\d+$/.test(env[key]) || Number(env[key]) < 1 || Number(env[key]) > 65535)) return null;
    }
    if (env.ISP_ACCOUNT_EMAILS_ENABLED === "true" &&
      (env.ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED !== "true" || ["SMTP_ADDRESS", "SMTP_USERNAME", "SMTP_PASSWORD"].some((key) => !env[key]?.trim()))) return null;
    const containerEnv = Object.fromEntries(REQUIRED_VALUES.map((key) => [key, env[key]]));
    for (const key of OPTIONAL_VALUES) {
      if (typeof env[key] === "string" && env[key]) containerEnv[key] = env[key];
    }
    Object.assign(containerEnv, {
      RAILS_ENV: "production", PORT: "3000", RAILS_MAX_THREADS: "3", WEB_CONCURRENCY: "1",
      RAILS_LOG_LEVEL: "info", ISP_DEMO_MODE: "false", DB_SSLMODE: env.DB_SSLMODE || "require",
      CLAMD_HOST: "127.0.0.1", CLAMD_PORT: "3310",
      ISP_ACCOUNT_EMAILS_ENABLED: env.ISP_ACCOUNT_EMAILS_ENABLED === "true" ? "true" : "false",
      ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED: env.ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED === "true" ? "true" : "false"
    });
    return { host, containerEnv };
  } catch {
    return null;
  }
}

export function validClientIp(value) {
  if (typeof value !== "string") return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return value.split(".").every((part) => Number(part) <= 255);
  if (!value.includes(":") || !/^[a-fA-F0-9:.]{2,45}$/.test(value)) return false;
  try { return new URL(`http://[${value}]/`).hostname.length > 0; } catch { return false; }
}

export function edgeClientIp(request) {
  // cf is platform metadata, not an HTTP header. Service-binding callers without
  // an edge request do not establish a trusted IP for Rails' login rate limits.
  if (!request.cf || typeof request.cf.colo !== "string") return null;
  const ip = request.headers.get("cf-connecting-ip");
  return validClientIp(ip) ? ip : null;
}

export function requestForRails(request, host, clientIp) {
  const url = new URL(request.url);
  url.protocol = "http:";
  url.hostname = host;
  url.port = "";
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    if (name.startsWith("x-forwarded-") || name.startsWith("x-isp-diagnostic-") || name === TRACE_HEADER || STRIPPED_HEADERS.has(name)) headers.delete(name);
  }
  headers.set("Host", host);
  headers.set("X-Forwarded-Host", host);
  headers.set("X-Forwarded-Proto", "https");
  headers.set("X-Forwarded-Port", "443");
  if (clientIp) headers.set("X-Forwarded-For", clientIp);
  return new Request(new Request(url, request), { headers, redirect: "manual" });
}

export function privateResponse(response, traceId = null) {
  if (response.status >= 500) {
    void response.body?.cancel().catch(() => {});
    return unavailable(traceId);
  }
  const result = new Response(response.body, response);
  for (const name of [...result.headers.keys()]) {
    if (name.startsWith("x-isp-diagnostic-") || name === TRACE_HEADER) result.headers.delete(name);
  }
  if (validUuid(traceId)) result.headers.set(TRACE_HEADER, traceId);
  result.headers.set("Cache-Control", "no-store");
  result.headers.set("X-Content-Type-Options", "nosniff");
  return result;
}
