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

Evidence: project isp-planter-app created with Analytics off; Blaze billing linked; default Firestore Standard/native database created in asia-southeast1 with deletion protection. ISP Mobile Web registered. Firebase CLI released the built app at https://isp-planter-app.web.app. Direct /login navigation, actual hosted member dashboard and sign-out were observed. Source App SHA256 3f6f14d89baab2e7c6364254af80db0cd0b21f5f1786ce27ac699fbc39fb483c. This is the initial connected shell, not a complete production launch.

Exit: the existing visual shell has a real Firebase Hosting URL; no fabricated live URL or working-backend claim.

## 2. Login — CORE VERIFIED; OWNER ONBOARDING PENDING

Connect existing login/dashboard controls to Firebase Authentication and member/admin records. Member access requires verified email and members/{uid}.status approved. Administrative operations require server-owned admin claim, active staff record and TOTP. Missing records stay unapproved. Retain password recovery/verification as managed Firebase flows.

Exit: one real hosted sign-in/sign-out and approved-member access check, plus denial for an unapproved identity. No broad regression suite.

Evidence: audit/core-connection-proof.json records one live scoped run with seven successful member persistence/access checks. Hosted UI signed in, displayed the persisted profile and signed out. audit/admin-mfa-proof.json records four successful TOTP enrollment/challenge/authorized-roster/bounded-query checks. The initial MFA proof enrolled successfully but failed its subsequent code check; its failed receipt is retained separately. Astra reviewed the corrected MFA-only attempt using a later window. The seven core checks were not repeated. All three disposable identities and their records were removed after proof. Recovery/verification controls are implemented. At the owner's instruction, the temporary first administrator uses the owner's account; the unused official-address setup is disabled. Firebase accepted its one setup-email request and the owner reported resetting the password. A routing-only correction sends verified active staff to authenticator enrollment rather than the unapproved-member screen. The owner explicitly deferred their authenticator setup; this does not block independent work. No password was chosen by an agent and verification was not bypassed.

## 3. Database and files — CORE PROFILE VERIFIED; REMAINING CONNECTIONS IN PROGRESS

Connect existing screens to Firestore and private Storage. Member record server-owned fields: status, membershipReference and email. Own-profile writable fields only: displayName, company, branch, phone, updatedAt. Administrator lists use25-row document-ID cursor pages; no10,000-row browser reads or unbounded listeners. Preserve events/interest, Discover, publication and consultation field structures. Public visitors can view published events; interest requires sign-in. Publication metadata/files and consultation require approved membership.

Exit: a representative saved record survives a fresh read; cross-user/guest access is denied; the hosted screens use the real database. Uploads remain private/unpublishable until their required validation/scanning is implemented; Storage rules alone are not antivirus.

Evidence: initial reviewed Firestore rules compiled and deployed. One live own-profile save/fresh server read and guest/cross-member/self-grant denials passed. Private default Storage bucket isp-planter-app.firebasestorage.app was created in Singapore in production/deny-all mode. Existing event/Discover/publication/consultation/admin-import pages and 18 backend exports are now implemented locally with the existing layouts and fields. Astra reviewed the field/preview/authorization/registry contracts and their targeted integration corrections. First deployment and focused new-feature proof remain pending. Imports use private preview/confirmation and immutable staged versions with one final active-version switch; no automatic account activation, invitations or administrator grants. Dedicated keyless function identity is configured with database access, Authentication viewer and access only to the app's bucket. The scanner is an open production requirement; unscanned files remain blocked.

## 4. Google Drive backup and handover — PERMISSION COMPLETE; WORKER/RESTORE IN PROGRESS

Create the backup folder using the SAME narrow OAuth backup app, or explicitly grant that app folder access through the picker. The connected chat Drive account alone is not a deployed scheduled worker credential. Prefer nightly resumable export/copy, with failure reporting and one restoration demonstration.

Coverage: Firestore exports and their metadata, Storage objects and metadata, supported Auth account exports, rules/indexes, app/config and source version. No live OAuth credentials, deployment secrets or service-account keys in archives. Password/MFA restoration limitations must be documented; administrator TOTP may require verified re-enrollment. Do not claim complete backup until tested. Retention defaults remain proposed30 daily copies; file versions are copied once rather than needlessly duplicating unchanged PDFs.

Exit: a private Drive backup and manifest exist and one sample restore is demonstrated. Then report the focused login/database/hosting results and actual remaining launch decisions.

Evidence: owner accepted Google's User Data Policy and explicitly approved production audience for the dedicated backup OAuth app after automatic approval review requested this exact expansion. The owner then completed the actual drive.file consent. The same app created a private "ISP Planter App - Private Backups" folder, and its credential was saved privately on D without manual token pasting or service-account key downloads. No public sharing was created. OAuth consent/backup folder are complete; a working schedule, actual export/copy and restoration are not yet proved. A separate keyless backup worker is being implemented independently of the content pages. This is not a full member-app production launch.

## Guardrails

The old hosted app is off and its raw evidence is preserved. Do not resume Rails investigations, restart Cloudflare tests, delete legacy resources or import real membership lists while establishing Firebase. Keep only the focused changed-area checks above. Update this numbered list when a milestone closes.

Budget evidence: the billing account uses MYR. The project-only calendar-month alert budget is RM200 with actual-spend thresholds 25/50/75/90/100 percent. This is slightly below the approved US$50 planning amount using Bank Negara Malaysia's 28 October 2026 reference rate 4.0818 MYR/USD; alerts do not cap charges. Existing cumulative setup/test authorization remains US$10, retaining the historical US$6.07624768 conservative bound. No paid always-on function has been deployed and no invoice total is claimed from delayed provider reporting.
