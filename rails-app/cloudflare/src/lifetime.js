export const REQUEST_LIFETIME_MS = 10 * 60 * 1000;

// Covers startup, upload, readiness and the complete response stream. A client
// that never drains/cancels a PDF cannot hold a billed instance indefinitely.
export function beginRequest(owner, requestSignal) {
  owner.activeRequests += 1;
  const abort = new AbortController();
  let released = false;
  let reader;
  let streamController;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(timer);
    requestSignal.removeEventListener("abort", cancel);
    owner.activeRequests = Math.max(0, owner.activeRequests - 1);
    owner.renewActivityTimeout();
  };
  const cancel = () => {
    abort.abort();
    try { streamController?.error(new Error("Service response cancelled.")); } catch {}
    if (reader) void reader.cancel().catch(() => {});
    release();
  };
  const timer = setTimeout(cancel, REQUEST_LIFETIME_MS);
  requestSignal.addEventListener("abort", cancel, { once: true });
  if (requestSignal.aborted) cancel();
  return {
    signal: abort.signal,
    release,
    wrap(response) {
      if (released) {
        void response.body?.cancel().catch(() => {});
        throw new Error("Service response cancelled.");
      }
      if (!response.body) { release(); return response; }
      reader = response.body.getReader();
      const body = new ReadableStream({
        start(controller) { streamController = controller; },
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (released) return;
            if (chunk.done) { controller.close(); release(); }
            else controller.enqueue(chunk.value);
          } catch {
            controller.error(new Error("Service response unavailable."));
            release();
          }
        },
        cancel() { cancel(); }
      });
      return new Response(body, response);
    }
  };
}
