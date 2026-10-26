# Director evidence map — 26 October 2026

> Current authority: [26 October closure ledger](PRODUCTION-CLOSURE-2026-10-26.md). The first hosted rehearsal ran and is stopped; production is NO-GO. Nine initial identity cases and a bounded database restore passed. Event upload and both hosted mobile attempts failed. Offline whole-area fixes are being verified. Statements below that say the runtime has not started are historical. The owner accepted virtual mobile scope; physical-device/native-install evidence is unclaimed and is not a new owner-action gate.

Astra high directs; Sol 6.1 extra high executes; coordinator verifies deployments and source publication. This map separates verified source behavior, actual hosted integration, and owner-dependent release conditions. Never relabel source/CI as hosted PASS. Carry evidence forward when its source and dependency boundary are unchanged; reopen the affected area after relevant changes.

Runtime application/image source c9a5142bd8c949c6415c3639c0113ee015f9a3f4 passed all six CI jobs in40268599968. The immutable registry digest is0187a1e32351a3f7a8f9c87a48798c0adf31f3b6c4116309c78f638582700cd2. Worker browser-control source3d893feaa921166eff9f99196f2297f5259680f8 passed six jobs in40288777006. Execution tools require their own final commit and checks. Record the actual active Worker version separately.

## Source behavior carried forward

| Behavior | Existing source evidence | Required shared hosted path |
| --- | --- | --- |
| Session idle/absolute expiry and revocation | test/models/user_session_test.rb; test/integration/authentication_lifecycle_test.rb | Real login/logout, server session persistence, copied-cookie denial |
| Activation/reset purpose, expiry, replay and supersession | test/models/account_lifecycle_test.rb; test/integration/account_recovery_test.rb | Delivered identity links remain owner/provider dependent |
| Eligibility suspension and re-eligibility | importer and authentication lifecycle tests | Exact approved registry and real member denial/acceptance |
| CSV collisions, stale preview and expiry | test/services/membership_registry_importer_test.rb; test/integration/membership_import_journey_test.rb | Real preview/confirm, cross-admin denial and preserved references |
| MFA throttle permutations | test/integration/administrator_mfa_test.rb | Actual enrollment, replay/recovery/cancel, natural step-up and shared login counters |
| Event validation, timezone and payment permutations | test/models/event_test.rb; test/services/event_draft_updater_test.rb | Actual paid-bank draft/preview/publish then free republication |
| Roster pagination permutations | test/integration/admin_event_interests_test.rb | Actual scoped roster and authorization/invalid-page checks |

## Hosted and operational gates

The reviewed driver exercises identity, events, publications, Discover, consultation, three form-family CSRF denials, real scanner-derived rejection and replacement-key invalidation. Every content batch is followed by exact ownership capture, independent database status and reconciliation. Fresh observations and their hashes are retained per batch. A failure halts mutations; no automatic replay is permitted.

Natural administrator aging waits605seconds after capturing a valid editor, without altering database timestamps. The first post-idle readiness GET has a bounded120second startup allowance. Ordinary requests are20seconds, uploads45seconds, concurrency2, total driver cap350. The global fixed55minute window and10minute cleanup reserve remain unchanged.

Actual cold start, resource envelope, persistent data after restart, private-file restoration, isolated database restore, rollback/disable, exact cleanup, zero-instance shutdown and bounded cost evidence remain operational gates. Scanner outage/staleness/integrity logic is covered by source tests; unobserved deployed failure/recovery must remain explicit.

Owner-dependent release items: actual account-email sender/delivery, lost-MFA operating ownership, approved real content/member list, ongoing production hosting allowance and domain cutover. Disabled mail and constructed verified accounts do not close delivered identity workflows.

Owner selected virtual mobile environments. Actual WebKit/Chromium versions and iPhone/Android profiles cover the agreed browser scope. Physical phones and native home-screen installation are outside scope and unclaimed. Shop/Jobs remain frozen DEMO references; Academy/Forum are excluded. No demo development or production testing is authorized.
