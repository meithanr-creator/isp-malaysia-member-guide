# Production director review and release evidence

Date: 25 October 2026 (Asia/Kuala_Lumpur). Reviewer: Astra. Project: `D:\Projects\isp-member-rails`. Companion plan: `docs/PRODUCTION-PLAN.md`.

**Decision: NO-GO for production activation or real member data.** The local production-hardening increment has materially advanced. Corrected-source review confirms the principal application fixes are implemented. The final edit-conflict correction is accepted at source level and the independent local full suite passes; exact-commit CI is pending; infrastructure, delivery, recovery and device acceptance still require actual evidence. Shop and Plantation Jobs remain frozen demos.

## Owner decisions and authorization boundary

The membership authority is an administrator-uploaded list. `rvrameshveloo@isp.org.my` is the intended first administrator/company and invitation/recovery contact. Native Rails invitations, recovery and administrator TOTP are the implementation direction. A registry row establishes supplied eligibility; verified invitation redemption establishes control of that account email. Neither a CSV row nor a technical active flag alone grants access.

The owner has purchased **planterapp.co through GoDaddy** and will change nameservers when ready. This supersedes the earlier no-domain-purchase preference. Domain selection is confirmed; DNS verification/cutover, nameserver change, TLS and host mapping remain pending. The owner confirms there is no existing ISP server and requests a lower-cost hosting proposal. docs/HOSTING-PROPOSAL.md records a conditional single 8 GB self-managed VPS, private R2 storage/backups and verified SMTP option. Hosting costs are not approved. No paid services, DNS changes, real account provisioning, real membership import or outbound messages are authorized by this review. A provider HTTPS address remains a possible staging address, not a required substitute for the purchased domain.

Mailbox ownership, mail-sender permission/provider and actual received-link verification remain pending. No real administrator was provisioned by the reviewed implementation. Operator/bootstrap services and email flags are mechanisms, not approvals.

## Provenance and review method

The coordinator reported the former demonstration baseline as commit `3673fe30e842cd987b9827c669493b58d89c0e91` on rails-member-events. Current delivery preparation is on **production-readiness**, draft **PR #1**, with reported documentation baseline `8e9a3b9`. The reviewed source is the mutable local D-drive tree; this review does not assert it equals a published commit. Record the exact final candidate and CI result after integration.

Independent source inspection covered account/session eligibility, challenge/MFA and token consumption, recovery outbox leases, invitation/bootstrap, membership import and lock ordering, PostgreSQL/storage configuration, preflight/readiness, upload scanning and protected downloads, interest row locks, security headers/CSP and the network-only service worker. This was source review, not a new director-executed test run or hosted observation.

The earlier TEST-REPORT.md result of 124 tests / 984 assertions is historical demonstration evidence. Implementers/coordinator subsequently reported focused passing runs: identity 83 tests / 570 assertions; membership import 28 / 219; platform/scanner/configuration 70 / 371, plus static/dependency checks and asset compilation. These reports are not a final combined candidate result, may cover different intermediate trees and must not be summed. The final independent local full-suite result below supersedes these focused counts for integrated local regression; the counts are not additive.

## Final independent local regression evidence

On 25 October 2026, the independent platform tester ran the full Rails test suite against the frozen corrected local source on Windows/SQLite: **277 tests, 2,230 assertions, zero failures, zero errors, two PostgreSQL-only skips**, seed **61808**, elapsed **13.751086 seconds**. The director read the saved runner output at `audit/production-full-tests.txt`; this is independent execution evidence, not a director-run suite. Project runtime: Ruby 3.4.12 / Rails 8.1.4, with tools on D. The two skipped cases are concurrent Discover setup and event-interest requests, explicitly guarded for PostgreSQL in their source. They remain open for PostgreSQL CI and selected-host validation.

This run covers the integrated local candidate after the event/publication edit-version and PWA route-format corrections. The immutable GitHub commit, SQLite/PostgreSQL/Linux-container CI outcomes and final static/build linkage must still be recorded after publication. Local test success does not establish hosted scanning, private storage, SMTP delivery, restore, operational readiness or physical-device acceptance.
## Current source assessment

| Area | Source conclusion | Remaining evidence or correction |
| --- | --- | --- |
| Sessions and throttling | Server stores token digests, idle/absolute deadlines and credential fingerprints; logout/revocation removes rows. Production checks verified email and current linked eligibility. Shared database counters replace per-process limits. | Local full-suite regression passed; PostgreSQL concurrency/proxy tests and owner acceptance of proposed 30-minute idle / 12-hour absolute policy. |
| Membership import | Admin-only bounded UTF-8 CSV; protected row preview; exact digest/version confirmation; registry/user locking; atomic changes, replay handling, duplicate/identity collision rejection, audit and ineligibility suspension. Import does not activate accounts or send invitations. | Local integrated regression passed; PostgreSQL contention evidence; approved real-data handling and retention. Expiration schedule must actually run. |
| Activation/recovery | Pending accounts; hashed purpose-specific single-use tokens; eligibility/fingerprint rechecks under registry/user/token locks. Fragment links keep tokens out of request URLs. Recovery HTTP queues encrypted delivery records rather than contacting SMTP. Dispatcher claim preserves another worker's lease, completion checks lease ownership, expired queue entries do not block live enumeration, and cleanup excludes already scrubbed tokens. | Received-link/error/outage tests on approved mail provider. Monitored dispatcher is not provisioned; mail remains disabled. |
| Administrator MFA | Password creates a short-lived challenge; no admin session until TOTP/recovery code succeeds. Encrypted setup secret, replay checks, hashed one-use recovery codes and once-only display are implemented. Password recovery retains MFA. | Host-only AdminMfaRecovery now audits operator/authorization references, revokes credentials/sessions/tokens/challenges, returns the account to pending and requires separate reactivation plus MFA enrollment. Source correction and local regression accepted; independent identity-check procedure/operator ownership and hosted rehearsal remain gates. |
| Sensitive admin changes | Ten-minute MFA freshness is checked before event/publication edits, uploads and publication, and Discover changes. AdministrativeAction locks and rechecks the actor/current session inside the mutation transaction. Step-up rotates the server token while retaining CSRF for open forms. | Both forms now retain the original permitted submitted version after stale-MFA, audit failure and rejected saves, while successful saves refresh the form version before preview. Source correction and local regression accepted; exact-commit CI and policy acceptance remain pending. |
| Publishing audit | AdministrativeAction and migration 20261025240000 add transactional actor/target/action/revision/time/outcome audit for event/publication draft and publish changes plus Discover setup/edits. Audit failure rolls back the protected mutation. | Source correction and local regression accepted; exact-commit CI evidence pending. |
| Upload safety | All upload validators call bounded fail-closed ClamAV scanning; metadata carries clean verdict, scanner/signature version, time and SHA256. Production publication/delivery requires accepted provenance; download hashes verify exact bytes. | EventDraftUpdater now rejects an excessive total image count before scanning any image or brochure. Source correction and local regression accepted; real scanner detection, stale signatures, outage/timeout, private bucket policy and image-processing acceptance remain staging gates. |
| Production configuration | Required PostgreSQL, host, secrets/encryption, private storage and scanner configuration validated; asset-build exception is constrained. Readiness probes database/schema, storage and scanner. | Actual hosted startup/migrations, credentials, storage privacy, mail, networking and restore unproven. Readiness is not release approval or an end-to-end security test. |
| Fresh database content | Explicit administrator setup inserts only missing shipped Discover positions, preserves existing cards and requires fresh MFA plus transactional audit. Invalid retained URLs render inactive; submitted Discover edit versions survive verification redisplay. Production demo seeding remains prohibited. | Source correction and local regression accepted; PostgreSQL setup evidence and live content review pending. |
| Interests/files | Stable per-user row lock serializes interest writes; published snapshot behavior retained. Read-only admin roster scopes to one event and selects submitted contact fields, time and event version in pages of 50; no-store/private responses and escaped output retain the authorization boundary. PDF attachment/nosniff and file ownership/revision checks remain. | Source review found no additional roster defect. Local combined request tests passed; PostgreSQL concurrent requests pending. |
| Mobile/browser privacy | Strict CSP; manifest; service worker has no cache/fetch handler and supplies no offline private records. | Actual CSP browser journeys and iOS/Android install/accessibility checks; responsive desktop screenshots alone do not certify devices. |

The focused corrected-source inspection found and then rechecked the event/publication stale-MFA edit-version defect. Both templates and both controller error paths now retain the submitted version, refusing stale overwrite after verification or repeated retries. After a successful draft save, the form instead receives that saved version before preview so an incomplete preview can be corrected and resubmitted. Four regression cases cover these two outcomes for both editors. No unresolved blocking defect remains in this bounded source review. This conclusion is source inspection of a mutable tree, not final candidate or hosted acceptance.

## Correction status before local increment acceptance

| Correction | Director source outcome | Evidence still needed |
| --- | --- | --- |
| Fresh MFA/current actor and session | Implemented and inspected in AdministrativeAction and administrator controllers; open-form CSRF is retained during token rotation. | Local combined tests passed; exact-commit CI and policy acceptance before pilot. |
| Transactional publishing/Discover audit | Implemented and inspected; audit failure rolls back mutation. | Local regression passed; exact candidate CI pending. |
| Lost-factor administrator recovery | Implemented and inspected; host-only reset with references, pending state, complete revocation and mandatory enrollment. | Local tests passed; approved operator identity-check/recovery rehearsal pending. |
| Empty Discover setup and retained input | Implemented and inspected; explicit fixed-position insertion, preservation, safe URL rendering and retained submitted edit version. | Local integration passed; PostgreSQL tests and live content review pending. |
| Upload count before scans | Implemented and inspected; excessive image totals skip all image/brochure scanners. | Local affected/combined tests passed; actual hosted scanner evidence pending. |
| Dispatcher lease and cleanup | Implemented and inspected; owned completion, expired filtering and non-null secret cleanup. | Local lifecycle tests passed; approved provider/schedule/failure drill pending. |
| Event/publication stale edit after MFA | CLOSED at source review: both controllers/templates retain the submitted token after rejection and refresh only after successful draft save, including incomplete-preview correction. | Coordinator reports focused 31 tests / 466 assertions, seed 41543, zero failures/errors/skips. The independent full suite above passed; exact candidate CI remains pending. |

No director test process was run against the shared test database. Focused intermediate reports must not be summed or substituted for final combined candidate evidence. The final correction run is a coordinator-reported focused result, not a director-executed full suite. Independent testing also found and corrected service-worker/manifest route formats to JavaScript/JSON; the corrected routes are included in the passing local combined suite; actual device installation remains unproven. Coordinator browser checks report no console errors on the examined home/menu/login and admin membership/Discover/roster/publication paths, plus no overflow/offscreen inputs at 320/390 px (audit/production-membership-mobile.png). These are desktop-responsive checks, not physical-device or production MFA acceptance.

## Lower-cost hosting architecture review

The owner-requested proposal is a reasonable pilot architecture to quote, not a provisioning decision. Consolidating Rails, PostgreSQL, ClamAV and schedules on one 8 GB VPS creates a single failure and resource-contention point; the proposal correctly makes sizing/load/signature-update checks, separate synthetic rehearsal, measured recovery and a named operations owner conditions of use. Keep database/scanner network exposure private and retain the existing database TLS, scanner, storage and identity requirements. Off-server backups need separate protected recovery credentials/keys and tested retention/restoration; private publication storage alone does not establish backup recoverability.

The proposal labels US$15-20 initial / US$20-25 renewal monthly equivalents as planning allowances, distinguishes promotional upfront commitment from renewal, and excludes labour/tax/temporary staging. Its VPS plus US$0-2 storage and US$0-5 SMTP arithmetic fits that envelope under the stated pilot assumptions. The updated proposal records a coordinator-verified unsubmitted Malaysia KVM 2 cart: recommended 12-month term US$119.88 base + US$9.59 displayed tax = US$129.47 upfront, renewing at US$16.99/month equivalent paid annually before tax. Alternatives are US$227.84 tax-inclusive upfront for 24 months, renewing at US$14.99/month equivalent, or US$15.11 for the first monthly term, renewing at US$24.49/month before tax. The annual VPS plus stated storage/mail allowances remains within the planning envelope before tax/labour. The cart is evidence of displayed options, not purchase, guaranteed invoice or measured deployment capacity. A final invoice recheck, chosen term, SMTP quote/sender verification, isolated rehearsal and operational ownership remain required before spending. This review assesses the supplied proposal and recorded cart observation; no new cart was submitted by the director. No infrastructure, DNS, mail or live-account action is authorized by this architecture review.

## Milestone status

| Milestone | Status | Exit evidence still required |
| --- | --- | --- |
| P0 Scope/governance | Scope and identity/domain direction recorded; partial | Hosting/cost, DNS/mail authorization, retention, recovery/operations ownership and final candidate provenance. |
| P1 Identity/security | Source corrections accepted; independent local suite passed | Exact commit/CI evidence and actual identity delivery/recovery/MFA operations. |
| P2 Infrastructure/private uploads | Local configuration/scanner implementation; no approved deployment | Hosted PostgreSQL/private storage/scanner/mail, clean bootstrap, measured restore and alert evidence. |
| P3 Staging acceptance | Not performed on real selected services | Exact candidate tested on approved infrastructure; mandatory security/device/operational checks with no critical/high defects. |
| P4 Pilot/go-live | Not approved | Named pilot/support owners, real-data arrangements and accepted release pack tied to existing production intent and resolved concrete host/cost/setup decisions. |

## Required release evidence still absent

- Link the passing independent local full suite and final static checks/asset build to the immutable source commit; obtain successful GitHub SQLite/PostgreSQL/Linux-container validation.
- Selected-host PostgreSQL migrations and true concurrent requests; private object-store denial tests and representative object integrity.
- Live scanner safe detection fixture, stale-definition and outage/timeout drill; image handling policy/processing proof.
- Verified sender, received activation/recovery email, observed dispatcher schedule/alerts and failure/restart drill. Environment flags and queued records do not prove delivery.
- Independent first-admin bootstrap/MFA enrollment and lost-device recovery rehearsal using approved synthetic identities; later real bootstrap requires authorization.
- Database/object backup restore with measured recovery targets, rollback and incident-response exercise, secrets/encryption-key backup/rotation plan.
- Actual planterapp.co DNS/TLS/host verification when authorized; no nameserver or DNS cutover has occurred through this work.
- Physical iOS/Android, keyboard/focus/zoom and representative assistive-technology acceptance on the candidate.
- Privacy/retention/publication rights/content/receipt-process approval and pilot arrangements and release record reflecting the existing intent and resolved setup decisions.

## Release review rules

Every evidence entry identifies exact commit/build, environment, operator/tester, date, command/procedure and artifact location. Distinguish source inspection, local execution and hosted observation; record failures/limitations. Changes reopen affected gates. Local code acceptance and the owner's production deployment decision are separate. Tool permission to write on D is neither hosting approval nor permission to operate real accounts.

For Shop/Jobs, preserve the frozen demo implementation. Final live navigation may hide references or retain conspicuous DEMO labels according to the owner's presentation decision; neither option expands demo functionality.

Governance clarification: the user has already instructed the team to move to production and continue. That authorization covers necessary reversible implementation and testing; no extra generic approval is introduced by these milestones. Current NO-GO follows pending final candidate validation and missing staging/operations evidence; the bounded inspected source corrections are closed. Resolve only concrete remaining dependencies such as host/cost, credentials/sender setup, owner-deferred DNS work and real-data/operational responsibilities. The release record can reference existing intent plus the later concrete setup decisions rather than demanding another blanket confirmation.




## Verified candidate and CI — 25 October 2026

Source revision: 6873ab772c9192ddd06cedfe949745e9e17c3d36 on production-readiness, draft PR #1. All three checks passed in both push run 40208159193 and PR run 40208162564: Linux SQLite, Linux PostgreSQL 17 and production container build. SQLite: 277 tests / 2,230 assertions, zero failures/errors, two PostgreSQL-only skips (seed 16596). PostgreSQL: 277 tests / 2,268 assertions, zero failures/errors/skips (seed 4393). Autoloading passed on both; Brakeman and refreshed dependency advisory checks passed. The container builds and its configured user is 1000:1000; this does not prove hosted startup or operational integrations.

Astra independently verified the exact PR head/checks and accepted the scoped concurrency-test cleanup and portable Ruby launcher correction. Synthetic nontransactional test audit rows are removed before their synthetic actor; production audit constraints remain unchanged. All bounded source findings are closed. Earlier statements that final source/CI validation is pending are superseded by this record; operational release remains NO-GO pending the actual hosting, storage/scanner/mail, restore/rollback and mobile-device evidence.

The owner asked whether Cloudflare and GitHub can be used. They can: GitHub source/CI, Cloudflare Containers for Rails, private R2 and an external managed PostgreSQL service are a compatible architecture to assess. Cloudflare's US$5 starting plan excludes complete runtime/database/other service costs. The alternative VPS quote is an unsubmitted comparison, not an approved vendor selection. No hosting, DNS, live-data action or paid order is authorized by this evidence record. See HOSTING-PROPOSAL.md.

CI evidence: https://github.com/meithanr-creator/isp-malaysia-member-guide/actions/runs/40208159193