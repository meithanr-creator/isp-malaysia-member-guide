# Single Rails startup check

Owner instruction: keep Cloudflare and Neon, use the simplest setup, prove Rails starts first, keep all files on D and remain within the cumulative US$5 ceiling.

This temporary isp-rails-startup Worker uses the existing pinned Rails image and its normal entrypoint. Standard Wrangler manages its native Durable Object container. There is one fixed instance and one private startup request. The previous terminal lease4 remains untouched.

The first required result is Rails /up HTTP200. Only then is /app-ready called once to record Neon/database/schema readiness separately. No member, admin, upload, scanner, mail, publication or demo workflow is exercised. A startup PASS does not approve production.

The inactive configuration has public and preview ingress disabled. Credentials live only in the restricted drive-D private directory or Cloudflare secrets. A ten-minute cutoff, persistent stop latch, Durable Object alarm and separate exact-target cleanup process cover the test. The container is destroyed immediately after the result, then provider reads must confirm application absence and ingress closed. No automatic restart or second startup attempt is permitted.

Prior usage remains conservatively committed at US$2.50 pending billing evidence. This continuation reserves at most another US$1, leaving US$1.50 unallocated under the existing US$5 ceiling. This is a reservation, not an assertion of actual billed usage.

Fixed runner: script/rails-startup.mjs. Modes are prepare, deploy, run, watch and cleanup; run sends one IPv4 curl request with retry disabled and the key in a private D config. All Wrangler logs, response/status records and cleanup receipts remain on D. A failed or uncertain deployment is reconciled rather than replayed.

Astra reviewed the small Worker and focused source tests. The exact published commit/CI and the actual hosted result must be appended when observed.

## Observed routing prerequisite

The first startup transport returned HTTP404 / Cloudflare1042 before any controller object was observed. Parent and watch confirmed application absence and closed ingress. A subsequent anonymous check, with the app absent, observed1042 followed about five seconds later by the exact reviewed Worker denial response. The route was closed again. This establishes delayed route availability for that observation; it is not a Rails or Neon failure.

A continuation must preserve the earlier attempt, verify app404 and empty namespace, and wait at most60seconds for the exact anonymous denial response before one keyed startup request. Each admitted continuation has one fixed ten-minute cutoff chosen before configuration. Routing wait never restarts or extends that cutoff, and at least475seconds must remain after route readiness for Rails, the optional Neon check and cleanup. Conservative carried commitments are US$2.50, with US$1 reserved for the continuation, totalingUS$3.50 withinUS$5; actual billing is not asserted.

Neon documentation was checked: the supplied Pages/Workers examples use JavaScript drivers, while the official Rails guide uses the standard PostgreSQL connection URL. This Rails startup check retains its existing approved Neon connection and certificate verification.

## Observed result

Source8fbb8bc2942679de434773f8b808bee3e7ef274e / CI40523081050 succeeded. On27October2026 at22:43:54 Malaysia time, actual Rails /up returned200. The separate /app-ready URL returned403, so Neon readiness remains unproved and its cause unconfirmed. The Worker stopped its container; parent and independent watch confirmed application absence and closed ingress by22:44:02. Astra accepted only the Rails startup milestone. Public receipt: audit/staging-3/rails-startup-proof.json.
