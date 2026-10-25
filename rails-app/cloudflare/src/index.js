import { Container, getContainer } from "@cloudflare/containers";
import { beginRequest } from "./lifetime.js";
import {
  INSTANCE_NAME, EDGE_IP_HEADER, runtimeConfiguration, unavailable,
  edgeClientIp, validClientIp, requestForRails, privateResponse
} from "./runtime.js";

export class RailsContainer extends Container {
  activeRequests = 0;
  defaultPort = 3000;
  requiredPorts = [3000];
  sleepAfter = "60s";
  // PostgreSQL, private S3 and approved SMTP need TLS internet egress. clamd
  // remains loopback-only inside the image; never expose its port.
  enableInternet = true;

  async fetch(request) {
    const settings = runtimeConfiguration(this.env);
    const clientIp = request.headers.get(EDGE_IP_HEADER);
    if (!settings || !validClientIp(clientIp)) return unavailable();
    const lifetime = beginRequest(this, request.signal);
    try {
      if (new URL(request.url).hostname !== settings.host) { lifetime.release(); return unavailable(); }
      this.envVars = settings.containerEnv;
      await this.startAndWaitForPorts({
        ports: [3000],
        cancellationOptions: { abort: lifetime.signal, instanceGetTimeoutMS: 10000, portReadyTimeoutMS: 360000 }
      });
      this.renewActivityTimeout();
      const port = this.ctx.container.getTcpPort(3000);
      const health = requestForRails(new Request(`https://${settings.host}/ready`), settings.host, null);
      const readiness = await port.fetch(new Request(health, { signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(45000)]) }));
      const ready = readiness.status === 200;
      await readiness.body?.cancel();
      if (!ready) { lifetime.release(); return unavailable(); }
      // Forward each application request once. No mutation replay, migration,
      // seed, account creation or mail-dispatch task runs in this gateway.
      const forwarded = new Request(requestForRails(request, settings.host, clientIp), { signal: lifetime.signal });
      const response = await port.fetch(forwarded);
      if (response.status >= 500) {
        void response.body?.cancel().catch(() => {});
        lifetime.release();
        return unavailable();
      }
      return lifetime.wrap(privateResponse(response));
    } catch {
      lifetime.release();
      return unavailable();
    }
  }

  // Avoid the SDK's default error logging and detailed proxy-error responses.
  onError() {}
  onStart() {}
  onStop() {}
  async onActivityExpired() {
    if (this.activeRequests > 0) { this.renewActivityTimeout(); return; }
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
      if (url.protocol !== "https:" || url.hostname !== settings.host || url.port || !clientIp || request.headers.has("upgrade")) return unavailable();
      const forwarded = requestForRails(request, settings.host, null);
      // This metadata exists only on the private Worker -> Durable Object hop.
      // The public input header is stripped before the platform IP is written.
      forwarded.headers.set(EDGE_IP_HEADER, clientIp);
      return privateResponse(await getContainer(env.RAILS_CONTAINER, INSTANCE_NAME).fetch(forwarded));
    } catch {
      return unavailable();
    }
  }
};
