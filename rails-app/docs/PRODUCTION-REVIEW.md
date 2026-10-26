# Production director review and release evidence

Updated 26 October 2026, Asia/Kuala_Lumpur. Director: Astra (high); implementation/testing: GPT-6.1 Sol (extra high) and coordinator. Source/evidence on D:\Projects\isp-member-rails. Repository meithanr-creator/isp-malaysia-member-guide, production-readiness, draft PR1.

**Decision: the bounded application, Cloudflare package and local Rails–Neon integration source are accepted. Production release remains NO-GO pending hosted and operational evidence.** Astra's source review was read-only; actual executions below were coordinator-run/reported. Shop and Plantation Jobs stay frozen demos. No real member records, account activation or identity emails were used.

## Current resources and authorizations

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