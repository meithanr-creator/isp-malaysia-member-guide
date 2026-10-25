# Phase 2 Rails test report

Date: 25 October 2026. Target: the local Rails project at `D:\Projects\isp-member-rails`.

## Executed result

Coordinator final rerun after GET/HEAD handling correction: **61 tests / 380 assertions passed**, seed `6774`. `bundle exec rails zeitwerk:check` passed. Brakeman 8.1.0 completed 79 checks with **zero warnings and zero errors**. Windows reported unsupported `Process.fork`, but the scanner completed successfully with exit 0.

**61 tests, 380 assertions, 0 failures, 0 errors, 0 skips.** Final run seed: `2256`; elapsed test time: 2.12 seconds. Runtime: Rails 8.1.4, Ruby 3.4.12, SQLite.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\script\rails.ps1 test
```

The launcher scopes Ruby, gems and temporary files to D:. `ExecutionPolicy Bypass` applies to this process only. Tests use `storage/test.sqlite3` and the test Active Storage service; they do not mutate the development database or deploy anything. The new published-revision migration was applied separately with:

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

## Carousel and browser evidence

Static inspection of `carousel_controller.js` confirms initial reduced-motion pause, pause on focus/hover/hidden document, manual Play/Pause, visibility and motion listeners, timer cleanup on disconnect, keyboard controls and announcements for manual changes. The stylesheet enforces `[hidden]` and reduces animation/transition duration for reduced motion. No additional issue was identified in these control paths by inspection.

The coordinating agent separately reports browser checks of carousel Next/Pause, member login return, interest/dashboard/logout, and administrator upload preview/edit. Those manual checks are not included in the 61 automated tests. This test agent did not operate the shared browser.

## Limits

This is validation of the local demonstration and its implemented Rails flows. The suite does not certify production account recovery, MFA, cross-worker rate limiting, replay revocation of previously copied cookie sessions, or a production deployment. Concurrent duplicate-interest insertion is protected by the database index; a simultaneous HTTP retry race was not exercised. Reduced-motion/visibility/focus behavior was inspected in source, not automated in a real browser. The Rails app does not register a service worker; generated PWA routes remain disabled.

The published-revision mismatch was reproduced as a failing regression before the fix. The final suite validates that correction, required edit locks and protected attachment routes. No unresolved automated failure remains.
