# Phase 2 Rails test report

Date: 25 October 2026. Target: the local Rails project at `D:\Projects\isp-member-rails`.

## M7 final result — 25 October 2026

**124 tests, 984 assertions, 0 failures, 0 errors, 0 skips.** Final coordinator run seed `5156`, 8.71 seconds. Rails 8.1.4 / Ruby 3.4.12 / SQLite. Rails autoloading passed. Brakeman 8.1.0 completed 79 checks across 18 controllers, 7 models and 38 templates with zero warnings/errors and exit 0.

Coverage adds native membership/profile wording, consultation owner scoping/admin inbox/UUID retry/validation/CSRF, publication upload limits and signatures, exact preview/publish locks and snapshots, admin/member role boundaries, authenticated cover/PDF bytes, private draft and superseded file rejection, cross-publication blob ownership, disabled default Active Storage paths, guest homepage metadata exclusion, escaping and Turbo cache/logout controls. 27 M7 model/service/member-enquiry cases were authored and first run by the independent Sol tester; the coordinator completed 10 publication request cases and the final full rerun.

The first combined run exposed a test-only CSRF switch targeting ActionController::Base rather than ApplicationController. That test configuration was corrected; tokenless create/publish now return 422. No application security bypass was required. Browser QA also found a missing template terminator in enquiry lists; it was fixed before final acceptance.

Browser journeys and mobile screenshots are documented in MOBILE-QA.md. Temporary QA book/uploads and enquiry were removed from the development database. No actual ISP publication is seeded. Real iOS/Android device checks and production identity/hosting remain pending.

## Earlier milestone results

M6 run included the Discover CMS and navigation changes. **87 tests, 620 assertions, 0 failures, 0 errors, 0 skips.** Run seed: `62941`; elapsed test time: 4.07 seconds. Runtime: Rails 8.1.4, Ruby 3.4.12, SQLite.

The earlier foundation milestone passed 61 tests / 380 assertions, including the coordinator rerun at seed `6774`. At that milestone `zeitwerk:check` passed and Brakeman 8.1.0 completed 79 checks with zero warnings/errors and exit 0. The coordinator repeated both checks after the final Discover CMS fix: Rails autoloading passed and Brakeman again returned zero warnings/errors with exit 0.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\script\rails.ps1 test
```

The launcher scopes Ruby, gems and temporary files to D:. `ExecutionPolicy Bypass` applies to this process only. Tests use `storage/test.sqlite3` and the test Active Storage service; they do not mutate the development database or deploy anything. Published-revision and Discover schema changes were applied separately to the test database with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\script\rails.ps1 db:migrate RAILS_ENV=test
```

Tests run with one worker to isolate SQLite writes and the deliberate CSRF configuration change. Each request test has an independent test-network login address, while the throttle test deliberately reuses one address.

## Automated coverage

- Public event list/detail show published copies; private drafts return 404. `review=1` does not authenticate a visitor.
- Password login, failed login, login throttling, preserved event-interest return, ignored external return parameters, disabled demo shortcut, logout and later mutation refusal.
- Member profile persistence and prefill; forbidden role/email/other-user assignment; current-user-scoped interest creation, update, withdrawal, invalid inputs and duplicate prevention at both validation and database levels.
- Explicitly enabled CSRF protection refuses a tokenless mutation. Administrator routes and direct create/edit/preview/publish requests reject members; administrators cannot use member-only profile/interest actions.
- Draft save, preview, edit invalidation, stale or missing editor locks, stale publish refusal, new preview, exact snapshot publication, and isolation of a published event from later private edits.
- Interest captures the published snapshot and its published revision even when a newer private draft exists.
- Required fields, supported formats/time zones, valid date/time order, text bounds, finite fee/range validation, bank details and receipt email; free publication strips hidden payment instructions.
- Image/PDF MIME-signature and size validation, supported file types, three-image limit, upload rejection before storage, signed attachment references and draft-only removal.
- Draft files return 404 to visitors and members and work for administrators. Public files must belong to the published snapshot and the event attachment association. Cross-event and invalid signed references return 404. Default Active Storage redirect/proxy routes return 404. File responses carry private/no-store headers.
- User-supplied event HTML is escaped. Paid events expose a `mailto:` draft link, send no Action Mailer message and do not change event/interest state. Free events expose no hidden payment details.

## Discover CMS and navigation coverage

The expansion adds 26 tests to the existing 61:

- Three fixed, ordered slide positions with validation and database uniqueness. The administrator sees three inline forms; create/delete routes are absent. A test database with no seeded slides renders without implicitly writing records.
- All three cards can update their tag, title, description, image alternative text and destination. Saved changes appear on the public homepage. Each card uses exactly `Click to Access Website`, opens in a new tab and includes `noopener`.
- Visitors and members cannot read or mutate the editor. Explicit CSRF protection refuses a tokenless update. Strong parameters reject attempts to change a slot, default asset or another record.
- Strict edit locks reject missing, malformed or stale tokens. Image-only and no-op saves also advance the token, preventing a previously open editor from overwriting them.
- Required text and length limits; complete HTTPS destinations with query/fragment support; refusal of script/data/relative/HTTP destinations, user information, direct/encoded controls, backslashes, malformed URLs and invalid ports. Both public output and the administrator error preview escape text and keep rejected destinations inactive.
- Valid image attachment, type/signature/size rejection, and retention of the saved image/copy on rejected uploads or fields. Rejected updates create no new blob. The current image is public through its scoped route; replaced, cross-slide and unattached references and default Active Storage routes return 404.
- Academy and Forum are absent from the menu; Shop and Jobs each carry the `DEMO` label.

An active `javascript:` link on the administrator's rejected-save preview was reproduced by a failing request test. The server now omits unsafe destinations in that response, and the regression passes.

## Carousel and browser evidence

Static inspection of `carousel_controller.js` confirms initial reduced-motion pause, pause on focus/hover/hidden document, manual Play/Pause, visibility and motion listeners, timer cleanup on disconnect, keyboard controls and announcements for manual changes. The stylesheet enforces `[hidden]` and reduces animation/transition duration for reduced motion. No additional issue was identified in these control paths by inspection.

The coordinating agent separately reports earlier browser checks of carousel Next/Pause, member login return, interest/dashboard/logout, and administrator event upload preview/edit. Those manual checks are not included in the 87 automated tests. Discover live preview/mobile browser checks are coordinated separately. This test agent did not operate the shared browser.

## Limits

This is validation of the local demonstration and its implemented Rails flows. The suite does not certify production account recovery, MFA, cross-worker rate limiting, replay revocation of previously copied cookie sessions, or a production deployment. Concurrent duplicate-interest insertion is protected by the database index; a simultaneous HTTP retry race was not exercised. Reduced-motion/visibility/focus behavior was inspected in source, not automated in a real browser. The Rails app does not register a service worker; generated PWA routes remain disabled.

The published-revision mismatch and rejected Discover preview-link issue were reproduced as failing regressions before their fixes. The latest suite validates both corrections, required edit locks and protected attachment routes. No unresolved automated failure remains.
