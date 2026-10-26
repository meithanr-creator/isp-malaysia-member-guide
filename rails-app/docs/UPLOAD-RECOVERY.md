# Managed upload recovery

Scope: administrator uploads for Events, Publications and Discover. Shop and Jobs are excluded. This runbook does not authorize a cloud runtime, member import or production launch.

## Invariants

Files are validated and scanned before storage. Every candidate key is registered durably before PUT. The authoritative administrator/session/MFA, record-lock and audit transaction controls attachment and draft changes. Rejected edits keep the saved preview and previously published references.

A timed-out PUT has an uncertain remote outcome. DELETE followed by HEAD=false establishes absence at that instant, not terminal completion of the earlier PUT. Recovery therefore retains the exact-key ledger indefinitely as a non-uploadable tombstone. A cleanup fence is committed under the blob lock before remote deletion; queued upload attempts require the initial pending state and are refused after fencing. A referenced object is retained.

Never purge managed pending/tombstone rows, run a global unattached-blob cleanup, erase their metadata, or use elapsed time as terminal proof. The test-fixture operator refuses cleanup that would remove those records. A separately reviewed provider terminal-proof or key-lifecycle procedure is required before retiring a tombstone. Otherwise keep it and repeat exact-key recovery as needed.

## Response to a failed upload

1. Stop the affected mutation sequence. Keep the previous published version visible. Do not automatically replay a POST whose dispatch or database outcome is uncertain.
2. Capture the opaque request trace, upload operation UUID, phase/outcome and exception class through the restricted diagnostic path. Never put passwords, cookies, member details, payment references, original file bytes or provider exception messages into public evidence.
3. Independently reconcile the exact record revision, attachment references, audit outcome and operation ledger using the selected database. An HTTP failure alone does not establish transaction rollback.
4. Verify the target environment, private bucket and exact operation UUID. The private Ruby entry point is `UploadOperation.recover!(operation_id: "EXACT-RECORDED-UUID")`. It accepts one UUID, considers at most four owned rows and rechecks key ownership and references under locks. Use only the approved environment/secret loader; never copy credentials into commands or chat.
5. Record separately: referenced rows retained; pending tombstones; objects currently absent/present; cleanup failures; and successful database reconciliation. A pending result can include observed object absence. It is not a zero-ledger or permanently-clean result.
6. Repeat recovery only for the recorded operation. A late object remains discoverable by the same key/row. An unavailable database, storage failure or uncertain ownership leaves the ledger intact and requires operator follow-up.

## Required operating controls before production

Assign access, ownership, review/alert frequency and retention for pending operations. Monitor counts and age without exposing filenames or member data. Back up durable ledgers with the application database; preserve encryption keys separately and include referenced files and pending keys in the complete recovery exercise. The current Neon read-only restore proves only its documented database/schema/MFA scope; attachment and application recovery remain open gates.

Source proof: `test/services/upload_operation_test.rb` includes partial and second PUT failures, audit/database rollback, failed DELETE/HEAD, late object materialization, recovery fencing before a queued PUT, rejected scans and PostgreSQL row-lock concurrency. The local SQLite run cannot establish PostgreSQL locking. Isolated test teardown can dispose of synthetic disk-service fixtures after no asynchronous write remains; that is not a production tombstone-retirement procedure.
