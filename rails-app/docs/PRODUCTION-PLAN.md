# Production transition plan

Updated: 26 October 2026 (Asia/Kuala_Lumpur). Director/reviewer: Astra. Implementation and independent testing: GPT-6.1 Sol, extra-high reasoning. Project and artifacts: `D:\Projects\isp-member-rails`; runtime/tooling: `D:\Projects\isp-rails-tools`. Repository: `meithanr-creator/isp-malaysia-member-guide`, Rails source under `rails-app/`. Reported handover baseline: `rails-member-events` at `3673fe30e842cd987b9827c669493b58d89c0e91`; the coordinator must verify the remote head before delivery.

**Release status: APPLICATION BASELINE ACCEPTED; operational NO-GO for production or real member data.** The owner has selected Cloudflare and authorized continued production preparation. Source 1ebd6a5b3a6fba7da72141f8934f713963b761ac passes the recorded application CI. Astra has accepted the corrected Worker adapter and Rails/ClamAV packaging at source level; their exact-candidate Linux build and real scanner validation remain pending. Neon Free is approved for synthetic staging only, with sign-in pending. Runtime/database costs and permissions, credentials/mail, owner-deferred DNS work and real-data/operational arrangements remain concrete dependencies; this plan creates no additional blanket approval checkpoint.

## Scope and operating rules

Ruby on Rails remains the implementation framework. Retain public landing/events; authenticated member profile, event interests, publication library and enquiries; administrator events, Discover, publications and enquiry inbox. Interest is not a confirmed booking or verified payment. Enquiries do not promise an appointment or automatic email. Receipt links open the user's email application; the app cannot prove sending, delivery or payment.

Shop and Plantation Jobs are frozen, visibly labelled DEMO references. No new functionality, integration or production expansion of either is included. Final live-navigation treatment (hide demo references or retain conspicuous DEMO labels) is an owner decision; preserve the frozen implementation either way. Academy/Forum, dues/renewals, verified membership tiers, capacity/waitlists, payments and automated financial reconciliation are not silently added. The broad future-domain descriptions in PLAN.md are specifications/options, not evidence that those features exist or are required for this release.

All project, runtime, generated test evidence and working artifacts stay on D. Tool permission to write on D is a filesystem execution approval only. It is not permission to purchase hosting, select an identity authority, import member data or launch. Product/operational approvals require named owner decisions recorded separately.

Use a dedicated production-hardening feature branch and reviewed pull request for delivery. Preserve the existing static demonstration and frozen surfaces. Do not copy development databases, uploads, credentials or sample accounts into a hosted environment. Record the exact commit/build and environment for every release claim.

## Decision register — resolved choices and remaining dependencies

| ID | Decision | Required output | Blocks |
| --- | --- | --- | --- |
| D1 | Member authority and lifecycle — partially decided | Owner selected an administrator-uploaded membership list as authority. Build a reviewed import and Rails invitation workflow; exact columns/status semantics, real-data import authorization and operational verifier remain to confirm. | Live import and member activation. |
| D2 | Administrators and recovery — partially decided | Owner named rvrameshveloo@isp.org.my for the first administrator/company account, invitations and recovery contact. Recommend Rails-managed TOTP with tested recovery. Mailbox verification, bootstrap authorization, emergency recovery ownership and session durations remain to confirm. | Administrator production access. |
| D3 | Cloudflare selected; runtime setup open | Owner selected Cloudflare; no existing ISP server. Existing Workers Paid is active. isp-member-production has GitHub connected with builds/public URLs disabled. Empty private Standard R2 isp-staging-private (APAC) exists without public URL, credentials or uploads. External PostgreSQL, runtime resource/cost allowance, credential destinations/permissions, staging isolation and operations owner remain open. Earlier VPS proposals are superseded comparisons. | Runtime/database/credential provisioning and the isolated staging rehearsal; not hosting-provider selection. |
| D4 | Domain and mail — partially decided | Owner has purchased planterapp.co through GoDaddy and will change nameservers when ready. The domain decision is confirmed; DNS verification, TLS/cutover, host mapping and any nameserver change remain pending. Contact: rvrameshveloo@isp.org.my. Mailbox ownership, approved sender/provider, sending permission and delivery setup remain pending; purchasing a domain does not verify a mail sender. | DNS cutover, hosted links and identity email delivery. |
| D5 | Data stewardship | Approved fields, privacy notice, retention/deletion rules, publication rights, enquiry handling owner, incident/support contacts, backup recovery-time and recovery-point objectives. | Real personal data and publication uploads. |
| D6 | Content and bank details | Approved live events/Discover destinations; confirmation that receipt-by-email remains the process; authorized bank details/inbox and finance owner if paid events are enabled. | Public content and paid events. |
| D7 | Pilot and launch | Named pilot cohort, acceptance window, support coverage, rollback authority and release record referencing the existing production intent and the resolved concrete setup decisions. | Pilot activation and public release. |

Cloudflare provider selection is complete. The existing paid plan, reserved ISP Worker project and empty private staging R2 bucket do not establish an allowance for additional runtime/database usage or permission to create arbitrary credentials. Resolve the concrete rehearsal cost/resource and secret-destination requirements before dependent actions. No Rails runtime, external PostgreSQL or runtime credentials exist yet. Keep the owner-deferred domain/DNS step separate. Continue authorized reversible implementation/testing without requesting another generic hosting or milestone approval.

## Milestones and objective exit gates

### P0 — Scope, ownership and evidence baseline

Owner: coordinator and project owner; reviewer: Astra.

- Confirm this bounded scope, freeze Shop/Jobs, and reconcile production language with actual implemented behavior.
- Record D1–D7 decisions with person/date/status. Unknown choices remain explicitly pending.
- Verify current remote branch head and identify a production feature branch. Preserve source and migration rollback references.
- Inventory routes, data categories, roles, storage boundaries, runtime and dependency versions; record current test/security results with exact source revision.

Exit: scope and responsibility register accepted; unresolved decisions have named owners; baseline evidence is reproducible. P0 alone grants no release authorization. Provider-neutral P1 work can proceed before all owner decisions close.

### P1 — Identity, authorization and application hardening

Owner: Sol implementation agent; independent Sol tester; reviewer: Astra. Identity activation depends on D1/D2/D4.

Safe immediate work:

1. Block known fictional sample identities from production password login as well as demo shortcuts/seeding. Add a fail-closed production preflight with actionable missing-configuration errors; avoid a single boolean that implies all gates are satisfied.
2. Add account state and server-checked session invalidation. Enforce approved idle/absolute deadlines, rotate on login, invalidate on logout and relevant password/role/account changes. Test replay of a captured old cookie, revoked/disabled users and stale privilege changes. Existing 12-hour cookie expiry alone is insufficient evidence of server-side revocation.
3. Replace per-process login throttling with an explicitly configured shared store before multi-process deployment. Test failure/retry behavior and trusted proxy/client-IP handling on the chosen host.
4. Handle duplicate event-interest races without duplicate rows or an unhandled error; preserve the first published event snapshot and ownership checks. Verify both database and HTTP behavior, including PostgreSQL concurrency before claiming cross-worker coverage.
5. Filter enquiry bodies/subjects and profile/payment details from routine logs; retain useful request/error identifiers. Verify real log output, not only a configured filter list.

Identity direction after owner clarification: implement native Rails invitations, recovery and administrator TOTP. The membership list supplies eligibility; a verified invitation supplies control of the account email. Neither an imported row nor a technical active flag is sufficient by itself.

Complete before identity activation:

- Implement the chosen invitation/verification/recovery flow with single-use expiring tokens, generic responses and delivery/error handling. Revoke compromised credentials/sessions. No public claim of a membership identity based only on an entered membership number.
- Require administrator MFA and a tested recovery path. Protect privileged bank/inbox changes with re-authentication and auditable attribution; add a second reviewer only if the finance owner requires it.
- Preserve CSRF, own-record/role checks, safe return paths and escaped output. Test direct endpoints, forged ownership, unauthenticated access and stale session cases.
- Define an audit record for account/role changes and publishing/financial instructions: actor, target, action/revision, outcome and time, without secrets or enquiry contents. Assign access and retention.

Exit: independent negative and positive tests pass for implemented controls; identity/recovery/MFA are exercised end-to-end against the selected approach. Partial hardening is labelled partial. No MFA, email verification or account recovery claim is permitted from placeholder configuration.

### P2 — Infrastructure, private uploads and recovery

Owner: coordinator/Sol, infrastructure owner; reviewer: Astra. Cloudflare is selected. Reserved project/private staging storage are created; additional runtime/database/credential actions depend on the concrete D3/D4/D5 requirements.

- Configure PostgreSQL and apply migrations on a fresh database. Separate staging/production databases and credentials. Ensure any cache/queue services actually used are provisioned/configured and tested; unused template entries are not an operating architecture.
- Set required secrets, allowed hosts, canonical HTTPS origin, secure cookies, proxy trust, mail links and private storage. Reject missing/unsafe configuration. Keep secrets outside source and logs.
- Use private hosted storage with no anonymous bucket/blob access. Preserve current revision and attachment-ownership checks for event, Discover and publication files; member library objects remain authenticated.
- Scan all upload paths before acceptance. A bounded synchronous scanner before storage is acceptable; asynchronous scanning requires private quarantine and explicit pending/accepted/rejected/error states. Pending, failed, rejected or unavailable scanning must not publish or serve an upload. Record the verdict, scanner/signature version, time and file hash against the exact stored bytes, and enforce accepted provenance at publication and delivery. Historical unscanned local blobs must not be imported as trusted. Validate type/size; re-encode accepted images in a tested environment; define PDF handling. Existing magic-signature checks are input validation, not malware scanning.
- Test scanner timeout, outage, stale definitions, rejected/unknown responses and detection using a safe test fixture. For synchronous scanning, bound upload/request duration and resource use; test worker retry/restart only if an asynchronous worker is selected. Scanner reachability alone is not detection or freshness evidence. Select safe file disposition/content headers and bounded transfer behavior. Verify expired/superseded/cross-record references cannot bypass access rules.
- Centralize redacted errors and actionable availability/worker/scan alerts. Configure backups for database and required object versions, retention and least-privilege access.
- Restore a backup into an isolated environment and record elapsed restore time, recovered data timestamp and representative attachment integrity. Test application/build rollback and forward-compatible migration handling; never assume restoring a database is a routine lossless rollback.

Exit: infrastructure and storage evidence comes from the selected staging environment; fresh migration and measured restore pass against D5 objectives; failure modes fail closed. Production services and charges are created only with owner approval.

### P3 — Staging acceptance and release rehearsal

Owner: independent Sol tester plus named ISP reviewers; reviewer: Astra.

Use synthetic accounts/data first. Pin the candidate commit/build, migration version, configuration inventory and test environment. Run critical journey and adversarial coverage on PostgreSQL and the chosen storage/cache/mail/scanner services (and workers if used):

- Visitor landing, Discover and published events; hidden drafts and guest library metadata; disabled demo entry and absence of sample accounts/content.
- Member activation/login/recovery, profile allowlist, interest create/retry/withdraw, own enquiries and published library reads; logout/revocation and cross-member denial.
- Administrator MFA/recovery, direct endpoint authorization, editor version conflicts, exact preview/publish, immutable published snapshots, stale/cross-record file rejection and private cache behavior.
- Upload quarantine, scanner outage/retry, rejected files, storage permission checks and safe downloads. No real mail recipients, financial transfers or production data in synthetic tests.
- Security/dependency scans, CSRF, distributed throttling, escaped output, concurrency and secrets/log review. Record tool versions and results; a clean static scan does not prove runtime security.
- Real iOS Safari and Android Chrome, keyboard navigation, focus, zoom/reflow and representative assistive-technology checks on the actual candidate. Responsive Chromium screenshots remain useful evidence but do not substitute for devices.
- Availability and reasonable load for the agreed pilot, backup restore, monitoring alert delivery and rollback/incident rehearsal.

Exit: no unresolved critical/high security, authorization or data-loss defect; all required journeys pass; remaining lower-risk issues have owner, impact and explicit acceptance. Every gate links to evidence for the candidate, not an older local result. Failed or unperformed mandatory tests keep the milestone open.

### P4 — Controlled pilot and go-live

Owner: project owner and named operational/identity/content owners; final technical recommendation: Astra.

- Review the evidence pack and owner decisions. Approve the pilot cohort and real-data handling explicitly; create least-privilege accounts via the approved identity process.
- Pilot with agreed duration and success criteria. Confirm support triage, recovery, publication rights/content, receipt wording and operational alerts. Record incidents and retest changes.
- Before public activation, record that the exact candidate and environment satisfy the technical gates and the owner-authorized setup, referencing existing production intent plus concrete host/cost and other necessary decisions. Do not ask for a duplicate generic confirmation solely because a milestone is complete. Confirm rollback owner, latest backup, service readiness and post-launch checks.
- Check public/member/admin boundaries after activation, confirm health/alerts and rollback if a security, privacy, data-integrity or severe availability gate fails. Any observation period or recurring monitoring must be explicitly arranged; this document does not create unattended automation.

Exit: release record linking existing owner intent and the resolved concrete setup decisions, plus environment/deployment ID, candidate commit and completed operational evidence. A passing local suite, documentation, accepted filesystem permission or provisioned server is never a substitute.

## Evidence pack and change control

For each gate, record: requirement ID; status (not started/in progress/passed/failed/blocked); implementer; independent tester; exact commit/build; environment/runtime; test command or procedure; dated outcome and artifact location; residual risk; approver/date. Store synthetic/redacted artifacts under `D:\Projects\isp-member-rails\audit` and link them from PRODUCTION-REVIEW.md. Never commit secrets, live personal data, private publications or raw identity tokens.

Reopen affected gates after security, schema, deployment configuration or identity changes. Verify the expected remote head before updating GitHub; retain the previous deployable build and documented rollback path. Astra's technical recommendation and the project owner's deployment approval are separate decisions.



## Bounded membership import and native identity implementation brief

Owner clarification: membership authority will be a list uploaded by an administrator. The first administrator/company and invitations/recovery contact is `rvrameshveloo@isp.org.my`. This records an intended identity, not a provisioned account, verified mailbox, approved mail sender or authorization to send messages. The owner subsequently purchased planterapp.co through GoDaddy. DNS/nameserver changes are deferred until ready. Cloudflare is selected; additional runtime/database costs, credentials and operational arrangements remain open.

### Import UI and registry — safe to build with synthetic data

Suggested CSV header: `name,email,member_reference,status`. Proposed status values are `eligible` and `ineligible`; these express access eligibility only, not payment, renewal, tier or account activation. Confirm this mapping with the owner before a real import. Keep membership references as strings so leading zeros survive. Normalize email for uniqueness; do not invent or repair missing identities.

Use a separate membership registry linked to a user only through the approved activation process. The upload UI must never accept administrator roles or a password column. A confirmed import creates/updates registry data; it does not automatically create active users, grant an administrator role or send invitations.

1. Admin-only upload with server-side UTF-8 CSV parsing, a proposed 2 MB / 5,000 data-row limit, required exact headers, bounded fields, and strict allowed status values. Reject malformed files, duplicate headers, invalid encoding and invalid rows. Treat formula-like values as text; never evaluate them. Apply safe spreadsheet-cell escaping if an export is later introduced.
2. Show an escaped, private/no-store preview with row numbers, additions, updates, unchanged rows, invalid values, duplicate email/reference and existing-record identity conflicts. Do not store the CSV in a public file location or log its contents. Use short-lived private preview storage and approved retention.
3. Confirm the exact server-held normalized preview/digest and registry version, with CSRF and administrator authorization rechecked. Revalidate inside the transaction; reject stale previews or conflicts and require a new preview. An all-or-nothing import has no hidden partial success. Replaying a confirmed import returns its recorded result rather than duplicating records.
4. Database uniqueness applies to normalized email and member reference. A reference paired with a different existing email, or an email paired with a different reference, is an identity conflict requiring separate review; never silently reassign an existing user or merge histories. Reject collisions with administrator identities. For a matching email/reference, a reviewed name/status update may proceed.
5. Record importer, time, digest/import ID, counts, target references and before/after eligibility changes in an access-controlled audit. Omit passwords/tokens and raw CSV bodies. Ineligibility must deny linked-member access and revoke sessions; becoming eligible must not automatically restore a suspended account or activate an unverified invitation.

Local acceptance: synthetic CSV cases cover validation, size/row limits, leading zeros, normalization, duplicate/collision rejection, authorization/CSRF, exact-preview stale/replay behavior, atomic failure and zero mail deliveries/active-account grants. Real CSV ingestion remains subject to D1/D5 authorization and privacy handling.

### Invitations, recovery and administrator MFA — next bounded identity milestone

- Invitation is a separate explicit administrator action for an eligible registry entry. Use a cryptographically random token stored only as a hash, bounded expiry and one-time transactional consumption; bind it to the intended email/reference and purpose. Reissue revokes the previous token. Check current eligibility at invitation issue and redemption. Accepting the token verifies control of the invited mailbox and lets the member set a password; only then activate the permitted member account. Never expose usable tokens in routine logs or admin previews.
- Recovery uses generic responses, throttles and expiring single-use purpose-specific tokens. Consuming a recovery token revokes other recovery tokens and existing sessions; suspended/ineligible users cannot regain access through recovery. Mail delivery failure must be visible to operators without leaking account existence to requesters. Use intercepted mail for local tests; do not send to the named real address during development.
- Administrator access requires password plus TOTP. Keep enrollment provisional until a valid code is confirmed; protect the TOTP secret with application encryption and an independently managed secret. Enforce a narrow time window, attempt throttles and replay prevention. Issue high-entropy one-use recovery codes stored hashed and shown only at creation. Reset/disable must require a documented audited recovery/step-up process, not an unauthenticated email request. A reset returns the administrator to required enrollment, never an MFA bypass.
- Bootstrap the named first administrator separately from member CSV. Prepare a one-time, auditable setup process and test with fictional addresses. Do not provision the actual account, email tokens or set a known/default password now. Before real bootstrap, verify the mailbox/control process and confirm authorized recovery ownership.
- Keep 30-minute idle / 12-hour absolute sessions as proposed defaults pending D2 acceptance. TOTP completion must rotate the session, bind MFA completion to its server record and prevent password-only sessions from reaching any admin endpoint. Require step-up for MFA/security reset and privileged bank/inbox changes.

Independent acceptance must exercise successful journeys and forged, expired, reused, superseded and concurrent tokens; eligibility changes during redemption; generic recovery responses; MFA enrollment/replay/recovery-code races; session revocation; and all direct administrator routes. Passing local intercepted-mail tests is not evidence of delivered production email or functioning hosted MFA operations.

## Accepted application baseline and current infrastructure work

Application source **1ebd6a5b3a6fba7da72141f8934f713963b761ac** on production-readiness / [PR #1](https://github.com/meithanr-creator/isp-malaysia-member-guide/pull/1) is accepted for the bounded hardening scope. [Push CI 40210298196](https://github.com/meithanr-creator/isp-malaysia-member-guide/actions/runs/40210298196) passed: Linux SQLite 277 tests / 2,231 assertions, zero failures/errors and two PostgreSQL-only skips (seed 35658); Linux PostgreSQL 17, 277 / 2,269, zero failures/errors/skips (seed 16921). Autoloading, Brakeman and refreshed dependency advisories passed. The container image build/configured non-root check passed; that does not prove hosted runtime boot. Evidence: audit/cloudflare-project-ci.txt and PRODUCTION-REVIEW.md. Earlier focused/local/CI counts are historical, not additive, and do not leave current baseline CI pending.

Accepted controls include server-side sessions/shared throttles, registry import, activation/recovery tokens, admin MFA/operator reset, fresh privileged verification, transactional publishing/Discover audit, fail-closed scans and file provenance, bounded uploads, safe editor conflict recovery, scoped read-only interest roster, CSP and network-only mobile service worker. Scoped PostgreSQL fixture cleanup corrections preserve production throttling and audit constraints. Source acceptance does not certify actual mail, private storage, scanner operation, restore or devices.

Cloudflare is the selected platform, with GitHub source/review/CI, Containers for Rails, external durable PostgreSQL and private R2. The earlier VPS proposal is only a superseded comparison. The existing account already has Workers Paid. isp-member-production is connected to production-readiness with automatic builds and public/preview URLs disabled; no domain/cron/runtime secrets have been added. Empty Standard R2 isp-staging-private in APAC is private, with no public URL/custom domain, credentials or uploads. These are preparation resources, not a deployed Rails service. No runtime container or external PostgreSQL is provisioned.

The platform implementer owns cloudflare/ Worker adapter/tests; the identity implementer owns deployment/cloudflare/ Rails plus local clamd packaging; the coordinator owns provider/database/R2 feasibility, credentials/permissions and preparation. The corrected adapter/scanner source review is accepted. Local adapter tests and configuration/bundle checks passed; its exact-commit Linux image and real scanner tests remain required. The accepted application baseline CI does not cover later infrastructure files automatically.

## Next bounded milestone: one isolated synthetic Cloudflare rehearsal

1. Review and pin adapter/package commit and image; establish the synthetic staging hostname, external database choice, limited runtime/database spend and explicit credential destinations/permissions. Do not enable execution solely because a paid Workers plan exists.
2. Verify explicit secret forwarding, fail-closed configuration, trusted host/scheme/client-IP rewriting and prevention of direct-container bypass. Test forged forwarding headers, host checks, redirects, secure cookies and login throttling.
3. Package private loopback clamd with bounded startup/update supervision. Gate readiness on supported engine/fresh signatures; measure Rails plus scanner/signature-update memory and concurrency. Test cold starts, stale/failed updates, detection, timeout/outage and restart.
4. Apply fresh migrations to isolated PostgreSQL with effective TLS verified; test private R2 write/read/delete, anonymous denial, upload provenance and integrity. Keep durable database/backups off ephemeral container disk.
5. Start with outbound mail disabled. Any later delivery rehearsal needs an approved sender and synthetic recipients, received-link evidence, monitored dispatcher/preview-expiration schedules and failure/restart drills that remain reliable across container sleep.
6. Exercise actual startup/readiness and synthetic visitor/member/admin/MFA journeys, hosted concurrency and restart persistence. Measure database/object restore and rollback; complete physical iOS/Android plus keyboard/focus/zoom and representative assistive-technology checks before pilot release.

Record every rehearsal result against its commit/image, configuration and environment. A flag, dependency probe, image build or empty private bucket is not successful hosted operation. planterapp.co DNS/nameserver changes remain deferred; the separate Pages demo is not the Rails backend. Real account provisioning/import, public cutover and live mail require their concrete owner arrangements and release evidence.

## Authorization interpretation

The user's production-transition instruction, Cloudflare selection and continuation requests authorize necessary preparation within the recorded scope. Do not reopen provider selection or invent generic approvals at each milestone. Request only concrete missing runtime/database cost decisions, credential permissions/destinations, sender setup, owner-deferred DNS work and live-data/operational responsibilities. Once actual technical gates and those arrangements are satisfied, the release record can reference existing production intent rather than require a ceremonial second launch confirmation.

The current application baseline's source findings and CI are closed. The corrected infrastructure source is accepted at source level, and operational NO-GO follows absent hosted integration/rehearsal, restore/device evidence and unresolved runtime/data/operations arrangements. Keep those boundaries distinct as work proceeds.
