# Rails local-review delivery

25 October 2026, Asia/Kuala_Lumpur.

- Project: `D:\Projects\isp-member-rails`.
- Runtime/gems/temp: `D:\Projects\isp-rails-tools`.
- Local review: http://127.0.0.1:4180/ (this computer only, while the server runs).
- Repository branch: https://github.com/meithanr-creator/isp-malaysia-member-guide/tree/rails-member-events/rails-app
- Architecture milestone commit: `f332d64fa4ea72da5da31cd34850d45dab19316b`.
- Tested implementation commit: `9d09fe29000405c8637028edb9147e65a909a235`.
- GitHub checks: https://github.com/meithanr-creator/isp-malaysia-member-guide/actions/runs/40180704259 — passed on Ubuntu: tests, Rails autoloading and Brakeman.

The implementation contains 173 Rails source/document/asset files plus the repository-level CI workflow. Published source was checked for excluded master keys, encrypted local credentials, databases, uploads, logs and temporary files. Local sample records and screenshots are not part of the GitHub source package.

## Review routes

Landing `/`, login `/login`, public events `/events`, member dashboard `/member/dashboard`, admin workspace `/admin/events`, new-event editor `/admin/events/new`. Private routes require the corresponding session. Local demo-entry buttons on the login page let reviewers explore fictional member/admin accounts.

Six screenshots are saved in `audit/`: landing, login, dashboard, admin form, event preview and desktop admin. Astra accepted the local design and source gates; see DIRECTOR-REVIEW.md. Test coverage and limits are in TEST-REPORT.md.

M0, M1, M2a, M3 and M4 are complete for local review. M2b production identity and M5 hosted/operational readiness remain pending. This app has not been deployed to Cloudflare Pages; a Rails-compatible host and production controls must be selected/configured first. The existing static Cloudflare demonstration and its deployment branch were not updated for this Rails release.

No email or payment was sent. The created event, member profile and registration used fictional review data. A database uniqueness constraint prevents duplicate interests, but simultaneous HTTP retry recovery remains a documented production work item.
