# Production milestone status — 27 October 2026 MYT

Production remains NO-GO. The reviewed application image is now verified in Cloudflare's registry; the application remains off. All project, tooling, private configuration and evidence are on drive D. Shop and Plantation Jobs remain frozen DEMO references, excluded from production acceptance. Academy and Forum remain removed.

| Milestone | Current disposition | Evidence and work still required |
| --- | --- | --- |
| P0 Scope and guardrails | Maintained | Rails framework; cumulative incremental test ceiling US$5; no paid upgrade, real-member import, real administrator provisioning, outgoing identity emails, domain changes or public production launch. The original runtime lease is expired and is never reset. |
| P1 Application source and CI | Closed for reviewed source; new browser-harness delta awaits its own CI/review | Application/image source80d32fddf88251a6608ba047a577ce16efe8c834. Latest published tooling0145fe605d7d5455de574f25cd0f7b754c8d64f9 passed all seven required CI jobs: PostgreSQL303 tests/2573 assertions/zero failures, errors or skips;42 release-boundary tests;56 edge tests; actual image/scanner and isolated Linux cookie checks. New local browser harness has15 passing pure regression tests; it has not passed hosted acceptance. |
| P2 Hosting and recovery | Open; immutable-image and inactive-config subgates closed | Actual registry transfer succeeded17:33:36UTC26October, digest152480…d2a confirmed by tag HEAD, manifest hash/config identity and remote validation. Postflight: zero applications, ingress closed, build/deploy commands inert, temporary registry credentials cleaned. Astra reviewed the generated inactive config. Fresh provider application/namespace/rollback identities, database-plus-file/application recovery, production isolation, monitoring and operating-cost evidence remain required. |
| P3 Hosted acceptance and mobile | Open | Revised image has not completed the63-case/15-batch hosted inventory. Earlier first event upload POST503 remains unexplained. Full Android/iOS virtual journeys, member/admin flows, protected publication files, upload integrity across Events/Discover/Publications, PWA/offline privacy, latency and recovery remain open. WSL is now usable;198 browser/vendor ELF dependencies and39 dynamic-library probes pass on D. Actual local iPhone engine/touch/render/screenshot smoke and observed process shutdown pass. Full hosted/mobile acceptance remains open. |
| P4 Controlled production launch | Open | Official sender and invitation/recovery delivery; approved first administrator, membership list and final content; support/retention ownership and ongoing hosting budget; owner-ready planterapp.co domain/TLS cutover; Astra final production decision. Virtual devices are accepted; no physical-device/native-install claim. |

## Completed image transfer and inactive preparation

Cloudflare image initializer attempts ffdfd45a-6226-4964-b628-11e6b3e1a191 and29a219e3-07ec-4b62-9361-620afd20f741 stalled before running and were cancelled. Their failure evidence is retained, including audit/staging-2/image-build-cloudflare-attempt2.json. No third initializer retry occurred.

GitHub run40351242941/job121671738041 exported the same scanner-tested image from application source80d32fddf88251a6608ba047a577ce16efe8c834, using workflow73add85e87235caccb8661208b8fe28a5cdd0a2c. The actual443316473-byte artifact12664935022, four members, gzip/raw TAR, source/configuration, unprivileged linux/amd64 image and complete layers were verified on D. The immutable registry image is:

`registry.cloudflare.com/a9720867333b64a4f8ee70cdfd673eb9/isp-member-rails@sha256:152480a896060eae82a380dc54f651e199ff1585cd5dd805d0d51b9f3a587d2a`

The owner approved one hour of equivalent deployment-key renewal for image upload only. The original expired token could not be reactivated in the UI. The owner created and privately captured an equivalent replacement, same four permissions and selected account, actual period26October17:30–18:30UTC (27October01:30–02:30MYT). A fixed private17-field authorization plan bound that human grant to the artifact, image, helper SHA and cumulativeUS$5 ceiling. The single upload completed at17:33:36.449UTC. See audit/staging-2/image-build.json. No Worker/app provisioning or runtime was authorized or performed with that key.

Offline inactive preparation created a fresh review key while retaining the existing staging encryption keys. It created no runtime.json and set no runtime dates. Generated config SHA256:

`a18c41e5f95949823ddab603215f6f681547409c453f24cef827df97a8229232`

Astra reviewed the actual config: verified image; RailsStaging2 binding/container; retained v1 migration plus new SQLite v2 class; routes empty; workers_dev/preview disabled; activation false; blank start/expiry; mail/demo false; verify-full; maximum one standard-2 instance. Review is source/configuration approval, not deployment or production approval.

## Local virtual-browser preparation

The owner approved the narrowly scoped administrator helper that starts the existing Microsoft WslService. It succeeded and Ubuntu24.04 now runs. No service repair/reinstallation, global package installation, linker-cache update, firewall/network change or other project/distribution change was made.

Pinned Linux Node24.21.0 and Playwright1.64.1 WebKit2370 were placed on D. Missing libraries were resolved as a complete56-package Ubuntu closure,31592996 archive bytes, each checked against SHA256 from the existing trusted Ubuntu index. All new files and caches remain on D; HOME is preserved. The complete198-ELF dependency verification and39 actual dynamic-load probes pass. The original missing private libproxy backend path was corrected for the whole environment; its failed receipt is retained.

The official WebKit wrapper overwrites LD_LIBRARY_PATH, so the local server uses the same pinned WPE MiniBrowser executable directly with the wrapper's exact WEBKIT_* variables and the verified D-only library/data/TLS-backend paths. It binds only127.0.0.1 with a random private WebSocket path. The Windows controller uses a fixed private UUID descriptor, bounded setup/cleanup, and an external process timeout. Server/browser termination must be observed before accepting an engine result.

The first two actual local attempts connected, created the iPhone context and rendered the document, then failed the smoke's navigator.maxTouchPoints assumption. The failed attempts are preserved. The corrected smoke requires a real trusted single-touch event delivered by tap; the capability property is retained only as diagnostic evidence. Failure diagnostics remain private. The first attempt's server and browser processes were verified absent after cleanup. Corrected run54434ee5-3a31-4252-a99c-6fa8f4bcf224 passed at18:36:36UTC26October: WebKit27.2/revision2370, iPhone13, actual trusted single touch event,390px viewport, rendered screenshot, controller exit0 and observed server/MiniBrowser absence plus WSL child exit0. The240-second external timeout did not trigger. See audit/staging-2/linux-webkit-engine.json. Astra closed only the local engine-preparation subgate and approved publication. Subsequent observation-only hardening adds Python isolation/no-bytecode and tolerant command-line decoding; no engine configuration changed. The successful execution receipt remains the pre-hardening execution evidence.

The full mobile runner now explicitly tests touch input, bounds setup/evaluation/cleanup, records failure stages, and marks PASS only after cleanup. Its offline privacy case starts from a fresh blank document in the same service-worker context and admits exactly one deliberately armed main-frame GET failure at the fixed dashboard URL. Additional/unrelated failures, timeouts, cancellations, closure and page errors remain fatal. This prevents an intended offline denial from falsely failing the journey without hiding other failures. Fifteen pure browser boundary/classifier tests and all57 release-tool tests pass, with zero failures or skips; actual hosted proof remains required.

## Next gates in order

1. Completed: local engine/touch/render/screenshot and observed server/browser termination; Astra publication GO. Failure paths still require actual termination observation; a FAIL report is not shutdown proof.
2. Publish the reviewed browser-tooling delta and obtain exact-commit CI. Application image provenance and newer test-harness provenance remain separate; unchanged application bytes need no rebuild.
3. Prepare the actual fresh inactive provider resources/rollback packet, runtime-scoped access and external watchdog. Record a separate fixed runtime period and cleanup deadline within the remaining cumulativeUS$5; never reset the old lease. The image-only key cannot authorize this next stage.
4. Execute and reconcile the full hosted functional inventory and both virtual-mobile journeys; collect diagnostics for the earlier503 path; exercise database/file recovery, operations and latency. Stop and verify compute removal at the fixed deadline. Never replay an uncertain mutation blindly.
5. Close P2/P3 only on passing actual evidence, then resolve P4 owner dependencies and obtain Astra's final release decision before real users, outgoing identity email, domain cutover or public production.

GitHub review: https://github.com/meithanr-creator/isp-malaysia-member-guide/pull/1 . Last published CI: https://github.com/meithanr-creator/isp-malaysia-member-guide/actions/runs/40360092079 . Actual provider billing is unavailable; cost reservations are estimates, not invoices. No ongoing hosting purchase is authorized by theUS$5 test allowance.
