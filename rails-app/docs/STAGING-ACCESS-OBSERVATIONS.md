# Read-only staging dependency observations

This collector is source preparation. It has not accessed credentials or performed a live database/storage capture. It creates no provider resource, runtime period, account, email, object upload or database row. Publication and any later credential-access window remain separate reviewed decisions.

## Commands and fixed scope

    node script/staging-access-observations.mjs --plan
    node script/staging-access-observations.mjs --capture --lease rails-staging-3

Import and --plan perform no filesystem/secret reads, network requests or child execution. Capture admits only the exact lease3 command, pinned Windows Node 24.21.0 on D and the fixed staging checkout. It runs the two fixed D Ruby helpers without a shell or visible window. No arbitrary target, output path or helper may be supplied. Two helpers run in parallel within a 40-second read bound, followed by at most five seconds for observed process termination. A PASS printed before process exit is insufficient; timeout, nonzero exit, unverified shutdown or excess output makes the capture BLOCKED.

Only capture reads the project .env.local, the fixed private credentialRoot/r2.json and readStagingCredential({leaseId: "rails-staging-3"}). The selected provider has no fallback or automatic refresh. Child environments are allowlists; database credentials go only to the PostgreSQL helper, and R2 credentials plus the metadata token go only to the storage helper. Tokens/URLs are never command arguments or public output. All receipts, locks, archives and temporary files belong on D.

The existing four-scope deployment key/OAuth does not establish R2 metadata read permission. Missing permission is explicitly r2_metadata_permission_required/BLOCKED. This tool does not create keys, request consent, add scopes, change a selector or use another credential. Actual key access and any additional permission require the later owner-approved access window.

## What PASS means

The PostgreSQL helper connects only to the approved direct Neon host/database with the D CA bundle and verify-full. It observes actual TLS 1.2/1.3, cipher and PostgreSQL 18, begins READ ONLY, applies transaction-local timeouts, checks SHOW transaction_read_only and SELECT current_database(), then rolls back and disconnects. No Rails boot, application-table query, DDL or DML occurs. The project field is the approved host-to-project mapping; it is explicitly not a project ID reported by PostgreSQL.

The storage helper performs authenticated S3 HEAD and one ListObjectsV2 page with max_keys 1000, requiring a successful complete, non-truncated result. SDK retries and redirects are disabled; HEAD/error bodies are bounded to 256 KiB and list bodies to 4 MiB. Unsigned S3 access must fail with 401/403, or 400 carrying an allowed XML authentication code and authentication/signature wording. No returned object names or rows are published.

An S3 authentication denial alone does not prove privacy. The helper also GETs the fixed bucket's Cloudflare managed and custom domain settings. Both success envelopes must be complete and bounded to 256 KiB; unexpected pagination is refused. Managed public access must be explicitly disabled and every custom domain must be disabled (an empty list is allowed). Only this combined evidence produces public_access_verified:true/private:true. It proves the bucket's native public routes and direct transport scope; hosted application/file authorization remains separate acceptance work.

The APIs and enabled-field semantics follow Cloudflare's [managed domain read](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/domains/subresources/managed/methods/list/) and [custom domain list](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/domains/subresources/custom/methods/list/). Neither operation changes settings.

## Receipts and failure behavior

Each helper's observed_at is the actual oldest connection/request START, not completion. Before accepting either receipt, the wrapper checks the exact fixed identities, required flags, process completion and age of at most 60 seconds. Core consumes the raw ready-leaf SHA256; receipts do not embed a self-hash. Complete raw metadata bodies, keys, object names, rows, connection strings, tokens and provider error bodies are excluded from published/archive receipt projections. Only bounded status facts, counts and metadata-body hashes remain.

A fresh UUID directory under the lease3 private access-observation-archives stores exclusive, flushed database/storage/capture receipts and exact child-process identity/exit facts. Raw child stdout/stderr is not archived. Ready leaves are invalidated before credentials or network access. Only two actual passing receipts, both safely archived, refresh database-access-observation.json and storage-access-observation.json atomically per file. Any failed result invalidates both ready leaves and archives FAIL; a failed ready write also attempts exact-leaf removal so an old PASS cannot survive it. No uncertain provider mutation is replayed because this collector has no provider mutation path.

A pre-existing capture lock, persistence failure or unverified process cleanup stops the invocation. Never continue a guarded operation after collector failure, including when filesystem failure prevents a durable invalidation. A caller must check the successful command result and both fresh ready leaves. There is no automatic invocation or activation authority here; root selects any integration point. Existing lease2 abort fences and journals are untouched.

## Validation

    node --test script/staging-access-observations.test.mjs

The tests use synthetic receipts/processes and pure Ruby metadata checks. The saved-file suite also checks the actual inert CLI and actual Ruby parser without credentials or provider requests. Passing tests prove these boundaries, not live dependency access, hosted acceptance, restoration, scanning or production approval.

Prepared UTF-8 source SHA256 values:

- script/staging-access-observations.mjs: 0d34bce6d74038d92ccc292c93fa4c82e4478c23f1c5b7797f73f59885bb237b
- script/staging-access-observations.test.mjs: 8520b17138205efe3a88f7ae39b20b044c2c76dcd1ed99b42a523325af325cc0
- script/staging-postgres-access.rb: 10e8d6c2fc7ac9993476841d839b3eee2092c3edc7f6987eeafbd0ac8195078f
- script/staging-storage-access.rb: 19eaab0d76b15de972f460229705c2bd883c11148bd87c8608784410dac07a10

Connected-host readback accepts only nonempty repetitions of the exact approved Neon hostname because pg1.7 may expand a single DNS host to multiple resolved addresses. Original URL and parsed-input restrictions still allow only one fixed hostname; empty, mixed, foreign and non-string actual values fail. The regression loads the actual Ruby helper without making a connection.
