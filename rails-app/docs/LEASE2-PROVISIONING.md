# Lease 2 provisioning, activation and emergency ownership

Production remains NO-GO. This operator does not authorize expenditure, identity mail, real accounts/data, DNS, a paid upgrade or a public production release. All files are on D and the cumulative incremental test ceiling stays US$5. An image-upload-only grant is never provisioning or runtime authority.

The initial immutable Rails image remains source 80d32fddf88251a6608ba047a577ce16efe8c834, digest sha256:152480a896060eae82a380dc54f651e199ff1585cd5dd805d0d51b9f3a587d2a. The actual inactive config is bound to SHA256 a18c41e5f95949823ddab603215f6f681547409c453f24cef827df97a8229232. Worker/tool source is the new exact successful CI commit; changing these tools requires its own review and CI before provider execution.

## Provider contract

Cloudflare documents Worker multipart metadata with a container class attachment, and separately documents the scheduled application create API. The pinned Wrangler 4.152.0 upload form sends metadata.containers with class_name; its application create step happens after the Worker upload. The operator performs those two steps separately, retaining the namespace identity between them.

The Worker-only PUT includes the RailsStaging2 export/binding, only the new v2 migration step, inactive flags and metadata.containers:[{class_name:"RailsStaging2"}]. It does not use Wrangler deploy, omit the container attachment, or use --containers-rollout=none. The latter can preserve the existing deployed RailsContainer metadata. No Durable Object stub is invoked during provisioning: the SDK Container constructor requires a container-enabled class.

The second request creates scheduling_policy:"default", the reviewed immutable image, standard-2, instances:0, max_instances:1 and durable_objects.namespace_id equal to the newly observed namespace. It does not switch to the distinct immutable durable_object scheduling policy. Actual instances-v2 must also be empty.

Primary documentation reviewed:

- https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/
- https://developers.cloudflare.com/api/resources/workers/
- https://developers.cloudflare.com/api/resources/containers/subresources/applications/methods/create/
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/content/methods/get/

## Source and approval package

The controller is D:/Projects/isp-rails-tools/node24/node.exe. Run commands from D:/Projects/isp-member-rails. The fixed private leaf is D:/Projects/isp-rails-tools/isp-staging-private/leases/rails-staging-2.

1. Publish/review these helpers and pass the exact push CI run. The actual remote workflow path is .github/workflows/rails-ci.yml. Required checks are rails_checks (sqlite), rails_checks (postgresql), container_build, cloudflare_adapter, cloudflare_scanner_runtime, neon_build_tools and virtual_browser_gate. The large reviewed_image_artifact job may remain intentionally skipped for an ordinary source commit.
2. In that CI job, run: node script/lease2-provision.mjs --bundle-proof. This mode builds the real pinned SDK bundle without credentials, network or file writes and prints module SHA256, project-input Git blob hashes and helper SHA256. It is portable; provider modes require the fixed Windows/D controller.
3. Save actual trusted GitHub evidence as private provision-source-proof.json: raw successful run object under run, actual check-run records under check_runs, and the exact CI bundle-proof bundle_sha256 and files. Its files keys are project-relative paths. The record must come from actual source/job evidence; editing assertions into a receipt is not proof.
4. If absent, prepare the already reviewed secret bindings with ISP_STAGING_LEASE=rails-staging-2 node script/prepare-staging-bindings.mjs. This is offline and creates worker-secrets.json exclusively from the existing five-key runtime-seed, approved Neon and private staging R2. It does not create dates or activate anything.
5. Run node script/lease2-provision.mjs --package. It verifies source/blob/bundle equality, pins the actual config and seed/binding bytes, then exclusively creates worker-bundle.mjs, private worker-upload-metadata.json and provision-package.json. A partial package is inspected; never delete it and regenerate automatically. Metadata contains credentials and stays private.
6. Record the real human grant as private inactive-provision-grant.json, bound to the printed package/helper hashes, actual source and ci_run_id, config/image, selected account/Worker/lease, a fixed access period of at most one hour, install_worker_bindings:true, runtime_authorized:false and cumulative_test_ceiling_usd:5. Required common fields: version:1, owner_authorized:true, human_grant_reference, account, worker, lease_id, purpose:"inactive-provision", worker_source, ci_run_id, package_sha256, helper_sha256, config_sha256, image_digest, starts_at, expires_at. owner_authorized is a trusted operator assertion backed by the actual human grant, never evidence by itself.
7. Select exactly one credential provider in provision-credential-provider.json: {"version":1,"kind":"oauth"} or {"version":1,"kind":"api-token"}. There is no fallback or automatic refresh. The shared loader reads only the original fixed D Wrangler OAuth file or original fixed deployment-token.json. OAuth uses its actual expiry and account/capability probes; API tokens additionally require actual /user/tokens/verify. The grant credential_kind must match; token_id is required for api-token. Do not select the expired image-only key or reuse its grant.

All grant/runtime UTC dates use YYYY-MM-DDTHH:MM:SSZ. Source/package/helper hashes are raw SHA256; generated JSON is UTF8 JSON.stringify(value,null,2) plus one newline.

## Inactive provider sequence

After actual access is valid, run exactly:

    node script/lease2-provision.mjs --preflight
    node script/lease2-provision.mjs --provision

Preflight requires actual account identity, closed workers.dev/preview ingress, current NOP build/deploy trigger commands, original inactive serving version/deployment, zero ISP applications and no existing RailsStaging2 namespace. Missing Workers Builds permission or unknown pagination blocks before mutation. Historical receipts do not substitute for current readback.

Provision acquires the shared exclusive lock and writes/fsyncs worker-put-intent.json before its single PUT. The journal preserves the pre-PUT namespaces and serving version/deployment, source/module/metadata/package hashes and random attempt identity. Readback requires the new unique namespace absent from baseline, the exact new 100% serving deployment, matching bindings/container metadata and downloaded serving module SHA. It checks the deployment again after content read.

It then writes/fsyncs app-post-intent.json before its single application POST. An application must match the fixed account/name and exact journal namespace. Independent GET of its configuration and instances-v2 proves the image/default policy/max1/requested0/actual0. Only then may the exact fourteen-field prepared-release.json be sealed, with the actual new app/namespace and new inactive rollback version/deployment. A separate sealed-idle.json confirms the seal's raw SHA; it is not runtime activation.

Lost response or failed observation always halts. The operator never replays PUT or POST. Use --reconcile for GET-only observation. If and only if the Worker is confirmed and no app-post-intent.json exists, --create-application can perform the genuinely unattempted next step once. If the application POST was attempted, use --reconcile then --seal only after its actual result is verified. Never rerun --provision to repair an uncertain outcome. Unknown POST plus current absence remains explicitly unconfirmed.

## Runtime handoff and activation

A separate runtime-window-grant.json must reflect actual runtime authority, not the inactive/image grant. It uses the same common bindings plus purpose:"runtime-window", runtime_authorized:true, credential_kind (and token_id for API tokens), prepared_release_sha256, runtime_start_at, runtime_expires_at and cleanup_reserve_minutes:10. Runtime duration is at most55 minutes within the fixed access grant; the original expired lease is never extended or reset.

Run --prepare-runtime once. It preserves the same five seed keys and secret bindings, writes a frozen watchdog-handoff-intent.json, then watchdog-plan.json, runtime.json and finally watchdog-handoff.json. It creates no active deployment or traffic. The final marker has exactly five fields: version, prepared_release_sha256, runtime_sha256, watchdog_plan_sha256 and bootstrap_cleanup_retired:true. A crash before the marker leaves bootstrap cleanup ownership; --finish-handoff verifies/writes only identical frozen outputs, including after window expiry. It never moves dates. A completed marker hands cleanup ownership to the sealed watchdog.

Arm the independent Windows watchdog in its own hidden process, retaining private stdout/stderr and observed PID:

    ISP_STAGING_LEASE=rails-staging-2 node script/cloudflare-staging-watchdog.mjs --arm

Use the corresponding PowerShell environment assignment on Windows. Fresh --arm requires the completed handoff marker. Emergency --stop-now must remain available without runtime, fresh dates or a handoff marker. Confirm its actual live matching state before the next step.

Run --activate only after a live matching external watchdog. Admission is limited to the first two minutes after the fixed start and must leave the ten-minute cleanup reserve. The helper verifies the exact sealed inactive Worker, app/image/namespace, zero actual instances, complete handoff hashes, runtime grant, credential expiry, current NOP controls and downloaded source bytes.

Activation uses the same module, the actual existing namespace and class/container attachment, without any migration replay. It durably records one active Worker PUT and one ingress POST before each request; the private fixed-expiry application gate remains active. It verifies actual active version/deployment and ingress, then records frozen capture intent, updates runtime identifiers and its handoff hash, and writes acceptance-release.json last. Partial capture is repairable only from identical frozen records with --reconcile-active; no PUT/POST is replayed. A failed active mutation or local capture invokes the sealed watchdog stop routine immediately using the same current selected credential. Its shutdown result must be verified; otherwise immediate operator action is required.

The functional run remains a separate reviewed command:

    ISP_STAGING_LEASE=rails-staging-2 node script/run-hosted-acceptance.mjs --execute --phase functional

This runs the selected first14 batches/42 HTTP cases. Natural aged step-up is deferred. Both full virtual mobile journeys still require actual evidence; this operator never marks them passed. Follow the common45-minute test cutoff,50-minute watchdog stop and55-minute final verification envelope.

## Emergency actions, rollback and stale locks

Before completed watchdog handoff, --cleanup first writes a terminal abort fence, closes ingress and deletes only the application verified against the journal's fresh namespace. It preserves the namespace and old lease. Cleanup does not need prepared-release/runtime, an unexpired grant, package files or original source files; current valid credential access is still required. An uncertain POST never observed as an app cannot be represented as definitively completed/absent. Abort fences prevent later create/seal/runtime operations.

After completed handoff, bootstrap --cleanup refuses. Use the sealed watchdog --stop-now. Its identity check and actual absence confirmation are authoritative. This remains available after runtime expiry.

The reviewed --rollback path first invokes sealed shutdown, verifies current NOP controls and the immutable sealed rollback version's exact namespace, then records one deployment POST selecting that same inactive version. It verifies closed ingress, actual application absence, downloaded module identity and inactive flags. --reconcile-rollback is read-only; uncertain deployment POST is never replayed. The original old v1 rollback is never used for RailsStaging2.

A hard controller interruption can leave provision-operator.lock. Run --inspect-lock to obtain its nonsecret nonce/hash/PID. Only after the recorded PID is demonstrably absent can --recover-lock --nonce <exact nonce> --sha256 <exact raw lock hash> archive that exact lock and remove it. Live, reused, unknown or changed owner identities are refused. It never kills a process. Historical locks and all mutation/abort/handoff intents are retained.

## Validation limits

Pure tests cover lost responses, durable-intent failure, no replay, source/module substitution, foreign/ambiguous ownership, actual-instance checks, grant/CI mismatch, pagination, stale/live locks, partial handoff recovery and activation admission. They do not prove provider acceptance of the real multipart metadata or hosted behavior. Any current provider schema/permission/identity mismatch must halt and preserve evidence. Local passes do not close P2/P3/P4 or authorize production.

## Bounded provider request outcomes

The historical application POST has no retained HTTP status/error body. Its failed one-shot journal remains unchanged and uncertain. Later GET absence and account audit rows cannot distinguish a request that failed locally, never received headers, was rejected over HTTP, or failed during body/parsing/readback. No automatic retry or retrospective success/rejection is permitted. The current lease remains aborted; the expired key authorizes no new operation.

The payload is preserved. The official [create-application API](https://developers.cloudflare.com/api/resources/containers/subresources/applications/methods/create/) permits zero initial instances, standard-2, a default-policy namespace association and application-level logging configuration. Top-level observability and configuration.observability are mutually exclusive. Pinned Wrangler4.152.0 also builds its scheduled create request with instances:0, max_instances and durable_objects.namespace_id. The [permissions catalog](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) lists account-scoped Containers Edit; the pinned OAuth client names containers:write. Worker-upload success alone does not establish application-create authority. These sources do not diagnose the historical failure or justify changing a permission, instance count, image or scheduling policy.

Every subsequent raw request uses provider-request-outcome.mjs. It exclusively writes/fsyncs a new private provider-request-UUID-intent.json before fetch and a matching outcome.json afterward. It never changes an existing one-shot record. The intent holds only fixed method/endpoint, request UUID, timestamps and request-payload SHA256. JSON hashes cover the actual serialized body; multipart hashes cover ordered component metadata/digests and are explicitly labelled multipart-components because fetch chooses the MIME boundary. Authorization, token, credential headers, body fields and Worker file bytes never enter public evidence.

Allowlisted outcomes distinguish no-header transport failure, observed HTTP status, body read/size failure, JSON parsing, provider-envelope rejection and subsequent local validation. They retain only bounded ray/request identifiers, numeric error codes, payload/response hashes and the exact private evidence reference by UUID. An HTTP200 followed by identity/pagination/readback failure stays an observed HTTP200 with a separate failure stage. oneShot preserves its mutation request outcome and reconciliation failure separately; any uncertain mutation still halts and is never replayed.

Provider reads, body consumption and asynchronous parsing share the existing request timeout/cancellation signal, with no retry or extra provider call. A final disposition is snapshotted after the response/deadline race: ignored aborts or late parser completion cannot turn a timeout into success. Multipart part sizes are checked before materializing their bytes.

Only failed response bodies may have a private error-body.json record, capped at64KiB, base64 encoded with its prefix size/hash and explicit truncation flag. A prefix is not a complete-body hash. Larger successful bodies remain bounded by4MiB. Successful Worker content is represented by response/module hashes; raw module/file bytes are never archived by the request outcome path. Public output and one-shot references exclude provider messages and all raw body material. No provider error body is copied into Git or chat.

Normal operations fail before dispatch if request intent cannot be persisted, and fail closed if final evidence cannot be recorded. Already-authorized emergency cleanup uses best-effort evidence so disk failure cannot suppress a verified scoped stop. It retains the in-memory application/ingress observations, marks provider_evidence_complete=false and refuses a fully confirmed cleanup/release claim. Cleanup authentication also uses this emergency evidence mode. The same absolute cleanup deadline, exact identity checks and separate emergency request budget remain in force.

The new module is included in helperHash and CI bundle/source-proof input hashes. Any new source package must bind those actual bytes and pass the new provider-request-outcome.test.mjs plus the existing operator, watchdog and credential-boundary tests before review/publication. Old package/helper hashes must not be edited to fit new helpers. The focused tests use synthetic responses only; no credential reads, provider calls or renewed POST attempts are performed.
