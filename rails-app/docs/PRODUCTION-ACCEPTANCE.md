# Astra production acceptance direction

Recorded 26 October 2026 (Asia/Kuala_Lumpur).

**Director decision: continue towards full production acceptance. Production release remains NO-GO.** Preparation has passed several concrete checks; the deployed application has not yet undergone functional acceptance.

The accepted source candidate is `c9a5142bd8c949c6415c3639c0113ee015f9a3f4`, with all six CI jobs passing. Recorded execution establishes:

- Neon certificate-verified TLS, database migrations and local Rails persistence.
- Direct private R2 authenticated HEAD/PUT/GET, byte integrity, anonymous authentication rejection, deletion and confirmed absence.
- Successful image-only Cloudflare build `7df5ce3e-a847-4533-8ca0-a7bfc6d546e8`, producing digest `sha256:0187a1e32351a3f7a8f9c87a48798c0adf31f3b6c4116309c78f638582700cd2` from that candidate.
- Nineteen passing operations/watchdog helper tests.

These are accepted within their demonstrated boundaries. The image build did not deploy or start Rails. Direct R2 success does not close the Rails upload/download pipeline. Helper tests do not establish actual hosted shutdown. The final staging guard remains subject to source review.

**The next gate is deployment safety and actual production-mode startup:** finish and review the guard, publish its exact source, run its affected checks, and deploy using the recorded image digest. Verify the private access gate, fixed deadline, independent stop control, production configuration, database TLS, readiness and running-image identity before functional assessment.

The acceptance plan covers six complete areas:

| Area | Required closure evidence |
| --- | --- |
| **Membership and login** | Eligibility/import preview and confirmation; duplicate/collision rejection; no implicit activation or admin grant; actual login, logout and revoked-cookie refusal; member/admin separation; TOTP enrollment, replay rejection, recovery-code consumption and sensitive-action verification; activation/recovery token failures and session revocation. Actual email delivery remains a separate open dependency. |
| **Events** | Admin draft/edit/preview/publish, stale-edit conflict, public visibility and immutable published details; member interest create/retry/concurrent duplicate/withdraw; protected roster; scanned files and stale/foreign-file denial. Confirm no false booking, payment or email claims. |
| **Discover** | Missing-card setup without overwriting existing content; authorized editing, validation and conflict handling; correct public rendering; safe links; scanned image replacement and prior-file protection. |
| **Publications** | Draft/preview/publish and conflict handling; actual clean cover/PDF uploads; scanner rejection and failure behavior; authenticated library/downloads; correct content hashes; guest, foreign-record and superseded-file denial. |
| **Consultations/enquiries** | Valid submission, invalid input, retry handling, member list/detail and admin inbox; cross-member denial; protected content/logging; accurate wording without promising an appointment or delivery. |
| **Platform and release** | Landing/About/contact/PWA, production assets, HTTPS/host/proxy controls, secure cookies, CSRF/CSP, no private caching, scanner/storage/database failure handling, restart persistence, restore/rollback, resource/load measurements, accessibility, mobile devices and verified shutdown. |

Shop and Plantation Jobs are frozen DEMO references and excluded from functional acceptance. Academy and Forum remain removed.

Shared controls—authentication, authorization, CSRF, input handling, audit, file provenance, storage, caching, session revocation and error handling—must have a coverage map across every affected area. Each assessment records positive, permission-denial, invalid-input, failure/recovery and responsive/accessibility cases with explicit expected outcomes.

Fixes must address the **whole affected area and shared root cause**. Do not close an area after repairing one visible symptom. Inventory related entry points, correct the common cause, run regression cases across its dependants, then record remaining exceptions.

Milestone disposition:

1. **Source and dependency preparation:** accepted for the recorded candidate and checks.
2. **Safe hosted deployment:** open; this is the immediate priority.
3. **Six-area hosted acceptance:** not run.
4. **Recovery, delivery, devices and operations:** open where evidence or concrete decisions are missing.
5. **Production release:** requires demonstrated closure and Astra’s review; no autonomous launch.

Run acceptance against the actual hosted production configuration and services using controlled test accounts/files; no real membership import is authorized. Preserve normal security and scanner behavior. Retain the **US$5 total ceiling**, fixed **55-minute gated window**, and verified shutdown before one hour. Prepare cases before activation; unfinished cases remain open.

Passed evidence carries forward for the **unchanged candidate, configuration, services and tested conditions**. There is no blanket requirement to repeat every test later. Relevant changes reopen only affected areas and shared dependants; repairs require reproduction and regression evidence. New mail, domain, identity, storage or deployment configuration requires its integration checks. Local, mocked or emulated results cannot close unobserved hosted behavior.

Production conditions still include approved identity delivery, measured restore and rollback, actual device/accessibility evidence, appropriate capacity expectations, operational ownership and owner-ready domain cutover. Missing conditions must remain explicit—not converted into passes to finish within the testing window.