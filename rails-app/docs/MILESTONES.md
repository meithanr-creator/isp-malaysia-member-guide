# Rails delivery milestones

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
