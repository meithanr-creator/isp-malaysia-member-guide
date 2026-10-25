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

Record commands/results, screenshots, source commit and unresolved defects. Do not mark a gate complete without evidence. A local seeded app is not a production membership service. No unattended monitor is configured.
