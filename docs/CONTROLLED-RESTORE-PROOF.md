# One owned Drive restore proof

Source-only helper: backup/restore-probe.mjs. No cloud restore, Auth restore or production recovery is claimed from local checks. Root owns one controlled execution within the approved US$0.40 build/proof admission; this is not a billing hard cap.

## Default and explicit execution

Default: node backup/restore-probe.mjs --plan. It reads no secret, initializes no Google SDK and calls no provider.

The same Node22 backup image includes the helper. Root first runs the ordinary backup job. After verifying its actual private Drive manifest and preparing the receipt below, root overrides the command for ONE single-task execution:
node restore-probe.mjs --restore --receipt /var/run/isp-restore/receipt.json

Use the attached isp-backup@isp-planter-app.iam.gserviceaccount.com identity, one task/parallelism1, maxRetries0 and ISP_DRIVE_BACKUP mounted from the existing approved Secret Manager version. Mount the private receipt as a file. No service-account JSON key or command-line credentials. A hard600second process watchdog bounds all stalled SDK/HTTP waits. Direct HTTP calls have30second timeouts and a350request cap; Storage calls are bounded by the admitted export artifacts plus one file and the process watchdog. Upfront selection additionally requires 3×(export files+1 file probe)+9 fixed calls+60 import polls≤350, so at most92 export files can be admitted (348 direct calls). A93file export is refused before intent or object writes; the128file structural ceiling cannot override this stricter envelope. Per-run export+file bytes are capped at64MiB; the synthetic file is at most1MiB.

Do not change the default backup job command permanently. Do not configure a restore schedule.

## Root preparation and fixed receipt

Before backup, root creates only these owned synthetic probes:
- Firestore backupRestoreProbes/<receiptId>, using the typed fields below.
- Storage backupRestoreProbes/<receiptId>.bin in the exact live bucket, small fixed synthetic bytes.

Read back the source probe once and pin its actual REST fields/generation/size/SHA in the receipt before the backup. The helper itself never reads or writes the default database or live Storage bucket; it reads backup copies from Drive.

Root precreates an EMPTY database named isp-restore-proof-<receiptId>, applies deny-all client rules to it, and reserves it exclusively for this proof. Use Singapore asia-southeast1. Root remains responsible for database creation/cleanup; the helper cannot create/drop a database.

Receipt example structure (fill actual values privately; do not commit it):
{
  "version":1,
  "scope":"isp-owned-restore-proof",
  "receiptId":"20261029-ab12cd34",
  "project":"isp-planter-app",
  "database":"isp-restore-proof-20261029-ab12cd34",
  "acknowledgement":"RESTORE_OWNED_PROBE_TO_DISPOSABLE_DATABASE_ONLY",
  "issuedAt":"actual UTC timestamp",
  "expiresAt":"no later than two hours after issuedAt",
  "rulesDenyClientsVerified":true,
  "authorizedBudgetUsd":0.4,
  "sourceVersion":"actual40hex backup source commit",
  "manifest":{"driveId":"actual private COMPLETE manifest ID","sha256":"actual64hex manifest byte hash"},
  "expectedExportFiles":1,
  "expectedExportBytes":1,
  "file":{"driveId":"actual storage-object artifact ID","bucket":"isp-planter-app.firebasestorage.app","name":"backupRestoreProbes/20261029-ab12cd34.bin","generation":"actual decimal generation string","sha256":"actual64hex","size":1},
  "probe":{"documentPath":"backupRestoreProbes/20261029-ab12cd34","expectedFields":{
    "proofKind":{"stringValue":"isp-owned-restore-proof-v1"},
    "receiptId":{"stringValue":"20261029-ab12cd34"},
    "marker":{"stringValue":"actual random32lowercasehex, not all zero"},
    "sampleNumber":{"integerValue":"7"},
    "sampleFlag":{"booleanValue":true},
    "sampleNull":{"nullValue":null},
    "sampleTime":{"timestampValue":"actual source REST UTC timestamp"}
  }}
}

Use actual export file count/total bytes from the pinned manifest, not the example1 values. The receipt requires an eligible complete backup source/project/database/folder/commit and exact owned synthetic file source/generation/hash. No arbitrary document path or production/default target can be selected. Firestore integer values remain strings in REST; nullValue is JSON null. Preserve the source timestamp representation returned by REST.

## What it does

1. Validate runtime/receipt expiry, exact attached project/account, narrow Drive scope and private owner/folder.
2. Read the pinned actual Drive manifest, verify byte SHA/MD5/private metadata, and select only its completed Firestore export files plus the exact synthetic file. It does not download Auth payloads.
3. Verify the named target database metadata and emptiness, private GCS staging bucket and unused restore-proofs/<receiptId>/ prefix.
4. Create an ownership/intent record with ifGenerationMatch0. Rehydrate each selected Drive artifact after checking private owner/parent/app key/source generation and byte SHA/MD5. Writes only the isolated staging prefix with create-only preconditions; read back exact new generations and hashes.
5. Preserve every Firestore export relative path, the original parent-folder basename and its matching .overall_export_metadata filename. Do not edit export metadata.
6. Recheck target emptiness, start one managed import into that named database and persist its operation name. Poll only that exact operation (at most60 polls); never list, auto-retry or blindly start a second import.
7. Read only the fixed owned probe document and compare all typed field values. Re-read the restored synthetic file's new generation/size/SHA. Save control/proof.json privately under the owned staging prefix only when both checks and import completion pass.

The source backup exports all collections. Official Firestore rules prohibit selectively importing collection groups from an all-document export, so the small reviewed export is fully imported into the isolated database; it may contain private project data. Only the synthetic document is read by this proof. No application, email, event handler or client should be attached to the disposable database.

## IAM and interruption

Existing backup permissions remain read/export-only for production. Root may temporarily add datastore.databases.get/import, datastore.entities.get/list and datastore.operations.get restricted to the exact named proof database. Revoke that temporary access after proof. No operations.list, default database import, Auth write/import or database create/delete permission is required by the helper.

The attached account needs get/list/create/readback on the staging bucket; existing create-only object safeguards remain. The Firestore service agent needs read/list access to the rehydrated private export prefix. Root verifies the exact IAM condition/resource support and deny-client rules before admission.

On any error, timeout or ambiguous import POST, keep intent, operation record and staged data. No success proof is written unless all checks finish. A server import can continue after the process exits; stopping/canceling is not rollback. Do not rerun against the same database/prefix. Root must reconcile that exact operation, then choose a new explicitly owned proof identity if another attempt is authorized. This source grants no retry authorization.

After reviewing the proof, root removes only this owned disposable database, staging prefix and original synthetic probes. The helper performs no resource deletion.

## Limits of the result

A successful probe proves this actual Drive managed export can be rehydrated/imported to a named database and this one file's bytes survive restoration. It does not prove every application record/flow, Auth password import, TOTP recovery, infrastructure recreation or source rebuilding.

New Storage generations have no valid old scan attestation. The helper uses isolated metadata with unverified-restoration, never copies public download tokens or old clean status, and never serves the restored file through the app.

Primary references:
- https://docs.cloud.google.com/firestore/native/docs/manage-data/export-import — relocation hierarchy, overwrite behavior, collection-filter limitation and service agent access.
- https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases/importDocuments — explicit target and background operation.
- https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Value — typed REST values.
