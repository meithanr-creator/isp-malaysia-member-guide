# Rails delivery milestones

## Current production gates — 27 October 2026

This table is current. The earlier M0–M7/UI checkpoints below are historical local-review evidence. See PRODUCTION-STATUS-2026-10-27.md and audit/staging-2/acceptance-closure-ledger.json for exact receipts and unclosed cases.

| Gate | Current status | Evidence / next condition |
| --- | --- | --- |
| P0 Scope and guardrails | Maintained | Rails; all files on D; US$5 cumulative incremental ceiling; Shop/Jobs frozen DEMO; Academy/Forum excluded; no real-member operation, identity mail, paid upgrade, DNS cutover or public launch. |
| P1 Reviewed source and CI | Baseline8f86873 passed; storage-tool delta source GO/local276PASS, new exact CI pending | Application/image unchanged. Three-file Windows storage-reader correction preserves original TLS/signing and fixed target boundaries; Astra source GO and actual live dependency capture PASS. |
| P2 Hosting and recovery | Live dependency access PASS; inactive package/provider/runtime proof open | Deployment key verified until19:35MYT, same five permissions/value. ISP-only24h S3 key approved; full read-only Neon/R2 capture PASS. Corrected source CI, new private packet review, inactive provision/seal, runtime/watchdog and full recovery remain. No new app mutation/runtime. |
| P3 Hosted acceptance and virtual mobile | NOT RUN for the revised full candidate | All63 hosted case closures remain open. Local engine readiness/CI do not close hosted cases. First functional phase selects42 HTTP cases; full browser journeys and independent reconciliation/cleanup are required separately. |
| P4 Production launch | NO-GO | Required P2/P3 evidence, verified identity-mail delivery, approved first admin/member records/content, support/retention/ongoing-cost ownership, domain/TLS readiness and Astra final decision remain. |

## Historical delivery checkpoints

Updated 25 October 2026, Asia/Kuala_Lumpur. Director/PMO: Astra high. Implementation and independent testing: GPT-6.1 Sol extra high. Parent coordinates integration and release.

| Gate | Status | Acceptance evidence |
| --- | --- | --- |
| M0 Requirements and Rails architecture | Complete | User confirmed Rails; PLAN.md captures flow, roles, states, hosting boundary and open production decisions. Astra reviewed. |
| M1 Redesigned Rails pages | Complete — local review | Five requested surfaces rendered. Browser checks at 320/390/1440px; screenshots in audit/. Astra visual acceptance in DIRECTOR-REVIEW.md. |
| M2a Local identity foundation | Complete — sample accounts | Server password sessions, role/ownership checks, CSRF, throttling and logout tested. Production demo entry/seeds disabled. |
| M2b Production identity readiness | Not started | Member verification, account recovery, admin MFA, account/session lifecycle and abuse policy. Passing M2a does not complete M2b. |
| M3 Draft, preview and publication | Complete — local review | Version checks, publication snapshots and protected files tested. Browser upload → preview → edit → preview v2 → publish completed. |
| M4 Interest and receipt workflow | Complete — local review | Public browsing; member login return, interest and dashboard verified. Ownership, snapshots and uniqueness tested. Email draft only; no payment verification. |
| M5 Hosted release and operational readiness | Not started | Compatible host/costs, real member onboarding, approved finance details, MFA/recovery, upload scanning, backup and restore. |
| M6 Discover editor and navigation refinement | Complete — responsive local review | Three editable cards, validated picture/HTTPS links, fixed CTA, Academy/Forum removed, Shop/Jobs DEMO badges. 87 tests / 620 assertions passed; mobile checks and Astra review accepted. Physical device checks remain pending. |

## Checkpoints

- Astra inspected scope and identified legacy review-query authentication bypass; excluded from Rails design.
- User confirmed Rails. New project D:\Projects\isp-member-rails; legacy static app restored and not redeployed.
- Existing WSL failed RPC startup. Official Ruby3.4.12 and Devkit verified by publisher SHA256 and installed under D:\Projects\isp-rails-tools. Rails8.1.4 and107 gems installed; script/rails.ps1 about booted successfully with SQLite and Rails middleware. No live member data.
- Astra reviewed the written plan: corrected local-versus-production milestones, Rails hosting boundary and sample-account wording. M3/M4 local functional checks are separate from production scanning, storage and finance verification gates.
- Sol implementation and independent testing assigned; Astra reviews acceptance gates. Reassess after substantive changes and before commit/release. Failures reopen the relevant gate.
- First independent model/service run: 35 tests, 141 assertions, no failures/errors/skips. This is an interim checkpoint; request tests and browser review remain open.
- Astra's source audit required strict draft version tokens and a persisted published revision for registration snapshots. The tester also identified default Active Storage draft-file access. All were corrected and independently retested.
- Final checks: 61 tests, 380 assertions, zero failures/errors/skips (coordinator rerun seed 6774). Rails autoloading passed; Brakeman 8.1.0 reported zero warnings/errors after correcting GET/HEAD return-path handling.
- Browser review: password login returns to the selected event; interest appears in the dashboard; logout works. Admin image upload, revised preview and publication completed. Free admission hides payment fields. Carousel next/pause, menu icons/Escape, image loading and responsive overflow checks passed.
- Astra accepted M1 visuals from landing, dashboard and desktop-admin screenshots plus the coordinator's responsive checks. Concurrent request race recovery and all production gates remain limited; see TEST-REPORT.md and DIRECTOR-REVIEW.md.

## Evidence policy

M6 checkpoint: admin live text/picture preview and save were verified through the browser, followed by signed-out homepage verification. Public/editor widths 320/360/390/430 and editor landscape 844×390 had no horizontal overflow or offscreen fields. Inputs were 18px. Rejected URL error-page links are inactive. Final suite seed 62941 passed 87 tests / 620 assertions; autoloading and Brakeman passed with zero warnings/errors. See MOBILE-QA.md and audit/menu-refinement.png, audit/discover-editor.png, audit/discover-public.png.

Implementation commit: `9d09fe29000405c8637028edb9147e65a909a235`. GitHub Actions run `40180704259` passed tests, autoloading and Brakeman on Ubuntu. See DELIVERY.md for review routes and links.

Record commands/results, screenshots, source commit and unresolved defects. Do not mark a gate complete without evidence. A local seeded app is not a production membership service. No unattended monitor is configured.

## M7 — Native member services (complete for local review)

Requested on 25 October 2026: remove Membership, Publications and Consultation from legacy demos; remove CPD; add protected publication administration/library and member consultation enquiries.

1. Membership: persisted profile, no invented membership number/status, no CPD or legacy redirect.
2. Publications: admin PDF + cover + description; validated uploads; private draft, preview, exact reviewed publication; subsequent drafts preserve the published version.
3. Member access: library and landing-page covers require member login; every cover/PDF is authorized against the current published snapshot. Visitors receive only a generic login invitation.
4. Consultation: member-only enquiry form, own history and reference; admin read-only inbox. No booking, payment or automatic email. Repeated submission keys cannot create duplicates.
5. Evidence: independent regression tests, role/file isolation checks, mobile browser journeys, Astra review and GitHub validation before completion. Production M2b/M5 remain pending.

M7 acceptance: 124 tests / 984 assertions passed (seed 5156); Rails autoloading passed; Brakeman zero warnings/errors. Astra source and screenshot reviews accepted. Browser upload → preview → edit → preview → publish → member homepage/library and enquiry → admin inbox completed. QA records/uploads removed. GitHub release validation is recorded in DELIVERY.md. M2b and M5 remain pending.

M7 usability refinement: persistent, icon-labelled administration shortcuts added above every admin page so Publications, Discover ISP and Consultation enquiries are visible alongside Events. Existing access controls are unchanged.

## Production transition — current work

The owner authorized moving to production and continued work, with Astra directing review and Sol 6.1 extra-high agents implementing/testing. The intended domain is **planterapp.co**; the owner will change nameservers when ready. All working files remain on D and Shop/Jobs development is frozen.

The newer P0–P4 plan in PRODUCTION-PLAN.md supersedes the earlier M2b “not started” description: native identity, membership import and security implementation are now under independent integration review. Earlier M0–M7 acceptance is historical, not evidence for the new candidate. Production status remains incomplete until source checks, GitHub validation and actual hosting/mail/storage/scanner/device/restore evidence are recorded in PRODUCTION-REVIEW.md. No generic repeat approval is required; concrete unresolved hosting/cost and operational decisions remain dependencies.
## Linux CI verification — candidate 6873ab7

GitHub Actions run: https://github.com/meithanr-creator/isp-malaysia-member-guide/actions/runs/40208159193
Source commit: 6873ab772c9192ddd06cedfe949745e9e17c3d36

- Ubuntu / SQLite: 277 tests, 2,230 assertions, zero failures/errors, two PostgreSQL-only skips; seed 16596.
- Ubuntu / PostgreSQL 17: 277 tests, 2,268 assertions, zero failures/errors/skips; seed 4393. Both real database concurrency tests executed.
- Rails autoloading passed on both databases. Brakeman reported no warnings and the refreshed advisory check found no vulnerabilities.
- The first candidate exposed missing cleanup of synthetic audit records in a nontransactional concurrency test. Cleanup now removes only that test actor's audit rows before its user, preserving production audit constraints. Ruby launchers were made portable to Linux. Astra reviewed the correction before this successful rerun.

These results supersede the earlier PostgreSQL-pending statement for source validation. They do not replace hosted integration, backup restoration, email/scanner validation or physical-device acceptance. No production deployment or paid order occurred. Container status is recorded in the final production review/run record.
## Cloudflare project creation — 25–26 October 2026

Owner selected Cloudflare. The separate isp-member-production Worker exists, connected to the ISP GitHub repository and production-readiness branch with builds disabled. Production/preview URLs are disabled; no domain, bindings, runtime secrets, container or database was added. This is a reserved project, not the Rails launch. Exact state and screenshot are recorded in CLOUDFLARE-PROJECT.md.

A later documentation-revision CI run exposed a PostgreSQL test fixture leak (run 40208670563, seed 30898): committed synthetic login counters affected a whole-table unit assertion. Both concurrency fixtures now clean only their own account/IP scopes after joining workers. The unit test asserts only its own counters and checks unrelated unexpired rows survive. Astra accepted the bounded source correction; production throttling and audit constraints are unchanged. The authoritative validation for this correction is the latest production-readiness check result in PR #1, separate from the earlier passing source revision recorded above. Operational launch gates remain open.