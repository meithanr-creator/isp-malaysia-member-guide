# Watchdog cleanup budget

Prepared 27 October 2026. Source/tooling change only; no cloud operation, credential access, runtime activation or production approval is represented by this document.

## One deadline per cleanup attempt

Shutdown previously allowed18 application polls,15-second requests and five outer retries, which could exceed the five-minute contingency. The watchdog now runs one cleanup state machine with a monotonic absolute deadline. There is no outer retry loop that recreates the deadline.

Normal armed cleanup starts at the fixed stop time, five minutes before the original lease expiry. Its budget is the earlier of300seconds or the original expiry. Wall-clock remaining time is converted once to a monotonic deadline. A late scheduler wake records cleanup_late_ms and reduces the available budget; waking after expiry gives zero normal cleanup budget and an explicit FAIL. Request and body consumption are bounded by the lesser of15seconds and the remaining absolute allowance. Poll waits cannot exceed that same allowance.

A new explicit --stop-now invocation has its own maximum300-second emergency cleanup attempt, including entry work. It can run after the acceptance lease expires and does not need runtime.json when a valid sealed plan/prepared release exists. Expiry does not remove cleanup authority. This never changes the lease start/expiry, authorizes another runtime, or replenishes the cumulativeUS$5 ceiling. A later emergency attempt is a new bounded cleanup attempt, not an automatic reset inside the failed invocation. Expired credentials can block access and yield an explicit unconfirmed/action-required result.

## Exact scope and sequence

The existing fixed account/Worker/application and fresh lease/prepared tuple checks remain. Fresh application reads must match the exact sealed application ID, account and Durable Object namespace. A wrong identity is terminal before further mutation. No global list/delete, namespace substitution, name-only replacement or unrelated Worker control is introduced.

Persist sanitized cleanup intent before the first provider mutation. First verify the exact application. Attempt to disable ingress, then immediately request compute deletion without waiting for ingress verification/retries. Ingress failure cannot suppress deletion. After an uncertain DELETE, reconcile with an exact application GET before any retry; repeat only the scoped idempotent deletion for the verified identity. Confirm ingress separately and poll only within the original deadline. An already absent exact application needs no DELETE but still requires ingress closure.

The API client bounds fetch and response JSON with the same AbortSignal and caller deadline. Only an allowed404 proves application absence; a successful null/array application payload is ambiguous and cannot become a false absence claim. API failures retry inside the same deadline only after the required identity observation. No failure details, response bodies or credentials enter public receipts.

## Results and operator action

A PASS requires both container_application_absent=true and ingress_closed=true. Partial compute absence is recorded even when ingress remains unconfirmed. Budget exhaustion returns status=FAIL, shutdown_confirmed=false, reason=cleanup_budget_exhausted and budget_exhausted=true. Identity/evidence/access failures preserve sanitized partial evidence and return/record an unconfirmed FAIL. No successful shutdown is inferred from HTTP expiry, controller exit, an accepted DELETE, or missing provider responses.

watchdog-state.json and the shutdown audit receive the intent/progress/final receipt in the existing private/audit destinations. The state is no longer marked armed after cleanup starts, so it cannot be mistaken for a live admission watchdog. Receipt fields include elapsed/budget/deadline/lateness, emergency mode, observed application/ingress state and request-failure count. File-write failure is terminal and cannot authorize further mutations; the last successfully written evidence remains authoritative. Final output and nonzero exit explicitly require immediate scoped emergency cleanup and forbid starting another window while shutdown is unconfirmed.

If cleanup is unconfirmed, retain the sealed plan and exact resource IDs, perform a new scoped emergency --stop-now attempt with available credentials, independently verify compute removal and ingress closure, reconcile cost and keep cleanup/release gates open. Do not extend acceptance or reset an expired lease to recover operational access. No new owner grant is required merely to stop the already authorized exact resources.

## Verification scope

The focused tests use injected API/monotonic clocks and short real timers; they do not read credentials or call providers. They cover five-minute and late/expired normal deadlines, post-expiry sealed emergency cleanup without runtime input, pending/uncertain deletion, slow/error requests, stalled response bodies, ambiguous provider payloads, missing ingress, already absent compute, intent persistence, strict foreign account/application/namespace rejection and partial evidence. Existing lease-context checks remain applicable. Passing these tests is source evidence; actual provider shutdown and observed instance absence remain required in the authorized runtime window.

## Fresh arming handoff

Fresh --arm additionally requires completed watchdog-handoff.json with exactly five fields: version=1, prepared_release_sha256, runtime_sha256, watchdog_plan_sha256 and bootstrap_cleanup_retired=true. Runtime and plan digests cover the actual exact file bytes; prepared-release identity matches the validated sealed receipt. Missing/partial/altered handoff cannot arm a watchdog. The provisioning operator owns crash-safe completion/repair. This new activation prerequisite is deliberately absent from --stop-now: exact sealed cleanup remains possible after expiry or without runtime/handoff files.

## Shared credential provider

Fresh operations and the watchdog share staging-credential-provider.mjs and one fixed D-only selector at the fresh lease's provision-credential-provider.json: exactly {version:1,kind:'oauth'|'api-token'}. OAuth reads only the original Wrangler default.toml and its strict top-level token/actual expiry, without refresh, scope changes or API-token verification. API mode reads only the original deployment-token.json and verifies current active identity/expiry with the provider's /user/tokens/verify before scoped calls. The actual credential must remain valid through the required cleanup deadline; current OAuth scoped application/account/namespace observation remains mandatory. API verification fetch and response-body work share the same request signal/cleanup deadline. The selector never falls back to another token, path or environment source. Missing/expired/insufficient credentials leave shutdown unconfirmed; a new scoped emergency attempt may use the currently selected valid credential after lease expiry without authorizing runtime activation.
