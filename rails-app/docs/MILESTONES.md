# Rails delivery milestones

## Current production gates — 28 October 2026

Current authority: [four-step checkpoint](PRODUCTION-STATUS-2026-10-28.md) and [42-case evidence](../audit/private-acceptance/critical-http-closure.json). Earlier entries below remain historical.

| Gate | Current status | Remaining condition |
| --- | --- | --- |
| P0 Scope and guardrails | Maintained | Rails; all files on D; cumulativeUSD6 test cap (owner raised on28October); no demo expansion, real-member operation, outgoing identity mail, DNS change or public launch. |
| P1 Source and CI | Queued6 source reviewed; new focused tests plus prior8cbf seven-job CI carry | Preserve exact source/CI evidence. Verify only affected changes. Current gateway correction is being source-tested before review/publication. |
| P2 Hosting and recovery | Hosted Rails/Neon/private storage/scanner readiness and shutdown observed | Complete file/key/sequence/restored-write recovery and rollback. Earlier database restore evidence carries within its recorded scope. |
| P3 Focused hosted acceptance | **42/42 selected HTTP cases accepted** | Both full mobile profiles remain pending. Request/transfer admission is corrected under theUS$6 plan; exact packet review precedes hosted testing. No42-case replay. Full63-case inventory is not claimed complete. |
| P4 Production launch | **NO-GO** | Remaining mobile/recovery/mail/operational and owner-ready domain/TLS gates; Astra final release decision. |
## Narrow gap closure — 28 October, 01:58 Malaysia time

- Astra reviewed the exact retirement plan and corrected helper before execution. Nine synthetic accounts, seven linked membership-registry rows and their exact captured dependencies were removed once. Both complete upload-tombstone rows, all throttle rows and the original fixture manifest remained unchanged. The disposition is ACTORS_RETIRED_RECOVERY_RETAINED; normal cleanup remains incomplete and an empty baseline is not claimed. No object writes or repeated recovery calls occurred.
- An actual offline reproduction with the pinned Ruby/ActiveStorage/AWS SDK stack demonstrated overlapping MD5 + optional CRC32 request checksums. The SDK-native process setting when_required preserves Rails' MD5 and payload bytes while removing optional CRC32. Four scenarios passed independently with zero network attempts. This proves a compatibility correction; the historical event 422 cause is still unconfirmed.
- The candidate binds that one setting explicitly in the private container environment and future sealed runtime. The existing Rails image and application logic remain unchanged. Correlated Rails operation/error metadata is now captured, with failed admin response bytes retained only in bounded private files. Focused gateway checks: 30 passed; affected operator/diagnostic checks: 24 passed. These are source checks, not new hosted passes.
- The original stopped namespace, packet, run intent and halted HTTP checkpoint are preserved. They will not be reset or replayed. A separately reviewed continuation must carry the nine actual passes, perform fresh login/setup as needed and cover the remaining 33 selected HTTP cases plus mobile journeys. Current source publication/CI and final Astra review precede any hosted continuation. The US$5 cumulative ceiling is unchanged.
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
## Hosted mobile checkpoint — 28 October, 12:29 UTC

Source `8300a7b742f9d07d19fbb39efb9b484772b86013`, packet `115a42b434d63b415316521d6fd93f77f75fd1b1ae1d725ad5da1433b293759b`, received Astra's exact hosted approval. The inactive deployment, secrets, Rails readiness, fresh login/content setup and independent database reconciliations passed. The 42 accepted HTTP cases were carried; zero were replayed.

Fixture preparation initially refused eight expired throttle counters left by the earlier synthetic bootstrap. A guarded transaction verified exactly eight expired rows before the fixed cutoff, removed them using the existing expiry-cleanup method, and recorded before/after evidence. Active counters removed: zero. The original failure evidence is preserved. Fresh fixture preparation then passed; no fixture rows had been created by the refused attempt.

The iPhone private-gate case passed. The keyboard case failed at the exact "Skip link moves keyboard focus to main" assertion; the remaining 15 iPhone cases and all Android cases were not run. Step 2 therefore remains OPEN. The failure is retained as FAIL; earlier successful subchecks do not turn the whole keyboard case into a pass.

Shutdown passed: application absent, ingress closed, browser processes absent, fixtures CLEAN_TO_PROTECTED_BASELINE with the exact two protected blobs and original row hash. The paid runtime interval was 199 seconds; the next plan conservatively retains 213 seconds plus this attempt's full transfer/other allowances.

A focused offline reproduction in the pinned actual WebKit engine found asynchronous fragment focus: immediately after Enter and through 300 ms focus remained on the link; by 1,000 ms it reached MAIN#main. This establishes a harness timing defect. The application/layout/assets are unchanged. The correction must wait within a bounded deadline for the same exact focus criterion, without forcing focus or suppressing failures. Only the failed remainder and affected assumptions are verified. The next execution requires Astra's review of the correction, a fresh namespace/packet and cumulative bound, and equivalent renewed access. Production remains NO-GO.

## Critical mobile continuation — 28 October, 13:00 UTC

Published source601356a77bdd676ad166be893320c8ee0a032911 / packet a2c9416ade2878b963a8174797dc5a49842b67d9a3fbd30a49594fa7b651af63 received Astra's exact hosted approval. The corrected skip-link remainder passed. The next member-login test stopped before submission because its exact Password locator did not resolve.14 further iPhone cases and all Android cases remain unrun. Step2 remains OPEN; the selected42 HTTP passes and accepted iPhone gate/menu/skip evidence remain carried.

The original failure was not overwritten. A distinct audit/private-acceptance/queued6-next-hosted-result.json records the second run and safe closure: application absent, ingress closed, browsers absent, exact protected two-blob baseline preserved. Measured second interval273 seconds; all transfer/other allowances retained. Astra requires a complete offline matrix of the remaining selector, form, transition, timing and response contracts before any fresh namespace or further hosted run. Offline selector/rendering proofs cannot replace hosted identity, mutation, storage or reconciliation evidence. Production remains NO-GO.

## Complete offline harness correction — 28 October 2026

Astra closed the entire offline audit: both pinned engines verify all135 required selectors plus4 preserved original-selector diagnostics across22 actual Rails-rendered pages. All original138 matrix rows are resolved. Three label families and the Rails hidden/file-array ambiguity were corrected in the harness. Same-URL and initiated-form navigation waits now await the fresh final render/load; cached previews, wrong forms and missing final renders fail. The logout guard still rejects temporary private-content exposure before redirect synchronization. Product Rails views, application code and image remain unchanged.

The135 unchanged contracts were carried by descriptor/page hashes; only the affected supplement and changed timing/negative contracts executed. Both engines report zero JavaScript errors, zero external attempts and confirmed browser absence. Four focused admission tests passed, rejecting missing/unresolved rows, source/asset/page drift, incomplete engine/cleanup proofs and offline backend-PASS claims. No accepted116-suite,42HTTP case, iPhone gate/menu/skip assertion or earlier engine-launch proof was replayed.

Immutable matrix: audit/private-acceptance/remaining-mobile-selector-matrix.json SHA973b4520fc3aca4f58ba7c9dab669c08087c30c72243e539a9f1cf08a1197e38. Focused proof: audit/private-acceptance/remaining-mobile-selector-proof.json SHAc75ed37f68eba763f1808cce1bcb01b9da19e53b77e17fd8a5474e2d7825d295. Exact tested harness sources are journeys2c99887be0a80b9479c0992d909a95502b26c531be0528d7d8ecadcbe875ba64 and acceptancebbca729cf418b8fb533be7a50e4bacec48981fda8c1ed72dcd564f6366e4091b. Those full source snapshots were preserved before any further carry-only delta.

Step2 remains OPEN: carry42 HTTP cases and accepted iPhone gate+landing, then execute failed member-login and14 unrun iPhone cases, plus17 Android cases, with hosted database reconciliation and safe closure. Offline UI proof does not establish hosted identity, mutations, permissions or file-service success. Exact fresh carry/source/budget packet review is still required. Production remains NO-GO; the cumulative test ceiling remainsUS$6.

## Fresh remaining-work packet — 28 October 2026

Astra source review accepted the exact reversible carry-selection delta, immutable audit binding and portable source-admission adapter. Windows:6/6 new carry contracts and2/2 affected source checks passed. Pinned Linux:5 portable carry contracts passed,1 private-raw-evidence contract explicitly skipped, and2/2 affected source checks passed. Strict runtime asset checks remain enabled. The old matrix973b4520 and proofc75ed37f remain unchanged; their exact tested source is committed at8610c40e83e9eec587f6a6d543cccc45d10ecda6.

The stopped run was archived with exact hash readback at private-acceptance-history/qa-20261028-6821e1126c98. Offline compilation passed for fresh packet3dea1bffc157886acaf3f5b3bcd2e534bbb9a52e6f0dac50775b08d5be16113a, module4da1b447243b80dec736a89954d4e86d56c7c32c317e7daf4e6cc2f5509203ed. It carries42 HTTP cases and the accepted iPhone gate+landing; iPhone resumes member-login and Android retains its full17-case scope. The32-minute window includes10 minutes for closure; cumulative conservative boundUS$5.86991776 /3129seconds remains withinUS$6 /3300seconds. All prior full transfer and other allowances are retained.

No hosted activation is implied by compilation. Exact source publication/readback and Astra packet/module review remain mandatory before the next run. Production remains NO-GO. Source publication evidence is audit/private-acceptance/queued6-next-carry-publication-evidence.json.
