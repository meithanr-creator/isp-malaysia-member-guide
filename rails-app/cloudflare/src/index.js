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

  async fetch(request) {
    const settings = runtimeConfiguration(this.env);
    const clientIp = request.headers.get(EDGE_IP_HEADER);
    if (!settings || !validClientIp(clientIp)) return unavailable();

    const lifetime = beginRequest(this, request.signal);
    let requestGeneration = this.lifecycleGeneration;
    try {
      const url = new URL(request.url);
      if (url.hostname !== settings.host) {
        lifetime.release();
        return unavailable();
      }
      this.envVars = settings.containerEnv;
      const port = await this.railsPort(lifetime.signal);
      if (!port) {
        lifetime.release();
        return unavailable();
      }
      requestGeneration = this.lifecycleGeneration;
      this.renewActivityTimeout();

      if (!HEALTH_PATHS.has(url.pathname) &&
          !await this.applicationReady(port, settings, lifetime.signal)) {
        lifetime.release();
        return unavailable();
      }

      if (requestGeneration !== this.lifecycleGeneration || !this.portReady) {
        lifetime.release();
        return unavailable();
      }

      // Forward once. Authorization, upload scans and download checks remain
      // authoritative for every operation and are never cached here.
      const forwarded = new Request(
        requestForRails(request, settings.host, clientIp),
        { signal: lifetime.signal }
      );
      const response = await port.fetch(forwarded);
      if (response.status >= 500) {
        if (requestGeneration === this.lifecycleGeneration && !lifetime.signal.aborted) this.invalidateApplicationReadiness();
        void response.body?.cancel().catch(() => {});
        lifetime.release();
        return unavailable();
      }
      return lifetime.wrap(privateResponse(response));
    } catch {
      if (requestGeneration === this.lifecycleGeneration && !lifetime.signal.aborted) this.invalidateLifecycle();
      lifetime.release();
      return unavailable();
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

export default {
  async fetch(request, env) {
    const settings = runtimeConfiguration(env);
    if (!settings) return unavailable();
    try {
      const url = new URL(request.url);
      const clientIp = edgeClientIp(request);
      if (url.protocol !== "https:" || url.hostname !== settings.host ||
          url.port || !clientIp || request.headers.has("upgrade")) return unavailable();
      const forwarded = requestForRails(request, settings.host, null);
      forwarded.headers.set(EDGE_IP_HEADER, clientIp);
      return privateResponse(await getContainer(env.RAILS_CONTAINER, INSTANCE_NAME).fetch(forwarded));
    } catch {
      return unavailable();
    }
  }
};
