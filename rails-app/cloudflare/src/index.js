import { TRACE_HEADER, validUuid, className } from "./diagnostics.js";
import { Container, getContainer } from "@cloudflare/containers";
import { beginRequest } from "./lifetime.js";
import {
  INSTANCE_NAME, EDGE_IP_HEADER, runtimeConfiguration, unavailable,
  edgeClientIp, validClientIp, requestForRails, privateResponse
} from "./runtime.js";

export const APPLICATION_READINESS_TTL_MS = 2000;
export const APPLICATION_READINESS_TIMEOUT_MS = 5000;
export const APPLICATION_STARTUP_TIMEOUT_MS = 370000;
const HEALTH_PATHS = new Set(["/up", "/app-ready", "/ready"]);

// Cancellation affects this waiter, never a shared startup/readiness operation.
function waitForProbe(probe, signal) {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", cancel);
      resolve(value);
    };
    const cancel = () => finish(false);
    signal.addEventListener("abort", cancel, { once: true });
    probe.then(finish, () => finish(false));
    if (signal.aborted) cancel();
  });
}

export class RailsContainer extends Container {
  activeRequests = 0;
  defaultPort = 3000;
  requiredPorts = [3000];
  sleepAfter = "60s";
  enableInternet = true;

  lifecycleGeneration = 0;
  portReady = false;
  startup = null;
  applicationReadiness = null;
  applicationReadyUntil = 0;
  applicationReadinessGeneration = 0;

  invalidateApplicationReadiness() {
    this.applicationReadinessGeneration += 1;
    this.applicationReadyUntil = 0;
    const pending = this.applicationReadiness;
    this.applicationReadiness = null;
    pending?.controller.abort();
  }

  invalidateLifecycle() {
    this.lifecycleGeneration += 1;
    this.portReady = false;
    const pending = this.startup;
    this.startup = null;
    pending?.controller.abort();
    this.invalidateApplicationReadiness();
  }

  async railsPort(requestSignal) {
    if (this.portReady && !this.ctx.container.running) this.invalidateLifecycle();

    if (!this.portReady) {
      if (!this.startup) {
        this.invalidateApplicationReadiness();
        const entry = {
          generation: this.lifecycleGeneration,
          controller: new AbortController(),
          signal: null,
          promise: null
        };
        entry.signal = AbortSignal.any([
          entry.controller.signal,
          AbortSignal.timeout(APPLICATION_STARTUP_TIMEOUT_MS)
        ]);
        this.startup = entry;
        entry.promise = (async () => {
          try {
            await this.startAndWaitForPorts({
              ports: [3000],
              cancellationOptions: {
                abort: entry.signal,
                instanceGetTimeoutMS: 10000,
                portReadyTimeoutMS: 360000
              }
            });
            if (this.startup !== entry ||
                this.lifecycleGeneration !== entry.generation ||
                entry.signal.aborted || !this.ctx.container.running) return false;
            this.portReady = true;
            return true;
          } catch {
            // A superseded operation cannot tear down a newer lifecycle.
            if (this.startup === entry &&
                this.lifecycleGeneration === entry.generation) {
              this.invalidateLifecycle();
            }
            return false;
          } finally {
            if (this.startup === entry &&
                this.lifecycleGeneration === entry.generation) {
              this.startup = null;
            }
          }
        })();
      }

      const pending = this.startup;
      if (!pending || !await waitForProbe(pending.promise, requestSignal)) return null;
      if (this.lifecycleGeneration !== pending.generation ||
          !this.portReady || !this.ctx.container.running) return null;
    }

    return this.ctx.container.getTcpPort(3000);
  }

  async applicationReady(port, settings, requestSignal) {
    if (requestSignal.aborted) return false;
    if (this.applicationReadyUntil > Date.now()) return true;

    if (!this.applicationReadiness) {
      const generation = this.applicationReadinessGeneration;
      const entry = { controller: new AbortController(), promise: null };
      this.applicationReadiness = entry;
      entry.promise = (async () => {
        try {
          const health = requestForRails(
            new Request(`https://${settings.host}/app-ready`),
            settings.host, null
          );
          const response = await port.fetch(new Request(health, {
            signal: AbortSignal.any([
              entry.controller.signal,
              AbortSignal.timeout(APPLICATION_READINESS_TIMEOUT_MS)
            ])
          }));
          const ready = response.status === 200;
          await response.body?.cancel();
          if (generation !== this.applicationReadinessGeneration) return false;
          if (!ready) {
            this.invalidateApplicationReadiness();
            return false;
          }
          this.applicationReadyUntil = Date.now() + APPLICATION_READINESS_TTL_MS;
          return true;
        } catch {
          if (generation === this.applicationReadinessGeneration) {
            this.invalidateApplicationReadiness();
          }
          return false;
        } finally {
          if (this.applicationReadiness === entry) this.applicationReadiness = null;
        }
      })();
    }

    return waitForProbe(this.applicationReadiness.promise, requestSignal);
  }

  async recordDiagnostic(_trace, _options) { return true; }
  isDiagnosticLeaseExpired() { return false; }
  async diagnosticEvent(trace, changes, {required = false, admit = false} = {}) {
    Object.assign(trace, changes);
    trace.updated_at = Date.now(); trace.revision += 1;
    let recorded = false;
    try { recorded = await this.recordDiagnostic({...trace}, {admit}); } catch {}
    if (required && recorded !== true) throw Error("Diagnostic persistence unavailable");
  }
  async fetch(request) {
    const now = Date.now();
    const trace = {id: validUuid(request.headers.get(TRACE_HEADER)) ? request.headers.get(TRACE_HEADER) : crypto.randomUUID(),
      revision: 0, started_at: now, updated_at: now, stage: "startup", outcome: "pending",
      dispatched: false, response_received: false, status: null, operation_id: null, exception_class: null};
    let admitted = false, backendStarted = false;
    const settings = runtimeConfiguration(this.env);
    const clientIp = request.headers.get(EDGE_IP_HEADER);
    if (!settings || !validClientIp(clientIp)) return unavailable(trace.id);

    const lifetime = beginRequest(this, request.signal);
    let requestGeneration = this.lifecycleGeneration;
    try {
      const url = new URL(request.url);
      if (url.hostname !== settings.host) {
        lifetime.release();
        return unavailable(trace.id);
      }
      await this.diagnosticEvent(trace, {}, {required: true, admit: true});
      admitted = true;
      this.envVars = settings.containerEnv;
      const port = await this.railsPort(lifetime.signal);
      if (!port) {
        await this.diagnosticEvent(trace, {stage: this.isDiagnosticLeaseExpired() ? 'lease' : 'startup', outcome: 'failed'});
        lifetime.release();
        return unavailable(trace.id);
      }
      requestGeneration = this.lifecycleGeneration;
      this.renewActivityTimeout();

      if (!HEALTH_PATHS.has(url.pathname)) await this.diagnosticEvent(trace, {stage: 'application_readiness'});
      if (!HEALTH_PATHS.has(url.pathname) &&
          !await this.applicationReady(port, settings, lifetime.signal)) {
        await this.diagnosticEvent(trace, {stage: this.isDiagnosticLeaseExpired() ? 'lease' : 'application_readiness', outcome: 'failed'});
        lifetime.release();
        return unavailable(trace.id);
      }

      if (requestGeneration !== this.lifecycleGeneration || !this.portReady) {
        lifetime.release();
        return unavailable(trace.id);
      }

      // Forward once. Authorization, upload scans and download checks remain
      // authoritative for every operation and are never cached here.
      const forwarded = new Request(
        requestForRails(request, settings.host, clientIp),
        { signal: lifetime.signal }
      );
      forwarded.headers.set(TRACE_HEADER, trace.id);
      // Durable dispatch intent precedes send; it does not prove Rails received it.
      await this.diagnosticEvent(trace, {stage: "backend_http", outcome: "pending", dispatched: true}, {required: true});
      if (lifetime.signal.aborted || requestGeneration !== this.lifecycleGeneration) throw Error('Request lifetime ended');
      backendStarted = true;
      const response = await port.fetch(forwarded);
      const correlated = response.headers.get(TRACE_HEADER) === trace.id;
      await this.diagnosticEvent(trace, {stage: "backend_http", outcome: "response", response_received: true,
        status: response.status,
        operation_id: correlated && validUuid(response.headers.get("x-isp-diagnostic-operation")) ? response.headers.get("x-isp-diagnostic-operation") : null,
        exception_class: correlated ? className(response.headers.get("x-isp-diagnostic-exception")) : null});
      if (response.status >= 500) {
        if (requestGeneration === this.lifecycleGeneration && !lifetime.signal.aborted) this.invalidateApplicationReadiness();
        void response.body?.cancel().catch(() => {});
        lifetime.release();
        return unavailable(trace.id);
      }
      return lifetime.wrap(privateResponse(response, trace.id));
    } catch (error) {
      if (admitted) await this.diagnosticEvent(trace, {stage: this.isDiagnosticLeaseExpired() ? "lease" : (trace.dispatched ? "transport" : trace.stage),
        outcome: "failed", exception_class: className(error?.constructor?.name)});
      if (admitted && (backendStarted || trace.stage === "startup") && requestGeneration === this.lifecycleGeneration && !lifetime.signal.aborted) this.invalidateLifecycle();
      lifetime.release();
      return unavailable(trace.id);
    }
  }

  onStart() {
    // The SDK supplies no startup-attempt identifier to this callback.
    // Only railsPort's guarded completion may populate portReady.
    // A current startup already cleared application readiness before starting.
    if (!this.startup) this.invalidateApplicationReadiness();
  }
  onStop() { this.invalidateLifecycle(); }
  onError() { this.invalidateLifecycle(); }

  async onActivityExpired() {
    if (this.activeRequests > 0) {
      this.renewActivityTimeout();
      return;
    }
    this.invalidateLifecycle();
    if (this.ctx.container.running) await this.stop();
  }
}

export async function fetchWithTrace(request, env, trustedTrace = null) {
  const settings = runtimeConfiguration(env);
  if (!settings) return unavailable();
  let traceId = null;
  try {
    const url = new URL(request.url), clientIp = edgeClientIp(request);
    if (url.protocol !== "https:" || url.hostname !== settings.host ||
        url.port || !clientIp || request.headers.has("upgrade")) return unavailable();
    traceId = validUuid(trustedTrace) ? trustedTrace : crypto.randomUUID();
    const forwarded = requestForRails(request, settings.host, null);
    forwarded.headers.set(EDGE_IP_HEADER, clientIp);
    forwarded.headers.set(TRACE_HEADER, traceId);
    return privateResponse(await getContainer(env.RAILS_CONTAINER, INSTANCE_NAME).fetch(forwarded), traceId);
  } catch {
    return unavailable(traceId);
  }
}
export default {fetch: (request, env) => fetchWithTrace(request, env)};
