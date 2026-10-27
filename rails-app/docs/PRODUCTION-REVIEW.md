> Current authority (27 October): docs/PRODUCTION-STATUS-2026-10-27.md and audit/staging-2/acceptance-closure-ledger.json supersede the historical review below. Published5d5fa26 CI is green; fresh lease3 integration still needs final review/new exact CI and actual provider execution. Revised hosted closures remain0/63. Production NO-GO. Demo areas excluded; virtual mobile scope accepted.
# Production director review and release evidence

> Current authority: [26 October closure ledger](PRODUCTION-CLOSURE-2026-10-26.md). The first hosted rehearsal ran and is stopped; production is NO-GO. Nine initial identity cases and a bounded database restore passed. Event upload and both hosted mobile attempts failed. Offline whole-area fixes are being verified. Statements below that say the runtime has not started are historical. The owner accepted virtual mobile scope; physical-device/native-install evidence is unclaimed and is not a new owner-action gate.

Updated 26 October 2026, Asia/Kuala_Lumpur. Director: Astra (high); implementation/testing: GPT-6.1 Sol (extra high) and coordinator. Source/evidence on D:\Projects\isp-member-rails. Repository meithanr-creator/isp-malaysia-member-guide, production-readiness, draft PR1.

**Decision: the bounded application, Cloudflare package and local Rails–Neon integration source are accepted. Production release remains NO-GO pending hosted and operational evidence.** Astra's source review was read-only; actual executions below were coordinator-run/reported. Shop and Plantation Jobs stay frozen demos. No real member records, account activation or identity emails were used.


## Current director assessment — 26 October 2026

The authoritative area gates and carry-forward/retest rules are in PRODUCTION-ACCEPTANCE.md and HOSTED-ACCEPTANCE-RUNBOOK.md. Astra reviewed the saved guard source: GO for inactive deployment, conditional GO for the bounded acceptance window after exact-source tests/publication, instance identity and watchdog verification. This is not production approval. Detailed review: audit/astra-staging-guard-review.txt.

| Gate | Current evidence | Status |
| --- | --- | --- |
| P0/P1 source preparation | Exact c9a5142bd8c949c6415c3639c0113ee015f9a3f4, all six CI jobs passed in run 40268599968; application guards unchanged | Accepted within recorded scope |
| P2 Neon | Verify-full TLS, all 14 migrations, local Rails persistence and anonymous-route checks | Accepted local/service integration; hosted connection pending |
| P2 private R2 transport | Actual scoped credential; signed HEAD/PUT/GET, exact bytes, unsigned S3 authentication rejection (400 InvalidArgument, authentication error), DELETE and absence confirmed | Accepted direct transport; Rails file pipeline pending |
| P2 immutable image | Actual Cloudflare build 7df5ce3e-a847-4533-8ca0-a7bfc6d546e8 succeeded from c9a5142; digest 0187a1e32351a3f7a8f9c87a48798c0adf31f3b6c4116309c78f638582700cd2 | Accepted preparation; no container started |
| P2 deployment controls | 30 edge tests (8 browser-access, 9 staging plus 13 existing), real SDK guard bundle 78,051 bytes; 19 operations/watchdog checks passed locally | Cookie-gate source reviewed; exact new commit/CI and actual shutdown pending |
| P3 whole-area hosted acceptance | Membership/login, events, Discover, publications, consultation, platform/release checklist documented | Not run; no hosted passes claimed |
| P4 release | Identity delivery, restore/rollback, mobile/browser accessibility, operational ownership, approved real content/data and domain cutover | Open; production NO-GO |

Cloudflare API inspection confirmed zero applications named isp-member-production after image preparation. The image-only command did not deploy a Worker/application. Two first attempts stopped during unnecessary host Ruby setup; repository-root builds with explicit rails-app paths and automatic dependency installation disabled fixed the build configuration. Runtime Ruby remains 3.4.12 inside the Docker image. Failures and the successful build logs remain under audit on D.

The ISP-only bucket credential and separate account-scoped Workers/Containers/build-control credential were explicitly approved and created/corrected. Neither credential grants live-member or launch authorization. No domain/nameserver, real-member, real-administrator, outbound email or Neon paid-plan action has occurred. Cost evidence remains estimated until provider usage is available; the US$5 total ceiling and fixed 55-minute runtime window are retained.
## Earlier resource and source evidence (historical)

- Cloudflare isp-member-production is reserved and GitHub-connected with builds, workers.dev and preview URLs disabled. Default bootstrap only; Rails is not deployed there. Existing Workers Paid was already active.
- Empty private Standard R2 isp-staging-private exists in APAC, public URL/custom domain disabled. No bucket credential or app upload has been created. Application access and anonymous-denial evidence remain open.
- Neon project isp-member-staging / royal-glitter-45740959, organization org-purple-wave-74281967, Singapore, PostgreSQL18. The user completed CLI authorization. PostgreSQL-only policy matches branch production / br-floral-tree-a1hpnagn; the branch name does not make this a real-member environment.
- The user approved up to US$5 incremental Cloudflare runtime for an isolated test lasting at most one hour, then stop. That test has not started. No paid Neon upgrade was made.
- planterapp.co remains registered through GoDaddy; DNS/nameserver cutover is owner-deferred. First intended administrator/contact remains rvrameshveloo@isp.org.my; it has not been provisioned or emailed.

## Immutable package baseline

Commit **8d73ac07510db1a03b81bb9c936bc6945011b469** passed all five jobs in [push run40215975004](https://github.com/meithanr-creator/isp-malaysia-member-guide/actions/runs/40215975004):

| Check | Result | What it establishes |
| --- | --- | --- |
| SQLite application | 277 tests,2231 assertions; zero failures/errors; two PostgreSQL-only skips | Application regression scope; skips execute in the PG job. |
| PostgreSQL17 application | 277 tests,2269 assertions; zero failures/errors/skips | Includes concurrency and authorization regressions. |
| Original Linux image | Build and configured non-root user passed | Image construction, not hosted startup. |
| Cloudflare adapter | 13 tests; real configuration/SDK bundle63700bytes; advisory audit0 | Routing/config/lifecycle unit and compile evidence, not hosted edge behavior. |
| Combined scanner image | Supervisor10 tests/75 assertions; Linux build/non-root; actual clean/EICAR INSTREAM smoke passed with fresh signatures | Real scanner package/protocol detection; no Rails/DB/mail/storage credentials used. |

Autoloading, Brakeman and refreshed Ruby dependency checks passed in that baseline. The earlier 1ebd6a5 source and its checks are historical; the table above is the authoritative package baseline. Exact source/CI for the new Neon increment is recorded in PR1 and audit/neon-setup.txt; baseline results do not automatically certify later changes.

## New Neon increment: accepted bounded source and live local evidence

Scope: PostgreSQL-only neon.ts, pinned npm lock, ignored environment/context/skills, child-only dotenv loader, meaningful npm build/start/migration/verification entry points, isolated asset/schema output and Linux CA path. Production configuration guards, Rails identity and application business routes are unchanged.

Source corrections accepted by Astra: native libpq connection-string parsing; exact direct endpoint and one verify-full parameter; duplicate-TLS/query-target override rejection; nonempty repeated DNS candidates all matching the approved host; actual client TLS attributes rather than backend proxy-hop statistics; precise synthetic cleanup; dedicated preview PID.

| Execution | Observed result | Boundary |
| --- | --- | --- |
| CLI8.11.4 init/plan/deploy | Authenticated, intended org/project/branch verified; Postgres only; plan/apply no changes; three env keys pulled to ignored .env.local | Neon backend policy is applied; this is not an app-host deployment. |
| npm run build | Passed real production asset task to tmp/neon-build/assets and real Cloudflare bundle/config check | Build-only dummy-secret exception remains task-scoped. |
| Helper safety tests | Five passed | Environment isolation, literal shell text, direct targeting and TLS-parameter negatives; no live DB in unit tests. |
| Ruby PG direct probe | Two certificate-verified TLSv1.3 connections; CRUD and cross-connection persistence passed; unique probe table removed | Approved synthetic staging target only. |
| Rails migrations | Zero public tables beforehand; all14 existing migrations applied using the direct URL; schema dump isolated | No seeds, member import or real accounts. |
| Rails development HTTP | Live app4181 rendered one unique synthetic model record; independent direct connection confirmed persistence; three member routes redirected anonymously to login with no-store; exact row removed and absence confirmed | Local development integration, not hosted production/MFA/private-file acceptance. |
| Post-test availability | HTTP200, launcherPID15240 | Local preview only. |

See [NEON-SETUP.md](NEON-SETUP.md) for commands and corrected failures. Initial npm launcher and Ruby probe construction/host-comparison failures were corrected before the final passing checks. Windows build warnings remain for unavailable local libvips and Propshaft's static-font resolution; packaged fonts exist and the build exits0. No Windows upload/image-processing claim is made.

## Milestone assessment

| Milestone | Current status | Remaining exit evidence |
| --- | --- | --- |
| P0 scope/governance | Direction and bounded test allowance recorded | Named operating/support, retention and real-data responsibilities. |
| P1 source hardening | Accepted; application baseline tests pass | Actual hosted identity delivery/MFA/recovery and proxy behavior. |
| P2 infrastructure/private files/recovery | Package validated; Neon locally connected/migrated/tested; partial | Hosted Rails, ISP-only Cloudflare/R2 credentials, object denial/integrity, combined scanner-update memory, backups/restore/alerts. |
| P3 hosted staging acceptance | Not completed | Production-mode HTTP/security/mail/scanner/outage/restore evidence against pinned image and selected services, plus actual devices. |
| P4 pilot/go-live | Not completed | Pilot/support/rollback readiness, approved real data/content/finance process and domain cutover when owner is ready. |

Do not turn the local development evidence into hosted production acceptance. No extra generic launch approval is imposed: continue the existing production intent once concrete access, sender, data, operations and owner-deferred DNS dependencies are resolved. Preserve exact candidate/image provenance, report failures and reopen affected gates on changes. Never use live credentials in CI or run db:drop/db:reset/full destructive fixtures against the selected staging branch.
## Private browser access and virtual mobile direction

Owner selected virtual environments for mobile review. Dedicated Playwright 1.64.1 Chromium 156 and WebKit 27.2 packages are installed on drive D. Record the actual engine, viewport, touch profile and result for each run. A WebKit iPhone profile is browser-engine emulation, not physical iOS Safari or native home-screen acceptance; the Android Chromium profile likewise does not prove Android OS behavior.

Astra found no new source blocker in the staging-only review cookie boundary. Its form never acquires a container, requires exact-origin key submission, and issues a fixed-window signed cookie. Both browser and header paths still require the independent Worker/DO guards. Thirty source tests and the real SDK bundle passed locally. Hosted form/cookie handling remains untested until activation.

Source commit 1b78ed5a568189609f9618ae12ed69cb35960694 passed all six push CI jobs (40281704863). Its inactive Worker version d9c83fb9-b1c2-47e7-8c32-8a6e96e6a7e1 created the dedicated application a03ae965-44e9-40b6-9c10-3f8f2c659c34 with zero instances. The newer browser boundary requires its own commit, CI and inactive deployment record. No paid Rails runtime has started. Acceptance runner scripts are being completed and require a director review before execution.

Pre-window acceptance preparation: nine controlled accounts and seven registry entries were created through the Astra-reviewed fixed operator, then independently checked. The dedicated private bucket was verified empty. All mail/demo flags remain off; no real identities were provisioned. The fixed runtime window is not armed. Detailed carry-forward and remaining-hosted gates: ACCEPTANCE-EVIDENCE-MAP.md. Additional security cases and exact scanner-fixture CI are being published before activation.
