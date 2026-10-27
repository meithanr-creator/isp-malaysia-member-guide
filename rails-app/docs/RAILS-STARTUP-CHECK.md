# Single Rails startup check

Owner instruction: keep Cloudflare and Neon, use the simplest setup, prove Rails starts first, keep all files on D and remain within the cumulative US$5 ceiling.

This temporary isp-rails-startup Worker uses the existing pinned Rails image and its normal entrypoint. Standard Wrangler manages its native Durable Object container. There is one fixed instance and one private startup request. The previous terminal lease4 remains untouched.

The first required result is Rails /up HTTP200. Only then is /app-ready called once to record Neon/database/schema readiness separately. No member, admin, upload, scanner, mail, publication or demo workflow is exercised. A startup PASS does not approve production.

The inactive configuration has public and preview ingress disabled. Credentials live only in the restricted drive-D private directory or Cloudflare secrets. A ten-minute cutoff, persistent stop latch, Durable Object alarm and separate exact-target cleanup process cover the test. The container is destroyed immediately after the result, then provider reads must confirm application absence and ingress closed. No automatic restart or second startup attempt is permitted.

Prior usage remains conservatively committed at US$1.50 pending billing evidence. This check reserves at most another US$1, leaving US$2.50 unallocated under the existing US$5 ceiling. This is a reservation, not an assertion of actual billed usage.

Fixed runner: script/rails-startup.mjs. Modes are prepare, deploy, run, watch and cleanup; run sends one IPv4 curl request with retry disabled and the key in a private D config. All Wrangler logs, response/status records and cleanup receipts remain on D. A failed or uncertain deployment is reconciled rather than replayed.

Astra reviewed the small Worker and focused source tests. The exact published commit/CI and the actual hosted result must be appended when observed.
