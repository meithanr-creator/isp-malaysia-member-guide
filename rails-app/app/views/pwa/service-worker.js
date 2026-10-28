// Network-only by design: never cache membership pages, tokens, PDFs or API data.
// Installation supplies a home-screen app, not offline access to member records.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
