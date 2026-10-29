# ISP Firebase operations handover

Configured 29 October 2026. The existing project owner is the assigned operator; duty acknowledgement remains pending. No credentials or tokens belong in this document.

## Daily maintenance

- 01:30 Asia/Kuala_Lumpur: isp-clamav-updater-daily calls only isp-clamav-updater. By 02:00, inspect its terminal result and the active signed daily definition build time. Definitions older than 48 hours fail closed; a fresh checkedAt cannot freshen old signed definitions.
- 02:30 Asia/Kuala_Lumpur: isp-drive-backup-daily calls only isp-drive-backup. By 03:15, inspect its terminal result and the matching private Drive COMPLETE manifest/hash. Backup keys use the existing UTC-date convention, so the 02:30 Malaysia run uses the preceding UTC calendar date.

Both schedules use separate dedicated identities with invoker permission on only their respective Job, OAuth POST{} and zero configured failure retries. Job retries are zero. No schedule was forced to demonstrate configuration. Provider duplicate delivery remains possible; existing lease/checkpoint controls remain. An accepted run request is not proof of completed backup or fresh definitions.

## Failure and capacity

Automatic backup-overdue and signature-freshness alerts are not implemented. Missing/failed/unknown execution or manifest is an operator action, never an automatic retry. Preserve exact Job/Workflow operation evidence; do not bypass updater cooldown or launch another scan to resolve an ambiguous receipt.

Review Drive, staging, signatures and artifacts against actual volume and the project budget alerts. Thirty complete manifest dates do not cap retained payload bytes. Payload garbage collection remains off; do not use blind age-based deletion on referenced exports, manifests, active signature files or checkpoints. Current signature state including soft-deleted bytes is 266,935,620 bytes, below the 2 GiB review bound; retained artifact evidence is 770,926,507 bytes, below its separate 2 GiB bound. Continued retention was admitted to ongoing operations after the final file PASS and cleanup. These are observed sizes, not guaranteed steady-state caps.

Daily refresh plus backup compute/Scheduler planning baseline is approximately US$2.63 per 31 days at the carried reviewed rates before startup/shutdown, storage, transfer, exports, logging or duplicates. The approved overall operating plan is US$50/month with project alerts, not a hard cap. No free-credit assumption is used for these planning amounts.

## Recovery and access

The actual private Drive backup and one isolated database/file restoration are proven. Preserve original backup/source receipts. Full Auth-password, TOTP and application restoration were not proved. Recovery must target an explicitly owned isolated database and objects until a separate production restoration is approved.

The owner still needs personal authenticator enrollment. Real membership eligibility is imported only from an approved list; client code cannot grant member/admin access. No real-member import or domain cutover was performed during acceptance.
