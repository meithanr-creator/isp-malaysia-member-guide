# Membership list import — bounded local implementation

This workflow uses native Rails and a separate membership list. Real member-data handling, the proposed status mapping, mail operation and production activation remain subject to the decisions in `PRODUCTION-PLAN.md`. The named initial administrator is reserved from member uploads; this code does not create that account.

## CSV and review

An authenticated administrator uploads UTF-8 CSV with exactly these headers, in order:

```text
name,email,member_reference,status
```

Limits are 2 MiB and 5,000 data rows. Names and membership references are limited to 80 characters; email to 160. Status is exactly `eligible` or `ineligible`. References remain strings, including leading zeros. Email is trimmed/lowercased. The parser accepts a UTF-8 BOM and treats formula-like values as literal text. There is no spreadsheet export.

Malformed CSV/encoding, wrong or duplicate headers, extra role/password columns, invalid fields, duplicate normalized email/reference, existing membership identity changes, unlinked account collisions and administrator addresses are rejected. A matching existing email/reference can receive name/eligibility updates. Missing list rows are preserved.

The private preview shows counts, row actions and row-numbered errors; 50 rows per page. Nothing changes in the membership list until a separate CSRF-protected confirmation of the server-held digest and list version. Preview data is normalized JSON in the application database; the application creates no retained raw CSV copy or public upload. Framework request temp files remain request-scoped.

## Commit and account effects

The membership state lock serializes import, invitation and activation writes. Confirmation rechecks administrator access and preview ownership, locks users, compares the version plus membership/account fingerprint, revalidates the exact normalized rows, and commits all rows and audit together. A stale preview requires a new upload. A repeated exact successful confirmation returns its original result without duplicate writes or audit records.

Imports never assign roles, create/activate accounts or deliver invitations. Ineligibility suspends a linked member and revokes sessions in the same transaction. Returning to eligible does not reactivate a suspended account. Linked identity cannot be transferred by bulk import. The member membership page displays only the authenticated user's actual linked reference.

Import records retain actor, time, digest/import ID and counts. Audit records contain action, target references and before/after eligibility; no raw CSV, passwords or usable identity tokens. Parameter/model filtering protects upload/preview/audit fields in routine logs. Audit access/retention remains an operational D5 decision.

## Preview expiry

Confirmation and read access expire after 15 minutes. Visiting the administrator membership list or creating/opening/confirming an import clears expired normalized row data. A confirmed import clears its rows immediately. For quiet hosted environments, configure the following cleanup task with the approved scheduler; no scheduled service is provisioned by this implementation:

```text
bin/rails membership_imports:expire
```

The expiry task prints only the number of previews cleared. Physical deletion on a strict wall-clock retention deadline depends on that operational scheduling; database backups need a separately approved retention policy.

## Verification scope

Focused model, service and HTTP tests use fictional records and intercepted test mail. They cover validation/limits, leading zeros, user/admin collisions, actor/CSRF boundaries, private escaped previews, exact confirmation, stale/replayed previews, transactional rollback, ineligibility revocation and own-reference display. SQLite local results do not establish PostgreSQL cross-worker behavior, production MFA/mail delivery, real-device acceptance or authorization to import real data.
