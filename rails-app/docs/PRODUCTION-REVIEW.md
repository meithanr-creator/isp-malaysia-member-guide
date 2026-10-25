# Production director review and release evidence

Date: 25 October 2026 (Asia/Kuala_Lumpur). Reviewer: Astra. Project: `D:\Projects\isp-member-rails`. Companion plan: `docs/PRODUCTION-PLAN.md`.

**Decision: NO-GO for production activation, public hosting or real member data.** Bounded local production-hardening work may proceed. No provider, cost, identity source or go-live decision is inferred from this review. Shop and Plantation Jobs remain frozen demos.

## Review basis and provenance

Initial independent source review inspected PLAN.md, RELEASE-CHECKLIST.md, DIRECTOR-REVIEW.md, OPERATIONS.md, TEST-REPORT.md, routes, Gemfile, production/database/storage configuration, sessions/account guards, seed protection, event-interest handling, log filters and event/publication download boundaries.

The coordinator reported baseline GitHub commit `3673fe30e842cd987b9827c669493b58d89c0e91` on `rails-member-events`, source under `rails-app/`. This review did not independently verify that remote commit or claim that the mutable local tree still equals it. The delivery coordinator must record the exact candidate revision after integration.

The existing TEST-REPORT.md records **124 tests / 984 assertions, no failures/errors/skips**, Rails 8.1.4 / Ruby 3.4.12 / SQLite, plus autoloading and Brakeman results. Those are prior local demonstration evidence. This director did not rerun that baseline suite, and those results do not certify new hardening, PostgreSQL, hosted storage, email, scanning or MFA.

## Initial risk register

These findings describe the inspected baseline. Changes under implementation must be independently reviewed and evidenced before a finding is marked closed.

| ID | Priority / finding | Baseline source evidence | Required closure |
| --- | --- | --- | --- |
| R1 | Release blocker: identity authority and account lifecycle absent | User has password and member/admin role; no verification, activation, recovery, MFA or account state. | Owner-approved identity source and lifecycle; working activation/recovery/admin MFA with negative tests and operational recovery ownership. An `active` flag alone does not verify membership. |
| R2 | Release blocker: session replay/revocation and throttling limits | ApplicationController trusts cookie `user_id`; SessionsController uses per-process MemoryStore. Cookie store already has a 12-hour expiry, SameSite=Lax and production Secure, but no server session record or revocation check. | Server-checked expiry/revocation and state/privilege change handling; shared throttle tested under deployed concurrency/proxy behavior. |
| R3 | Release blocker: sample identities can survive copy/import | Seeds raise in production and demo shortcut is disabled, but normal password login does not reject copied sample users. | Production login and bootstrap guards, clean database provisioning and sample-data absence evidence. Do not migrate the development database. |
| R4 | Release blocker: production configuration is a template | database.yml has incomplete SQLite production entries; production.rb uses local Disk storage, example.com mail links and commented allowed hosts. | Fail-closed configuration checks plus approved PostgreSQL/private storage/mail/domain deployment and runtime tests. Passing config checks alone does not close R1/R5. |
| R5 | Release blocker: uploads lack quarantine/scanning | LocalFileValidator and PublicationFileValidator check short file signatures; upload services immediately store files. No scan-state gate exists. | Private object storage, quarantine states, scanner/image processing, outage/retry tests and publish/serve denial until accepted. Magic bytes are not malware scanning. |
| R6 | High: sensitive request data can enter logs | Filter list covers passwords/email/tokens but omits enquiry subject/message and profile/payment fields. | Redacted real request/error log evidence retaining useful diagnostics; approved retention/access policy. |
| R7 | Medium: simultaneous interest creation can raise | Controller finds/initializes then updates; unique index prevents duplicates but no race recovery. | Consistent retry-safe result and preserved original published snapshot; meaningful concurrency coverage on the deployment database. |
| R8 | Medium: event brochure served inline | EventFilesController serves all accepted content inline; library PDFs already use attachment. | Safe event PDF disposition/content headers and role/revision regression tests. This does not substitute for R5. |
| R9 | Release blocker: operations and data stewardship unproven | No selected host/domain/mail/scan service, measured backup restore, incident rehearsal or live-data retention approval. | D3–D7 owner decisions and staging evidence in the production plan. |
| R10 | Release blocker: release evidence is local only | Current test suite uses SQLite; responsive Chromium evidence does not cover physical mobile devices or assistive technology. | Candidate-specific PostgreSQL/staging, security, device, accessibility and operational acceptance. |

## Bounded implementation directed this turn

- Identity agent: pending-by-default account state; server-side hashed sessions; idle/absolute expiry; logout and password/role/state revocation; production sample-identity refusal; database-backed throttles; regression tests. Proposed 30-minute idle and 12-hour absolute limits are engineering defaults pending D2 confirmation, not an organizational policy decision.
- Platform agent: provider-neutral production configuration, packaging, preflight/runbook and a bounded synchronous fail-closed scanner before storing uploads. Scan provenance and publish/serve checks are required; historical unscanned blobs must not be trusted. Hosted detection/outage/freshness evidence remains pending. Configured credentials or an environment acknowledgement must never imply that unimplemented MFA, membership verification or upload scanning exists.
- Coordinator: interest race handling, safe PDF response headers, integration and source delivery.
- Director: gated plan and independent review. No application feature expansion, provisioning or commit by this director.

Updated owner direction: the membership authority is an administrator-uploaded list, and rvrameshveloo@isp.org.my is the intended first administrator/company and invitation/recovery contact. Native Rails invitations/recovery and administrator TOTP are now the recommended implementation path; no identity-provider wait is needed for safe development. Admin MFA remains mandatory before activation. Review must cover enrollment confirmation, recovery codes, token replay prevention, step-up authentication and audited reset as one complete lifecycle. No real account or outbound email is authorized by this review. The import/identity brief is in PRODUCTION-PLAN.md.

## Milestone status

| Milestone | Current status | Evidence required to pass |
| --- | --- | --- |
| P0 Scope/governance | Plan prepared; owner decisions pending | Accepted bounded scope and D1–D7 responsibility/approval register; verified candidate provenance. |
| P1 Identity/security | Bounded local hardening in progress | Independent tests for implemented controls, plus selected identity verification/recovery/admin MFA before full P1 acceptance. |
| P2 Infrastructure/private uploads | Configuration preparation in progress; infrastructure not approved/provisioned | Chosen-host PostgreSQL/private storage/scanning/mail tests; restore, secrets and alert evidence. |
| P3 Staging acceptance | Not started | Exact candidate/build tested on selected services; mandatory security/device/operational evidence with no unresolved critical/high defects. |
| P4 Pilot/go-live | Blocked by preceding gates and owner approval | Named pilot, real-data authorization, accepted evidence and explicit owner release decision. |

## Candidate evidence register

| Evidence | Status | Source / outcome |
| --- | --- | --- |
| Baseline local Rails test/static checks | Prior evidence only | TEST-REPORT.md, M7: 124 tests / 984 assertions; no claim about new changes. |
| New hardening source review | Pending integration | Await completed identity/platform/coordinator changes. |
| New independent test run | Pending | Must record exact tree/commit, command, runtime/database and raw result location. |
| Production config failure cases | Pending | Missing/unsafe values rejected; no live service is created by tests. |
| PostgreSQL migrations and concurrent requests | Not run | Local SQLite assertions cannot establish PostgreSQL behavior. |
| Identity email, admin MFA and recovery | Not implemented/evidenced | Await approved identity strategy. |
| Private hosted uploads and scan failure modes | Local implementation in progress; hosted evidence absent | Await approved storage/scanning architecture. |
| Physical mobile and assistive-technology acceptance | Not run | Prior desktop responsive screenshots are not device certification. |
| Backup restore, rollback, alerts and incident exercise | Not run | Requires approved staging/operations. |
| Pilot and owner go-live decision | Not given | No release approval. |

## Release review procedure

Each evidence entry must identify exact candidate commit/build, environment, operator/tester, date, procedure and artifact location; distinguish source inspection, local execution and hosted observation. Record failures and limitations. Security changes reopen affected checks. Independent review may accept an implemented local increment while the overall release remains NO-GO.

The director's technical recommendation is separate from the owner's approval to provision, spend, import real data, send real emails or launch. Filesystem permission to write on D is neither. A production preflight should report missing controls truthfully and must not offer a cosmetic switch that certifies unimplemented security.

For Shop/Jobs, preserve the frozen demo implementation. Before live navigation is finalized, ask the owner whether to hide those external demo references or keep conspicuous DEMO labels; a navigation/configuration choice must not expand the demos into production features.


## Owner clarification and next implementation boundary

The owner selected an administrator-uploaded membership list as the authority, supplied `rvrameshveloo@isp.org.my` for the initial administrator/company and invitation/recovery contact, and declined purchasing a domain for now. The proposed hosted mobile experience can use the selected provider HTTPS address and a home-screen shortcut; Render's provider address is an option awaiting host/budget approval. This does not establish email-sender verification, a deployment or a native mobile application.

D1/D2/D4 are partially resolved, not fully closed. Develop the reviewed CSV import with synthetic records, then the Rails invitation/recovery/TOTP lifecycle. Do not send real emails, provision the named account, import a real membership list or incur hosting charges in this increment. The CSV proposal is `name,email,member_reference,status`, with eligibility separate from account activation. Preview, conflict review, exact confirmation, atomic/idempotent commit and audited eligibility changes are mandatory; role assignment and automatic activation are excluded.

Overall release decision remains NO-GO. Identity and import code require independent tests and source review; mailbox ownership, email delivery, actual deployment services, operational recovery and the remaining P0–P4 evidence still need completion.
