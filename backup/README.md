# ISP private backup job

This standalone Node 22 Cloud Run Job is milestone 4 source. It has not been deployed or run against Google APIs by its implementer. A passing local test proves neither backup nor restoration. The app, Functions and accepted Auth adapter are separate.

## Fixed destination and runtime

Project: isp-planter-app; Firestore database: (default). Drive owner: meithan.r@gmail.com; app-created private folder: 1gjZnAk2RxfTGL40UINhz-lZ6sRt2g2Rh. Only OAuth scope: https://www.googleapis.com/auth/drive.file.

The job checks token scope, Drive identity, private folder ownership and each copied file's owner/parent. Google APIs require the exact attached account isp-backup@isp-planter-app.iam.gserviceaccount.com; downloaded service-account JSON keys are refused. Use one task, parallelism 1, timeout 1800 seconds and maximum retries 0. A process-wide 1680-second watchdog starts before SDK initialization and forcibly exits with code124 on any stalled wait or stream. It logs only a safe failure code, bypasses lease-release cleanup, and closes local polling/streams. An accepted managed export may continue remotely; its ambiguous intent/checkpoints and lease are retained for operator reconciliation. The 1860-second lease exceeds the 1800-second Cloud Run hard timeout and prevents overlapping processes. Root owns deployment, IAM, nightly scheduling and failure notifications.

US$50/month is an operating budget alert, not a hard cap. Setup/test authorization remains US$10 cumulative, retaining the historical US$6.07624768 bound. This source work made no cloud calls.

| Environment | Meaning |
|---|---|
| ISP_DRIVE_BACKUP | Secret Manager-mounted JSON with exactly clientId, clientSecret, refreshToken, folderId, ownerEmail, scope |
| ISP_BACKUP_STAGING_BUCKET | Exact private bucket isp-planter-app-backup-staging-606528057827 |
| ISP_BACKUP_SOURCE_BUCKET | Exact live bucket isp-planter-app.firebasestorage.app (Singapore) |
| ISP_SOURCE_VERSION | Exact 40-hex Git commit used to build the image |
| ISP_BACKUP_DATE | Optional reviewed UTC daily checkpoint to resume; otherwise current UTC date |

Before claiming permanent unattended operation, root must verify the OAuth app publishing status and refresh-token longevity: External Testing grants with Drive scopes expire after seven days under [Google OAuth policy](https://developers.google.com/identity/protocols/oauth2/). No consent flow is executed by this source.

Never print credentials, Auth hashes or hash parameters. Logs contain only phase/status/counts. Plan mode reads no secret.

## Contents and completion

1. Verify attached project, Drive privacy, and staging uniform access plus enforced public-access prevention.
2. Capture default-tenant Auth users in pages of 1000, available password hash/salt, provider data, claims and MFA metadata. Privately capture supported Auth/hash configuration.
3. Start one Firestore managed export, persist its operation name and wait for successful completion. Require its overall metadata file, then copy every completed output.
4. Freeze a generation-specific Storage inventory including bucket configuration, original object metadata and listed versions. Copy those exact generations; missing generations fail the run.
5. Archive image source/configuration: rules, indexes, Hosting/packages, frontend/Functions/scanner/backup code, approved assets, root index.html and tsconfig.json, Functions tsconfig.json, project mapping, Storage CORS and public backup notices/CSS. backup/source-closure.mjs pins the exact nonsecret file list; a missing or extra archived file rejects completion. Runtime secrets, environment files, audit evidence, build outputs and dependency caches are excluded. Operators supply reviewed Firebase web/build environment separately during restore. Record file hashes and commit; this does not assert that console edits match the image.
6. Copy resumably to Drive with pre-generated IDs, 8 MiB chunks and private durable state. Require completed size/MD5 readback and SHA-256 when Drive exposes it; retain source SHA-256. Resume using the server's offset, without blind resending.
7. Commit and verify the private daily manifest only after payload completion. Missing password-user hash coverage yields PARTIAL and a failed job. A reviewed resume can recapture incomplete Auth coverage after IAM correction.

These sources have different capture intervals. This is not an atomic cross-service snapshot. [Managed export documentation](https://docs.cloud.google.com/firestore/native/docs/manage-data/export-import) describes completion and consistency. Exports incur document reads.

## Auth and MFA limits

The official configuration request is GET https://identitytoolkit.googleapis.com/admin/v2/projects/isp-planter-app/config. Its signIn.hashConfig supplies algorithm, base64 signerKey/saltSeparator, rounds and memoryCost. Keep these only in the private Auth payload.

Require firebaseauth.users.get, firebaseauth.configs.get and firebaseauth.configs.getHashConfig through a narrow read role. Do not grant broad Auth administration simply to read hashes. See [Admin user listing](https://firebase.google.com/docs/auth/admin/manage-users#list_all_users), [getConfig](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v2/projects/getConfig), [HashConfig fields](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v2/projects.tenants#HashConfig) and [IAM permissions](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseauth).

Only password-provider users require hashes/salts. Documented Firebase SCRYPT parameters are required before password export coverage is complete. Unsupported/omitted material remains partial. Password restoration is not verified until a controlled [supported import](https://firebase.google.com/docs/auth/admin/import-users) and sign-in proof.

No TOTP secret export/restoration is claimed; enrollment metadata is retained and recovery requires controlled re-enrollment. Additional Identity Platform tenants are outside this default-tenant backup.

## Root-owned permissions and build

The runtime account needs:

- Firestore export and operation read: datastore.databases.get, datastore.databases.export, datastore.operations.get; no production import permission. The code resumes its exact persisted operation with checkExportDocumentsProgress/GetOperation polling and never calls listOperations, so datastore.operations.list is not needed.
- The three Auth read/hash permissions above.
- Live Storage object/version get/list and bucket metadata read.
- Staging bucket metadata read and object get/list/create/update/delete, scoped to that private bucket. Checkpoint overwrite and owned lease release need write/delete; no live object/payload deletion occurs.
- Secret Manager access to the one Drive credential version.
- Firestore service-agent staging access, per [official export permissions](https://docs.cloud.google.com/firestore/native/docs/manage-data/export-import#service_agent_permissions).
- Root's Scheduler identity invokes the reviewed job.

Build from project root using backup/Dockerfile. Its Dockerfile-specific ignore file whitelists selected source, locks, rules/config and assets, excluding environment files, credentials, caches, node_modules, private evidence and Git internals.

The dependency lock was generated strictly from the existing D-drive cache in offline mode. Local serialization checks use installed Node 24; deployed runtime is explicitly Node 22. No Docker/provider build was run here.

## Retention and interruption

After a new complete manifest verifies, keep all complete manifests from the newest 30 unique UTC daily dates; trash complete manifests only from older dates. Duplicate complete manifests on a retained date do not consume another daily recovery point. Partial records remain for investigation. Payload deletion, including orphan cleanup, is disabled so references cannot break. Drive storageQuota is checked before new payloads and remaining upload bytes; low/over-quota fails clearly without logging account totals. Drive usage can still grow; recoverable payload Trash GC is not implemented and remains owner handoff pending. Staging lifecycle cleanup is root-owned and is not configured by this source; never expire an active operation or resumable checkpoint.

Private staging checkpoints contain export operations and sensitive resumable session URLs. A global export-owner checkpoint also refuses a later daily export until the preceding managed operation is complete. An export intent without a returned operation name refuses automatic restart: the operator must reconcile the original operation first. A source commit change within a daily checkpoint requires review. Failed work leaves previous complete backups intact.

## Proposed payload Trash GC (not active)

A later reviewed collector can validate every app-owned retained manifest and its checksums, abort on any invalid manifest, union all retained artifact IDs, and trash only app-owned payloads outside that union after a minimum grace period. Validate appProperties, exact parent, owner and private sharing immediately before Trash. Keep resumable/checkpoint references protected too; never permanently delete. This proposal has no runtime code or permission side effects and must be approved before enabling.

## Controlled helper packaging

The same reviewed image also contains backup/restore-probe.mjs. Its default is a static --plan. Only root may override the job command for an explicit --restore --receipt mounted-private-file execution after receipt, named-database IAM and budget admission. See docs/CONTROLLED-RESTORE-PROOF.md. The main backup job behavior is unchanged. This helper does not restore Auth accounts/passwords/TOTP or mark old safety attestations valid.

## One controlled restore proof

Root runs the cloud proof after review:

1. Use only an owned synthetic probe document and small synthetic file.
2. Run the reviewed backup once; verify its private manifest and checksums.
3. Rehydrate export files to private GCS with their original hierarchy and overall_export_metadata filename.
4. Import into a new named proof database, never (default). Compare only the owned probe's types/values.
5. Restore the file into an isolated proof prefix; compare bytes/hash and its new generation.
6. Clean up only explicitly owned proof resources under root's reviewed procedure.

New Storage generations invalidate prior scan attestations. Clear reusable download tokens, verify bytes and rebind or rescan the exact generation before serving. Do not blindly restore clean status.

The scoped proof establishes neither password import nor TOTP recovery nor every app flow. Indexes are not in managed exports; preserve the separately archived source configuration. [Import behavior](https://docs.cloud.google.com/firestore/native/docs/manage-data/export-import#import_data) documents hierarchy, indexes and overwrites.

## Local checks and execution

Original local serialization checks: node --test backup/manifest.test.mjs

Focused review-fix checks only: node --test backup/review-fixes.test.mjs (short child-process stalled-wait hard-stop, disarm, exact nonsecret source/ignore closure, unique-date retention; no SDK/provider calls).

Read-only static plan: node backup/job.mjs --plan

Actual reviewed Cloud Run execution: node job.mjs --run. Local/key-file-backed execution is refused. Never put credentials on the command line.

Drive implementation references: [resumable upload](https://developers.google.com/workspace/drive/api/guides/manage-uploads), [pre-generated IDs](https://developers.google.com/workspace/drive/api/guides/create-file#generate_ids_to_use_with_your_files), [narrow file scope](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
