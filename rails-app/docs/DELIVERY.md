# Rails local-review delivery

25 October 2026, Asia/Kuala_Lumpur.

- Project: `D:\Projects\isp-member-rails`.
- Runtime/gems/temp: `D:\Projects\isp-rails-tools`.
- Local review: http://127.0.0.1:4180/ (this computer only, while the server runs).
- Repository branch: https://github.com/meithanr-creator/isp-malaysia-member-guide/tree/rails-member-events/rails-app
- Architecture milestone commit: `f332d64fa4ea72da5da31cd34850d45dab19316b`.
- Previous M6 implementation commit: `b53f893c4c324f1b2e0e8a02ca14b27c6c63420e` (mobile Discover CMS and navigation refinement).
- M6 GitHub checks: https://github.com/meithanr-creator/isp-malaysia-member-guide/actions/runs/40183704647 — passed on Ubuntu: tests, Rails autoloading and Brakeman.

The implementation contains Rails source, documentation and brand assets plus the repository-level CI workflow. Published source was checked for excluded master keys, encrypted local credentials, databases, uploads, logs and temporary files. Local sample records and screenshots are not part of the GitHub source package.

## M7 release evidence

Implementation commit: `a0b8b3d3f5336777fc2e48858ad985459f7145c8`.
GitHub validation: https://github.com/meithanr-creator/isp-malaysia-member-guide/actions/runs/40191683497 — passed: tests, Rails autoloading and Brakeman on Ubuntu.

## Current M7 delivery

Native Membership (no CPD), member-only Publications and member-only Consultation replace the legacy demo links. Only Shop and Plantation jobs remain legacy demos. Admins use `/admin/publications` to upload PDF books/covers, edit descriptions, preview and publish. Members see published covers at the bottom of `/` and browse `/member/publications`; every cover and PDF requires member authentication. Admin enquiry inbox: `/admin/consultation_requests`. Members submit and review their own questions at `/member/consultation_requests`.

124 tests / 984 assertions passed; autoloading and security scan passed; Astra accepted source and mobile screenshots. Test content was removed, so upload the first authorised issue to populate the library. Membership currently shows stored profile/contact details; dues, renewals and verified tiers are outside this milestone. All source/runtime/uploads/evidence remain on D. The local preview runs on 127.0.0.1:4180; it is not a public link. Cloudflare's previous static demo is unchanged. Production identity and Rails hosting remain pending.

## Review routes

### M6 mobile and Discover refinement

The 25 October refinement removes Academy and Community forum navigation, marks Shop and Plantation jobs as DEMO, and adds the administrator-only `/admin/discover` inline editor. Administrators can change each card's picture, accessible image description, tag, title, description and HTTPS destination. Every public card uses “Click to Access Website”. Saves update the landing page immediately.

Final local validation: 87 tests, 620 assertions, zero failures/errors/skips (seed 62941), Rails autoloading passed, and Brakeman reported zero warnings/errors. Responsive browser checks covered widths 320–430 px plus landscape. Real iOS Safari and Android Chrome device checks remain pending; see MOBILE-QA.md. Three further screenshots are in `audit/`: menu-refinement.png, discover-editor.png and discover-public.png. M6 is complete for responsive local review.

Landing `/`, login `/login`, public events `/events`, member dashboard `/member/dashboard`, admin workspace `/admin/events`, new-event editor `/admin/events/new`. Private routes require the corresponding session. Local demo-entry buttons on the login page let reviewers explore fictional member/admin accounts.

Six screenshots are saved in `audit/`: landing, login, dashboard, admin form, event preview and desktop admin. Astra accepted the local design and source gates; see DIRECTOR-REVIEW.md. Test coverage and limits are in TEST-REPORT.md.

M0, M1, M2a, M3 and M4 are complete for local review. M2b production identity and M5 hosted/operational readiness remain pending. This app has not been deployed to Cloudflare Pages; a Rails-compatible host and production controls must be selected/configured first. The existing static Cloudflare demonstration and its deployment branch were not updated for this Rails release.

No email or payment was sent. The created event, member profile and registration used fictional review data. A database uniqueness constraint prevents duplicate interests, but simultaneous HTTP retry recovery remains a documented production work item.
