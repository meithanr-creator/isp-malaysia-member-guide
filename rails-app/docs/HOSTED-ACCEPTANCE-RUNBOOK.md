# Hosted acceptance runbook

> Current authority: [26 October closure ledger](PRODUCTION-CLOSURE-2026-10-26.md). The first hosted rehearsal ran and is stopped; production is NO-GO. Nine initial identity cases and a bounded database restore passed. Event upload and both hosted mobile attempts failed. Offline whole-area fixes are being verified. Statements below that say the runtime has not started are historical. The owner accepted virtual mobile scope; physical-device/native-install evidence is unclaimed and is not a new owner-action gate.

Prepared from current Rails source. This document defines required execution; it records no hosted passes. Pin the exact commit, image digest and Cloudflare deployment ID. Existing application/CI results remain regression evidence and do not close hosted gates.

## Envelope and fixtures

Use actual production-mode Rails on the selected Cloudflare application, approved Neon staging database, private `isp-staging-private` R2 and real ClamAV. Retain one instance, the US$5 ceiling and fixed shutdown deadline of at most55 minutes. Arm the independent watchdog before activation; stop around minute50. Expired HTTP admission alone does not prove stopped compute.

Keep tools, credentials and evidence on D. Restricted private files hold passwords, cookies, staging header, OTP material and tokens. Never print them, place them in arguments/Git, or capture them in screenshots. No real member data/accounts/email, domain changes or Neon upgrade.

Prepare fixtures through a private, reviewed Rails runner—never a public seed route, demo shortcut or policy exception. Before writes, verify production mode, PostgreSQL, exact approved Neon direct host/database, actual `verify-full` TLS and matching runtime encryption keys. Apply short statement/lock timeouts. Confirm mail flags and ActionMailer deliveries false. Stop on unknown or real data.

Use a unique run marker and atomic private manifest containing exact IDs, ownership, generated credentials and subsequently created blob/object keys. Create:

- Two active synthetic members with matching eligible registry entries, verification timestamps and leading-zero references.
- Separate pending, suspended, ineligible and throttle fixtures.
- Two active synthetic administrators initially without OTP enrollment or sessions.

Use clearly marked synthetic addresses under `staging.planterapp.co`; create no mailbox or DNS record. Production rejects example/test identities: preserve that rule. Fixture verification timestamps do not prove mailbox verification. Never provision the intended real administrator.

Create content/uploads through hosted forms. Use private dataset construction only where needed for51-row roster pagination. Constructed activation/reset tokens may be marked usable for fixture redemption tests, but must be labelled **constructed-token consumption**, never delivered email.

## Execution and evidence

An application visitor supplies the private `x-isp-staging-key` but has no Rails cookie. Test missing/wrong staging keys separately: edge denial is not Rails authorization evidence.

The HTTP driver loads secrets privately, maintains separate cookie jars, verifies TLS, permits only the recorded HTTPS origin and follows redirects manually. Parse actual CSRF, form actions and hidden versions. Never forward credentials to external Discover links or mailto destinations.

Bound ordinary requests20s, upload/download45s, concurrency2 and batch250 requests. Reserve ten minutes for cleanup. Never automatically retry mutations. Stream/hash downloads; keep raw responses restricted.

Each result records case, candidate/deployment, time, role alias, method/path, status, duration, assertions and independent persisted-state evidence. Use PASS/FAIL/BLOCKED/NOT RUN. Redirects alone cannot prove writes. Authorization-negative mutations need valid caller CSRF; test missing CSRF separately.

## 1. Identity, membership, administrator MFA and recovery

- Visitor GET `/member/dashboard`, `/member/membership` and protected admin routes redirects to login. Member requests to admin routes return403; administrators cannot use member-only actions. Pending MFA has no administrator access.
- GET `/events/:slug/interest/new` → `/login` → POST `/session` returns the member to that interest form. External return URLs and forged role/user fields cannot grant access.
- Wrong, unknown, pending, suspended and ineligible credentials receive generic rejection with no session. Production sample identities remain blocked.
- PATCH `/member/profile` permits only name/company/branch/phone. Forged email/role/status/ownership fields leave security state and other members unchanged. Membership shows the correct stored reference without invented tiers/CPD/renewals.
- DELETE `/session`, password/security changes, suspension, revocation and registry ineligibility invalidate captured cookies. Independently inspect server sessions. Construct expired fixture session timestamps to verify30-minute idle/12-hour absolute enforcement; label these constructed-state tests.
- Admin POST `/session` creates only a five-minute `/two-factor` challenge. Enroll using its actual protected setup key, POST current TOTP, then GET `/two-factor/recovery-codes` twice: codes appear once. Test TOTP/recovery-code reuse, cancellation and changed-state challenges.
- Age only the fixture MFA proof beyond ten minutes. Editor GET requires `/admin/verification`; save/upload/publish rejects without mutation while retaining text and original edit version. Correct password/current TOTP restores authority; copied old session loses access.
- Test throttling last: login account10/IP30 per three-minute window; MFA/step-up five per five-minute window. Verify shared Neon counters without spoofing proxy IP.
- Admin CSV workflow: POST `/admin/membership_imports`, GET returned `:public_id`, POST `/:public_id/confirm` using actual digest/version. Exact headers: `name,email,member_reference,status`. Confirm reviewed rows atomically, preserving leading zeros and omitted entries; create no accounts/email. Test collisions, malformed input, stale confirmation, expiry and other-admin preview denial. Re-eligibility must not reactivate suspended accounts.
- With mail disabled, invitation `/admin/membership_registry_entries/:id/invitation` reports disabled; `/password-recovery` remains generic and queues nothing. Constructed-token PATCH `/activation` and `/password-recovery/reset` tests expiry, replay, supersession, purpose, eligibility and single consumption. Browser fragments must populate hidden tokens then clear history.

Actual sender/SMTP/outbox delivery and human lost-MFA recovery remain blocked pending configuration/operator evidence.

## 2. Events, payment instructions, interests and roster

Admin `/admin/events/new` → POST create → PATCH `/:slug` → preview → publish must form one complete journey. Use actual `event[lock_version]`, `intent`, reviewed `revision`, images and brochure.

Verify private draft files; exact reviewed public snapshot after publication; later drafts preserve published content. Missing/malformed/stale locks or revisions cannot overwrite/publish. Re-preview after edits. Test required fields/timezones and free/paid-bank/paid-organiser transitions. Synthetic payment details must never trigger transfers/email; receipt links only prepare mailto drafts. Free published snapshots expose no stale payment fields.

Upload limits: three supported images,5MiB each; PDF brochure10MiB. Verify bytes, ownership and rejected-upload preservation.

Member POST `/events/:slug/interest` saves only current-user interest and original published snapshot. Retry and two concurrent identical requests retain one row without500. Profile/event changes preserve captured snapshots. DELETE withdraws only that member’s row.

Admin GET `/admin/events/:slug/interests` shows submitted contacts for that event,50-per-page stable ordering, correct totals, escaped content and invalid-page404. Visitor/member/pending-MFA denied. HTML roster is the scoped feature; export is absent.

## 3. Discover

GET `/admin/discover`; POST `/admin/discover/setup` creates only missing slots1–3. Repeated/concurrent setup preserves saved cards.

PATCH `/admin/discover/:id` with actual lock version: tag/title/description/HTTPS link/alt/image persist immediately on visitor homepage. Test stale versions, unsafe URLs, spoofed position/default asset, invalid upload, CSRF and stale MFA. Failures preserve previous image/copy. Current image works; replaced/cross-slide/orphan references fail.

Browser-test arrows/dots/wrapping, keyboard/Home/End, pause/focus/hover, reduced motion, announcements and exact external CTA without forwarding staging credentials.

## 4. Publications

`/admin/publications/new` → create/edit → preview → publish using actual revision/lock. Require title/description, real PDF≤25MiB and cover≤5MiB. Test scan/type/size errors and stale edits.

Member `/member/publications`, `/:slug` and `/files/:kind/:key` return exact reviewed content/hash. Drafts remain private; later drafts preserve published files until republished, then old keys fail. Visitor homepage exposes no issue metadata/cover; authenticated member homepage shows published issues. Cross-publication, wrong revision/kind and default Active Storage paths cannot bypass authorization.

## 5. Consultation

POST `/member/consultation_requests` with category/subject/message/request_key; verify current-member ownership, stable reference and own history. Retry/concurrent UUID submission retains one unchanged enquiry. Invalid/oversized fields reject; forged owner ignored; another member’s direct ID is inaccessible.

Admin index/show is private, read-only, bounded100 and shows correct enquiry/current contact. Verify escaping and no automatic email/appointment claim. Status/reply/export workflows are outside this feature.

## 6. Platform and recovery

Verify `/up` and dependency-aware `/ready`; actual runtime Neon TLS/schema; private R2 write/read/hash/delete and anonymous denial. Test real clean/EICAR uploads, integrity mismatch, scanner outage/stale definitions and dependency failure through safe private controls only. Record memory/startup/update overlap; unavailable controls mean BLOCKED.

Check trusted host/scheme/IP handling, CSRF per form family, CSP/nonces, secure cookies, no-store/no-referrer/nosniff and generic errors. Browser-test mobile layouts, keyboard/accessibility, manifest/service worker and logout/back/offline privacy. Physical iOS/Android remains open until performed.

Restore requires an approved isolated target, database+objects+historical keys and named operator. Prove restored journeys/hashes and compatible-image rollback; otherwise keep blocked.

Cleanup exact manifest-owned enquiries/interests/imports/content/blobs/registry/accounts, revoke sessions/tokens, conditionally restore Discover and independently verify absence. Never global-delete/purge/reset. Stop the concrete container, verify no running/starting instances and record cost.

Fix complete affected areas. Retest shared-control dependents and whole affected journeys; preserve unchanged-area evidence. Changed authentication/storage/runtime requires broader retesting. No mock or local pass substitutes for hosted execution.

Owner-accepted mobile scope (26 October 2026): use virtual environments. Record actual WebKit and Chromium engine versions with iPhone and Android profiles, responsive layouts, navigation, forms, sign-in and PWA browser behavior. Physical-device and native home-screen installation are outside this acceptance scope and must not be claimed as passed or introduced as a new owner-action requirement.
