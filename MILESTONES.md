# Firebase plan and numbered milestones

Date: 29 October 2026, Malaysia time.

## Approved choices

- One dedicated project: ISP Planter App (isp-planter-app), under the owner's Google account.
- Regional Firestore, Storage and backend functions: Singapore (asia-southeast1). Authentication, Hosting CDN and personal Drive are not represented as Singapore-only.
- Firebase email/password sign-in; verified approved-member access; authenticator-app TOTP for administrators. No SMS authentication.
- Firestore Standard/native database; private Cloud Storage; static Firebase Hosting PWA. Optional Google Analytics and Gemini are off.
- Google-managed runtime identities and encryption; no downloaded service-account keys. Local deployment uses a Google sign-in. Automated Drive backup needs one narrow OAuth consent, with its managed credentials in Secret Manager.
- US$50/month initial operating planning budget with alerts at25/50/75/90/100percent. This is not a quote or hard billing cap; actual usage can cost more. Testing/setup remains within the separately approved US$10 cumulative authorization.
- Approved design/features remain fixed. All files/tools onD. No new demo work.

## 1. Hosting foundation — COMPLETE

Create the dedicated project, link the owner-approved Blaze billing account, configure regional services and prepare the approved frontend for Firebase Hosting. Preserve existing projects.

Evidence: project isp-planter-app created with Analytics off; Blaze billing linked; default Firestore Standard/native database created in asia-southeast1 with deletion protection. ISP Mobile Web registered. The initial hosted member dashboard sign-in/sign-out was observed. The current frontend release is sealed to source commit 5ca54cca21781ec1b5ea6a351052903d6295ae97 at https://isp-planter-app.web.app. audit/frontend-provider-seal.json records HTTP 200 and exact matching SHA256 for index.html, manifest.webmanifest and service-worker.js. Those are deployment/PWA-file checks; native-device installation and the new business workflows have not been claimed from them. This is a hosted app foundation, not a full production launch.

Exit: the existing visual shell has a real Firebase Hosting URL; no fabricated live URL or working-backend claim.

## 2. Login — CORE VERIFIED; OWNER MFA DEFERRED

Connect existing login/dashboard controls to Firebase Authentication and member/admin records. Member access requires verified email and members/{uid}.status approved. Administrative operations require server-owned admin claim, active staff record and TOTP. Missing records stay unapproved. Retain password recovery/verification as managed Firebase flows.

Exit: one real hosted sign-in/sign-out and approved-member access check, plus denial for an unapproved identity. No broad regression suite.

Evidence: audit/core-connection-proof.json records one live scoped run with seven successful member persistence/access checks. Hosted UI signed in, displayed the persisted profile and signed out. audit/admin-mfa-proof.json records four successful TOTP enrollment/challenge/authorized-roster/bounded-query checks. The initial MFA proof enrolled successfully but failed its subsequent code check; its failed receipt is retained separately. Astra reviewed the corrected MFA-only attempt using a later window. The seven core checks were not repeated. All three disposable identities and their records were removed after proof. Recovery/verification controls are implemented. At the owner's instruction, the temporary first administrator uses the owner's account; the unused official-address setup is disabled. Firebase accepted its one setup-email request and the owner reported resetting the password. A routing-only correction sends verified active staff to authenticator enrollment rather than the unapproved-member screen. The owner explicitly deferred their authenticator setup; this does not block independent work. No password was chosen by an agent and verification was not bypassed.

## 3. Database and files — DEPLOYED; NEW WORKFLOW AND FILE PROOF PENDING

Connect existing screens to Firestore and private Storage. Member record server-owned fields: status, membershipReference and email. Own-profile writable fields only: displayName, company, branch, phone, updatedAt. Administrator lists use25-row document-ID cursor pages; no10,000-row browser reads or unbounded listeners. Preserve events/interest, Discover, publication and consultation field structures. Public visitors can view published events; interest requires sign-in. Publication metadata/files and consultation require approved membership.

Exit: a representative saved record survives a fresh read; cross-user/guest access is denied; the hosted screens use the real database. Uploads remain private/unpublishable until their required validation/scanning is implemented; Storage rules alone are not antivirus.

Evidence: reviewed Firestore/Storage rules are deployed. The accepted seven core Auth/profile/access checks and four MFA checks carry without replay. Private default Storage bucket isp-planter-app.firebasestorage.app is in Singapore. Existing event/Discover/publication/consultation/admin-import screens preserve the approved layouts and fields; the latest frontend/PWA files are hosted and hash-sealed.

The first backend deployment completed its original 18 exports in one 28-second build. The subsequent four-callable release is now deployed and ACTIVE: activateMyMembership, previewRegistryImport, getRegistryImportPreview and confirmRegistryImport. audit/enrollment-provider-seal.json binds all four to source commit 5ca54cca21781ec1b5ea6a351052903d6295ae97 and the dedicated keyless isp-functions identity. The other fourteen callables and download endpoint retain their previous release; accepted core proof remains carried. Activation uses the fresh verified identity and exact eligible registry pairing; imports do not create Auth accounts, send invitations or grant administrator access. Registry preview/confirmation, immutable staged versions and one atomic active-version switch preserve omitted rows; suspension restoration requires an explicit reviewed option.

The scanner image has one successful build from source edad270e4cadb69619edf814d80176a3440a54d0. audit/scanner-build-seal.json records immutable image sha256:37ec03dd689d4bfae43ec1dcac8c2689a93962b62a0a00987bf1dbe92ad59d03, 95,400,434 logical image bytes and 18,607 source-archive bytes. The single signature seed execution isp-clamav-updater-tgxqx succeeded in 2 minutes 19.88 seconds. audit/scanner-seed-execution.json and audit/scanner-signature-manifest.json record the signed definition set, daily version 28167, engine 1.4.6, and the actual container-only EICAR antivirus self-test PASS before mirror activation. This proves the seed/self-test, not attachment scanning.

Eventarc's first trigger creation failed during documented first-use propagation; the managed service-agent role is present and no customer permissions were widened. audit/scanner-eventarc-issue.json records the propagation wait, zero triggers and zero proof attachments finalized at that checkpoint. Trigger readiness and the one focused six-area workflow, including real clean cover/PDF scans, unsafe-format rejection, publication/download denial and owned-fixture cleanup, remain pending. Unscanned files remain private/unpublishable. Milestone 3 is not complete.

## 4. Google Drive backup and handover — PERMISSION AND BUILD COMPLETE; BACKUP/RESTORE PENDING

Create the backup folder using the SAME narrow OAuth backup app, or explicitly grant that app folder access through the picker. The connected chat Drive account alone is not a deployed scheduled worker credential. Prefer nightly resumable export/copy, with failure reporting and one restoration demonstration.

Coverage: Firestore exports and their metadata, Storage objects and metadata, supported Auth account exports, rules/indexes, app/config and source version. No live OAuth credentials, deployment secrets or service-account keys in archives. Password/MFA restoration limitations must be documented; administrator TOTP may require verified re-enrollment. Do not claim complete backup until tested. Retention defaults remain proposed30 daily copies; file versions are copied once rather than needlessly duplicating unchanged PDFs.

Exit: a private Drive backup and manifest exist and one sample restore is demonstrated. Then report the focused login/database/hosting results and actual remaining launch decisions.

Evidence: owner accepted Google's User Data Policy and approved production audience for the dedicated backup OAuth app after automatic approval review requested that exact expansion. The owner completed drive.file consent. The same app created the private "ISP Planter App - Private Backups" folder; its credential stays private on D and in Secret Manager for the dedicated backup identity. No public sharing, manual token pasting or service-account key downloads were used.

The separate keyless backup worker has source approval for its hard deadline, exact nonsecret source archive and 30-date manifest retention. One build succeeded from source 5a372322f0f9f5d12941f27bd69d3e4c4e8f2b43. audit/backup-build-provider.json records immutable image sha256:5645338f6f87b439c0b61f93079f1d460d8ae416295dcf472f0fadb854cd7b46; the observed logical image size is 95,614,191 bytes. Build success does not prove a backup execution, Drive archive, working schedule or restoration. Those remain pending.

Bucket metadata access stays scoped to the two ISP buckets. Payload garbage collection remains off, and the exports/ lifecycle prefix does not match firestore/ output; no automatic payload-retention claim is made. Owner authenticator setup remains explicitly deferred. Milestone 4 and the full production handover are not complete.

## Guardrails

The old hosted app is off and its raw evidence is preserved. Do not resume Rails investigations, restart Cloudflare tests, delete legacy resources or import real membership lists while establishing Firebase. Keep only the focused changed-area checks above. Update this numbered list when a milestone closes.

Budget evidence: the billing account uses MYR. The project-only calendar-month alert budget is RM200 with actual-spend thresholds 25/50/75/90/100 percent. This is slightly below the approved US$50 planning amount using Bank Negara Malaysia's 28 October 2026 reference rate 4.0818 MYR/USD; alerts do not cap charges. audit/firebase-test-budget.json records US$9.92624768 of conservative reservations within the US$10 cumulative setup/test authorization, leaving USBudget evidence: the billing account uses MYR. The project-only calendar-month alert budget is RM200 with actual-spend thresholds 25/50/75/90/100 percent. This is slightly below the approved US$50 planning amount using Bank Negara Malaysia's 28 October 2026 reference rate 4.0818 MYR/USD; alerts do not cap charges. Existing cumulative setup/test authorization remains US$10, retaining the historical US$6.07624768 conservative bound. All deployed functions use zero minimum instances; no paid always-on function has been deployed and no invoice total is claimed from delayed provider reporting.

.07375232 unallocated. The total includes the retained historical US$6.07624768 bound and the scoped Firebase/core/scanner/backup allowances; it is not an invoice or a current billed-spend total. All deployed functions use zero minimum instances. No paid always-on function or completed invoice reconciliation is claimed.
