# Production closure ledger — 26 October 2026

Latest disposition: see PRODUCTION-STATUS-2026-10-27.md. Local image verification is complete; registry upload and hosted/launch gates remain open.

**Decision: production NO-GO. Continue reviewed preparation and image-only work; no runtime activation. The completed Cloudflare lease must not be restarted or extended.** All project, private material and evidence remain on drive D. Shop and Plantation Jobs are frozen DEMO references; Academy and Forum remain removed. Production testing does not cover those demos.

## Evidence that can be retained

- Application image source c9a5142bd8c949c6415c3639c0113ee015f9a3f4 ran on Cloudflare. Initial full readiness returned HTTP200 after 31.72 seconds. This exposed a cold-start problem; it is not an acceptable mobile latency result.
- Nine initial hosted identity/access cases passed, with independent database reconciliation: private gate, health, anonymous denials, credential-state denials, controlled member login, administrator MFA enrollment, profile field allowlist, role boundaries and response security headers. The overall identity area remains open for its remaining cases and official email delivery.
- The first event draft POST with an image and brochure returned503. The run halted rather than replaying the mutation. Independent database inspection found zero events, publications, consultations, imports and blobs. The private R2 bucket contained zero objects. The exception origin is unknown; a generic503 is not a scanner or storage diagnosis.
- Both hosted virtual mobile attempts failed: WebKit at the cookie assertion, Chromium at landing-page navigation. No full mobile workflow or PWA pass is claimed.
- The watchdog/manual shutdown removed the container application and closed ingress. Independent verification found zero ISP applications and workers.dev/preview URLs disabled. Serving deployment1847c5bc-7b6e-4c0a-9eee-657f7c3476f1 routes to inactive Worker version d6978392-76ac-4208-aaf9-e907be1939c0; effective activation is false with blank timestamps. Latest uploaded settings are not the serving-version authority.
- Neon Free isolated restore passed:21 tables, schema/constraints/indexes and encrypted MFA fingerprints matched; the parent remained unchanged. The exact temporary branch, compute and snapshot were removed; original endpoints were preserved. Sequence state, restored writes, application recovery and attachment recovery are not claimed. The earlier two failed configuration attempts and their verified cleanup remain recorded.
- After that restore, the fixed operator captured/reconciled then removed exactly the nine controlled actors and seven registry entries. Its completion receipt reports zero controlled actors, content and blobs. No real member records or outgoing mail were involved. Throttle counters remain subject to their normal expiry; no broad deletion was performed.

## Whole-area remediation now under verification

1. **Upload integrity:** one durable operation ledger for Events, Publications and Discover; scan/validate before storage; register exact keys before PUT; authorize/lock/audit the mutation; recover only operation-owned unreferenced keys after the outer transaction; retain failed cleanup records. Uncertain keys retain non-uploadable tombstones indefinitely, even after observed absence; no time-based deletion is accepted. Recovery commits its fence before external deletion. Fixture cleanup refuses to erase those records. Tests cover partial/second PUT, database/audit rollback, failed DELETE/HEAD, scan rejection and PostgreSQL row-lock concurrency. Existing published files and saved previews remain intact on rejected edits. This is defensive hardening, not a demonstrated root-cause fix for the hosted503.
2. **Availability:** start Rails alongside scanner initialization; separate liveness, database/schema readiness and full scanner/storage readiness. Coalesce startup and cache only application readiness for two seconds within a lifecycle. Keep upload scans and download provenance checks authoritative. Preserve scanner-failure managed restart, the60-second idle policy and absolute staging lease cancellation.
3. **Virtual browsers:** the review page's no-referrer policy caused native form submissions to lose their expected Origin. A same-origin referrer policy restored native entry while keeping exact-origin validation. The isolated HTTPS fixture now proves rendered entry in both engines. Windows WebKit still reports and behaves as SameSite=None despite the emitted Strict cookie; this remains a failed security check. The pinned Linux WebKit/Chromium CI fixture now passes native/API admission, emitted Strict attributes and cross-site withholding in both engines, without weakening the assertion. Full hosted mobile acceptance remains open.
4. **Diagnostics:** another hosted run must distinguish edge startup/readiness/transport failures from a Rails response and collect redacted operation/exception evidence. Never publish cookie values, credentials, member fields, receipt details or uploaded bytes. The unknown503 must remain open until reproduced or a verified cause is established.

## Milestones and exit conditions

| Gate | Current state | Required closure |
| --- | --- | --- |
| P0 scope/guardrails | Recorded; no demo expansion | Maintain area ownership, exact source/image provenance and US$5 total incremental ceiling. |
| P1 revised source | Local regression303 tests/2528 assertions passed; three PostgreSQL-only skips. Supervisor12 tests/86 assertions passed. Edge/staging56 tests passed. | Exact revised GitHub commit, all affected CI including PostgreSQL concurrency, dependency/security checks, real scanner/image build, then Astra source review. Local results do not certify hosted behavior. |
| P2 infrastructure/recovery | Direct private R2, actual startup, stop/rollback and bounded database restore observed | Production secret lifecycle, complete data+file recovery objectives and runbook, monitoring/error evidence and production isolation. |
| P3 complete hosted acceptance | Partial; upload and mobile failures remain | Revised immutable image; observed cold/warm latency; complete Events/Discover/Publications/Consultations and remaining identity/security journeys; scanner/storage failures, restart persistence, virtual mobile/PWA and bounded resource checks. Preserve unchanged evidence and rerun affected paths only. |
| P4 controlled launch | Not released | Official sender/invitation/recovery delivery; first real administrator and reviewed member list/content; operating/support/retention ownership; agreed ongoing hosting budget; domain/TLS cutover when owner is ready; Astra final release disposition. |

Another Cloudflare runtime window needs explicit authorization after the revised package, CI, diagnostics and Astra review are concrete. Keep the existing US$5 ceiling; do not infer a new lease from the short amount of actual compute used. Actual billing is not yet verified; the earlier compute estimate is not an invoice. No paid plan upgrade, domain/nameserver change, real-member activation or identity mail is authorized by this ledger.

Primary evidence: audit/hosted-startup.json, audit/hosted-acceptance.json, audit/virtual-mobile-acceptance.json, audit/cloudflare-staging-shutdown-independent.json, audit/effective-inactive-version.json, audit/neon-restore-rehearsal.json and audit/local-browser-gate-diagnostic.json. Earlier documentation sections are historical where they say runtime has not started.

## Diagnostic and CI increment

Source5577453483275223470d0d49aebeee6df92524f4 passed six GitHub jobs, including PostgreSQL296 tests/2510 assertions with zero skips, scanner/image, security and SDK checks. Its new Linux browser job timed out during system-package installation before any browser assertion. The replacement uses the verified official Playwright1.64.1 Noble image pinned by digest, with the matching API package. This is not a browser pass.

The subsequent restricted diagnostic increment is described in STAGING-DIAGNOSTICS.md. Full local Rails303 tests/2528 assertions passed with three PostgreSQL-only skips; edge/staging56 and collector2 tests passed. Astra reviewed its privacy, lease and non-replay paths and required persistent admitted-ID memory plus preservation of the observed Rails class; both corrections and regressions are included. Exact revised GitHub CI and new image remain required. UPLOAD-RECOVERY.md documents retained tombstones and operator duties. No runtime or production approval is implied.


## Exact-source closure and fresh preparation

Source98d271dd2e105a263a214f238795b7331f7c001f passed all seven GitHub jobs, including PostgreSQL303 tests/2573 assertions with zero failures/errors/skips, real clean/EICAR scanner and unprivileged image checks, security/dependency checks, SDK bundles and the Linux browser fixture. See audit/ci-98d271d-summary.json and audit/linux-browser-gate-98d271d.json. The earlier Linux installation timeout is historical; its failure remains preserved. P1 may close for this application baseline, subject to independent review/CI of the new preparation delta. A GitHub CI image is not a Cloudflare registry digest.

Fresh lease preparation and the image-only attempts are documented in STAGING-LEASE2.md and audit/staging-2/. Local release boundary tests32/32, edge/staging56/56 and real SDK bundles passed. The complete63-case hosted inventory remains unexecuted on the revised image. No old lease extension, runtime file, fresh member fixtures or new application has been created. Production remains NO-GO.
