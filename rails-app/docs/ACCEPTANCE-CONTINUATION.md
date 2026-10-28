# Case-level acceptance continuation

This is offline preparation, not hosted execution or production approval. Production remains NO-GO. The authoritative audit/staging-2/acceptance-closure-ledger.json contains 63 cases and zero hosted PASS results. Its preparation-time raw SHA256 is 18cdc62cc35e18a90bd79dee0022cba91fac61b2fba3b0e712104391d7275862. No existing ledger, frozen source cohort, credential, runtime, provider resource or fixture is changed by this tool.

Use script/acceptance-continuation.mjs to validate a bounded continuation manifest and produce a complete pending-case plan. It is a read-only planner. It does not adapt or resume the one-shot HTTP controller, create fixtures, restore data, carry cookies, mint runtime admission or execute any test. It always returns execution_authority:false and newly_executed_pass_count:0. A valid plan still requires the reviewed executor and separately authorized sealed window. This continuation planner is optional preparation for the first functional window, whose actual ledger currently has zero PASS results. Bootstrap and the existing functional controller must not wait for overall PLANNED: the distinct restore/P4 gaps remain BLOCKED and do not authorize or prohibit bootstrap. The current provider policy and its actual activation controls own that decision.

## Offline command and API

Run the pinned D-only Node executable with:

    D:/Projects/isp-rails-tools/node24/node.exe script/acceptance-continuation.mjs --plan

The default command reads only the authoritative ledger. It reports all 63 pending IDs, zero carried results, missing mappings/checkpoint/current checks/provider admission and the existing owner/recovery gaps. BLOCKED is a successfully produced plan, not an execution failure. No secret, network, subprocess or provider operation is used by the CLI. It supports no execution argument.

An optional --manifest D:/private/path/continuation.json may be combined with --evidence-root D:/private/path. Keep all raw artifacts and manifests on D under the selected evidence root. References are relative, contain no parent traversal and resolve to real files within that D root. Real-path checks also reject a junction leading to another drive. The CLI never loads a provider-policy verifier, so provider admission remains BLOCKED even when all supplied artifacts are internally consistent.

The pure API is:

    planAcceptanceContinuation({ledger, manifest, readArtifact,
      providerAdmission, verifyProviderAdmission, now})

Importing the module performs no I/O. readArtifact(relativeRef) must return raw Uint8Array/Buffer bytes; the validator independently checks exact length and SHA256 before parsing. It caches at most 4096 artifacts, accepts at most 32 MiB per artifact and 256 MiB total. The ledger and case mapping are exactly 63 unique cases. Manifest ledger_sha256 is the exported continuationDigest(ledger), a sorted-key canonical JSON digest; artifact hashes always cover original raw bytes.

verifyProviderAdmission is supplied by the reviewed provider policy and interprets its opaque proof. Only an exact true result for active_acceptance_continuation and the current run/lease/resource/deployment/time plus current-check and checkpoint-observation hashes counts as verified. The adapter must combine the current active prepared-release tuple, completed handoff, live watchdog, immutable deadline and remaining cumulative budget. A WeakMap admission proof for a grant alone is not activation proof and must be refused for this purpose. A boolean, allowed:true object or other self-assertion inside the manifest grants nothing. Provider account/name/namespace retirement, predecessor, access authority, immutable runtime, watchdog and cumulative US$5 policy remain owned by that policy. This planner introduces no second provider authority and calls no provider service.

## Manifest and historical PASS requirements

A version 1 acceptance_continuation manifest binds ledger_sha256, current, window_kind (functional or recovery_fault), checkpoint, current_checks and one mapping per ledger case. current contains a distinct run_id, lease_id, resource_id, deployment_id and all of these dependency identities:

- application_source and immutable image_digest;
- worker_behavior_sha256, configuration_sha256 and schema_sha256;
- historical_key_identity_sha256 and seed_identity_sha256;
- services_sha256 and scanner_sha256;
- checkpoint_sha256 and fixture_ids_sha256.

Hashes identify historical keys without exposing secret values. Each case mapping declares contract_sha256, dependencies, not_applicable, mutation (none/write), mutation_state (not_started/completed/pending/unknown) and an explicit pending strategy. Every omitted dependency needs a reviewed 20–240 character reason in not_applicable; there is no implicit omission. The dependency declaration and exclusions must exactly match the hashed historical result. A relevant changed declared dependency reopens that case; unaffected cases can carry their verified history. Changed case contracts reopen the case.

Only an existing authoritative PASS row can become PASS_CARRIED. It must have execution.kind actual_hosted, original run/lease identities, nonempty actual assertions and hashed run_evidence, result_evidence and reconciliation_evidence. The hashed acceptance_run binds the source resource/deployment and full dependency vector. The hosted_case_result must identify the exact case, actual hosted execution, PASS, original tuple, contract, assertions, dependencies and declaration. The independent_case_reconciliation must explicitly confirm PASS after the result, independently bind its raw hash and bind the same checkpoint and fixture identities. Missing, malformed, mismatched or inaccessible evidence is BLOCKED. Preparation, CI, simulated receipts and HTTP redirects cannot create a hosted PASS.

A historical result can carry only after the complete checkpoint, all six fresh current checks and active provider-policy admission are verified. If any current check or admission is missing or refused, the case stays BLOCKED and in pending_ids; historical_evidence preserves its prior provenance separately and never enters carry_provenance. The current complete checkpoint and fixture identities must also match the historical source. The output labels every carry as PASS carried from <original run>, includes original run/lease, source/result/reconciliation/checkpoint hashes and the compared dependency values, and sets newly_executed:false. It leaves the old ledger and evidence untouched. Never construct retrospective passing receipts for an unobserved hosted test.

## Complete state before fresh login

checkpoint references a raw-hash seal and a fresh observation. The quiescent_acceptance_checkpoint seal declares a paused, complete synthetic baseline. The acceptance_checkpoint_observation binds the new run/lease and seal hash and explicitly records quiescent:true, before_fresh_login:true and sessions_created:0. This seal is the original run’s post-run checkpoint: seal.run_id and seal.lease_id must exactly match each carried source run/lease, and seal.captured_at must be at or after both the actual case result finished_at and its independent reconciliation observed_at. An unrelated but byte-identical seal cannot carry a result. The returned carry provenance includes the seal run/lease/time. Comparison must happen before any fresh member/admin login changes sessions or counters.

Both states include the complete database inventory with every raw table-row artifact and row count; raw schema; complete sequence ownership/default/options/last_value/is_called/high-water state; complete per-table ownership; complete object inventory; each object's identifiers, owners, state, bytes, length and metadata; explicit absent observations where applicable; and complete fixture IDs. Every referenced artifact is independently raw-hash/length verified. The normalized complete state must match exactly, not just selected IDs/counts or a schema checksum. The declared current schema/checkpoint/fixture identities must equal that state.

The database artifact is a complete:true table inventory; each table names its raw JSON row array and exact row_count. Ownership is complete:true with tables:[{name,owner}] covering every table and a sequence_count matching the full sequence inventory. Each sequence binds sequence/table/column/owner/default, decimal-string increment/minimum/maximum/cache/last_value/high_water, cycle and is_called. Object inventory IDs/hashed keys/states must cover exactly the declared objects. Present objects require verified bytes/length/metadata; absent objects require an explicit absent observation, zero length and no bytes. Fixture IDs are complete named groups of unique string IDs. Deterministic capture/serialization is required for exact raw-byte comparison.

This is consistency validation of supplied evidence, not a database/object observer. The capture adapter must establish complete inventory and quiescence honestly. Missing capture or restoration capabilities remain BLOCKED. Full fresh database+objects+sequence+restored-write+application recovery has no executable adapter in this planner; restore_rollback always remains BLOCKED with full_restore_adapter_unavailable. A database-only receipt cannot close it.

After checkpoint comparison, every fresh resource still requires new deployment, private-gate, member-login, administrator MFA/login, storage and scanner evidence. current_acceptance_checks binds the new tuple, all six separately hashed PASS checks, new contexts, no old cookie/runtime reuse, session-creation time after comparison, and a completion no more than 60 seconds old at planning time. Historical functional evidence cannot substitute for these current safety/authentication checks.

## Pending operations and later windows

Every pending or unknown mutation must select read_only_reconciliation, reviewed_resume or isolated_new_fixture. Read-only reconciliation grants no mutation authority. Reviewed resume binds one exact prior operation, an independent reconciliation and a reviewed next step; no_replay:true and batch_replay:false are mandatory. Isolated new fixture planning binds distinct old/new fixture identity hashes, non-overlap and preservation of the original evidence. Neither strategy authorizes mutation. No automatic POST, batch replay, cleanup of uncertain rows/keys or adoption of old runtime/session material is provided.

Recovery/fault cases require a separately sealed recovery_fault window. The cumulative US$5 ceiling and immutable window of at most 55 minutes remain provider-policy requirements. The restore adapter gap persists even in that window. sender_lost_mfa stays an explicit P4 owner dependency; outbound identity delivery and real-account recovery remain outside the private synthetic scope. Physical devices/native installation are outside the owner-accepted virtual-browser scope. The full virtual-browser aggregate stays open until its actual complete journeys and shutdown evidence exist.

Validate the new planner with the pinned Node executable and --test script/acceptance-continuation.test.mjs. Tests use synthetic in-memory artifacts, preserve the actual 0-PASS ledger, and check evidence tampering, changed dependencies, complete checkpoint drift, session ordering/current checks, opaque policy admission, exact-operation planning, fixture isolation and the offline CLI. Passing these tests proves validator boundaries only; it is not a provider live run or 63/63 acceptance result.

## Prepared source identities

The following raw SHA256 values identify the exact UTF-8 planner and test sources handed off for central D-only application. A reviewed commit and exact-commit CI are separate publication requirements.

- script/acceptance-continuation.mjs: 4a7224242577d6d6ae0145528bc83178d8691082d633f424e61d6dce28829f70
- script/acceptance-continuation.test.mjs: 23ec69cc79a8fdffd0c257168d6f8844857dd998a9cdbc73f780231f0ada91cb
