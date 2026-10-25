# Production director review and release evidence

Updated: 26 October 2026 (Asia/Kuala_Lumpur). Reviewer: Astra. Project: `D:\Projects\isp-member-rails`. Companion plan: `docs/PRODUCTION-PLAN.md`.

**Decision: application source accepted at 1ebd6a5b3a6fba7da72141f8934f713963b761ac; operational release remains NO-GO.** Cloudflare is selected by the owner. The application baseline passes Linux SQLite, PostgreSQL and container-build CI. The Cloudflare Worker adapter and combined Rails/ClamAV packaging now being prepared are new, unreviewed work and are not covered by that acceptance. No hosted Rails runtime or external PostgreSQL database exists yet. Shop and Plantation Jobs remain frozen demos.

## Current owner decisions and infrastructure state

The owner selected an administrator-uploaded membership list as the authority, native Rails invitations/recovery/TOTP, and `rvrameshveloo@isp.org.my` as the intended first administrator/company and invitation/recovery contact. A registry row supplies eligibility; verified invitation redemption establishes control of that account email. No real account has been provisioned. Mailbox verification, real-data handling, operator recovery ownership and sender setup remain open.

The owner purchased **planterapp.co through GoDaddy**, selected **Cloudflare**, and instructed the team to create the ISP project. There is no existing ISP server. The earlier VPS/Hostinger proposal is retained only as a superseded cost comparison, not the current implementation direction or an outstanding hosting choice. The account already has Workers Paid; this work did not purchase that plan. Existing paid-plan status does not establish a budget for additional container/database/runtime usage.

| Resource | Current state | What it establishes |
| --- | --- | --- |
| Cloudflare Worker project | `isp-member-production`, connected to the ISP GitHub repository and `production-readiness`; automatic builds and production/preview URLs disabled; no custom domain or cron | Saved project/source connection only. The initial default Worker is not the Rails application. |
| Private staging storage | Empty Standard R2 bucket `isp-staging-private`, APAC; no public URL, custom domain, credentials or uploads | A reserved private staging bucket. Application access, anonymous denial and object integrity are not yet exercised. |
| Runtime and data | No Rails container runtime, external PostgreSQL, runtime credentials/secrets or mail integration created | No hosted member service or operational rehearsal yet. |
| Domain | GoDaddy registration remains; nameserver/DNS change deferred by owner | No planterapp.co cutover, TLS/host mapping or public launch. |

Project details are recorded in [CLOUDFLARE-PROJECT.md](CLOUDFLARE-PROJECT.md). Current bucket state is coordinator-reported from this preparation turn. The separate Cloudflare Pages demonstration remains unchanged; its successful preview builds do not deploy Rails. The authorizations above cover the completed preparation actions. Resolve only the concrete remaining runtime spend, credential destination/permission, database, sender and operational decisions before dependent actions; do not request a duplicate generic hosting selection or launch approval.

## Accepted source and exact CI evidence

Accepted application source: **1ebd6a5b3a6fba7da72141f8934f713963b761ac**, `production-readiness`, [PR #1](https://github.com/meithanr-creator/isp-malaysia-member-guide/pull/1). Authoritative push run: [40210298196](https://github.com/meithanr-creator/isp-malaysia-member-guide/actions/runs/40210298196). The director independently checked the exact PR head and completed check statuses; result counts are recorded in `audit/cloudflare-project-ci.txt` and the coordinator's CI evidence.

| Check | Exact result | Boundary |
| --- | --- | --- |
| Linux SQLite | 277 tests / 2,231 assertions; zero failures/errors; two PostgreSQL-only skips; seed 35658 | Both intentional skips execute in the PostgreSQL job. |
| Linux PostgreSQL 17 | 277 tests / 2,269 assertions; zero failures/errors/skips; seed 16921 | Includes concurrent Discover setup and event-interest requests. |
| Rails autoloading | Passed | Source loading, not hosted boot. |
| Brakeman and refreshed dependency advisory checks | Passed; no warnings/vulnerabilities reported | Static/advisory evidence at the checked revision, not proof of runtime security. |
| Linux container | Image build and configured non-root user check passed | Does not establish hosted boot, readiness, scanner integration or the new Cloudflare packaging. |

The matching [PR run 40210301982](https://github.com/meithanr-creator/isp-malaysia-member-guide/actions/runs/40210301982) also reports successful SQLite, PostgreSQL and container checks at that head. The current application baseline's CI is complete, not pending. New adapter/packaging changes require their own exact source revision, review and tests before acceptance.

Historical local full-suite evidence is `audit/production-full-tests.txt`: 277 tests / 2,230 assertions, zero failures/errors, two PostgreSQL-only skips, seed 61808. Earlier candidate 6873ab7 also passed CI, but a later randomized PostgreSQL run exposed leftover synthetic login counters. The accepted correction cleans only each nontransactional fixture's account/two IP digest scopes after workers join; the unit test scopes assertions to its own counters and verifies an unrelated unexpired counter survives. Earlier synthetic audit cleanup deletes only the test actor's audits before that actor. Production throttle limits, atomic counters and audit foreign keys were not relaxed. These current results supersede the failed fixture run and earlier pending statements; focused counts must not be summed.

## Application source findings closed

Independent source inspection covered account/session eligibility, MFA/challenges/tokens, import and locking, outbox leases, protected file access, upload scanning, publication transitions, CSP and the network-only service worker. No unresolved blocking defect remains in that bounded application source review. No director test process was run against the shared test database.

| Area | Accepted implementation and correction | Remaining hosted/operational evidence |
| --- | --- | --- |
| Sessions and identity | Server-side digest sessions, revocation, credential fingerprints, shared throttles, pending accounts, current eligibility and single-use activation/recovery | Actual proxy/client-IP behavior, received links, approved session policy and operations. |
| Membership import | Bounded CSV, protected exact preview, atomic confirmation, collision checks, audit and ineligibility suspension; import neither activates nor emails | Approved real-data/retention policy; observed preview-expiration schedule. |
| Administrator MFA/recovery | Password plus MFA; encrypted setup, replay refusal, hashed one-use recovery codes. Host-only audited lost-factor reset revokes credentials/sessions/challenges/tokens and returns to pending reactivation/enrollment | Named independent identity-verification process and recovery rehearsal; no email-only MFA bypass. |
| Sensitive edits and audit | Ten-minute MFA checks before mutations/uploads; actor/current session locked inside AdministrativeAction; transactional actor/target/action/revision/time/outcome audit | Policy acceptance and actual hosted verification/audit behavior. |
| Editor conflicts | Event/publication rejected forms retain the submitted edit token; successful draft saves refresh it before preview, allowing incomplete previews to be corrected without permitting stale overwrite | Recheck on the hosted candidate; source regressions pass. |
| Discover | Explicit missing-position setup preserves existing cards; fresh MFA/audit; safe retained URLs and edit versions | Approved live content and hosted setup verification. |
| Uploads and files | Excessive image totals rejected before scanning; bounded fail-closed ClamAV/provenance; stored-byte hash checks; attachment/revision/ownership controls | Actual supported scanner, signatures, safe detection fixture, outage/timeout, private R2 denial/integrity and image handling. |
| Recovery outbox | Owned delivery leases; expired filtering; cleanup excludes already scrubbed secrets | Approved provider, monitored dispatcher, failure/restart and received-mail drill. |
| Interests and mobile privacy | Scoped read-only admin roster, bounded pagination and no-store responses; immutable interest snapshots; strict CSP; no private offline service-worker cache | Hosted concurrency/proxy tests and physical-device/accessibility acceptance. |

Coordinator browser checks found no console errors in the examined home/menu/login and admin membership/Discover/roster/publication paths, and no overflow/offscreen inputs at 320/390 px (`audit/production-membership-mobile.png`). These are desktop-responsive checks, not physical-device or production MFA acceptance.

## Current Cloudflare staging work and exit gates

The platform implementer owns `cloudflare/` Worker adapter/tests. The identity implementer owns `deployment/cloudflare/` Rails plus local clamd packaging. The coordinator owns PostgreSQL/R2/provider feasibility, credentials/permissions and deployment preparation. These changes are in progress and unreviewed; application-baseline CI must not be presented as their validation.

One isolated synthetic staging rehearsal needs the following concrete evidence:

1. Pin the reviewed adapter/package commit and image; choose external PostgreSQL and the exact synthetic staging hostname. Record bounded runtime/database costs and required credential destinations/permissions before creating credentials or enabling execution. Existing Workers Paid and an empty R2 bucket alone do not satisfy this gate.
2. Forward an explicit allowlist of required secrets/configuration without image/log leakage. Prove the Worker replaces spoofable forwarding headers with trusted host/scheme/client-IP values and that direct container ingress cannot bypass it. Test host checks, secure cookies, redirects and throttling.
3. Run clamd privately on loopback. Keep Rails unready until the permitted engine and fresh signatures are available; test cold starts, failed/stale updates, safe detection, timeout/outage and restart. Measure combined Rails/clamd/signature-update peak memory and bounded upload concurrency.
4. Apply clean migrations to isolated PostgreSQL with effective TLS verified. Exercise private R2 write/read/delete, anonymous denial, stored-file ownership/provenance and integrity. Container ephemeral disk is not durable PostgreSQL or backup storage.
5. Begin with outbound mail disabled. A later identity-delivery rehearsal needs an approved sender and synthetic recipients, received activation/recovery links, dispatcher/preview-expiration scheduling, alerting and outage/restart checks; container sleep must not silently stop scheduled duties.
6. Record actual hosted startup/readiness, synthetic member/admin/MFA journeys, concurrency, restart persistence, measured database/object restore and build rollback. Complete physical iOS/Android and keyboard/focus/zoom/representative assistive-technology checks before pilot release.

A passing dependency probe, private bucket setting or image build does not replace these observations. No real member list, real administrator, public DNS cutover or live outbound message is authorized merely by this review. Existing production intent remains in force once the concrete remaining setup and evidence requirements are satisfied.

## Milestone status and remaining release evidence

| Milestone | Current status | Remaining requirement |
| --- | --- | --- |
| P0 Scope/decisions | Scope, identity authority, domain and Cloudflare selection recorded; exact application baseline/CI established | Runtime/database budget and permissions; sender, retention, operational/recovery owners and pilot details. |
| P1 Application identity/security | Bounded source accepted; current SQLite/PostgreSQL CI passed | Actual delivery/recovery/MFA/proxy operations and policy decisions on the hosted candidate. |
| P2 Infrastructure/private uploads | ISP project and empty private staging R2 created; adapter/scanner packaging in progress, unreviewed | Reviewed/tested packaging, runtime/PG/secrets, actual scanner/storage behavior, alerts and measured restore. |
| P3 Staging acceptance | Isolated hosted rehearsal not yet executed | Six rehearsal gates above on the exact candidate; no unresolved critical/high defect. |
| P4 Pilot/go-live | Operational NO-GO | Successful rehearsal, physical-device checks, authorized real-data/pilot arrangements, approved content/receipt process, support/rollback owner and release record. |

Preserve application CI links and add new adapter/package review, test and deployment evidence at its own exact commit. Record staging environment/configuration, effective database TLS, scanner versions/freshness, object-store privacy, received-mail drills, schedules/alerts, recovery measurements, secrets/encryption-key backup/rotation and rollback. The owner-deferred planterapp.co DNS/nameserver/TLS step remains pending. These are the remaining requirements; hosting provider selection and baseline source CI are already complete.

Every future evidence entry identifies commit/image, environment, operator/tester, date, procedure and artifact. Relevant changes reopen their affected gates. The existing production instruction and Cloudflare choice authorize continued necessary preparation; request only concrete missing decisions/permissions, not ceremonial milestone approvals. Operational NO-GO is grounded in absent hosted integrations/rehearsal and unresolved runtime/data/operations arrangements, not an unchosen host or an untested baseline.
