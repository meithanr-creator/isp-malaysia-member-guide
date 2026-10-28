# Trusted upload scanner — source-only review package

29 October2026. This is milestone3 source and a proposed deployment plan, not a deployed scanner or an antivirus PASS. The18 content/core Firebase exports remain a separate reviewed deployment. Nothing here provisions resources, invokes the live project, downloads signature databases or uploads real files.

## Chosen minimal design

One private Cloud Run service in the same `isp-planter-app` project and `asia-southeast1` region receives **Firestore document-updated Eventarc events**, filtered to `contentAttachments/{attachmentId}`. It scans only the first transition to finalizedAt+generation+SHA-256+pending. This avoids a Storage-finalize race, since bytes may arrive before the existing finalize callable has computed their authoritative hash. No change to the existing callable logic or a second Firebase trigger function is needed.

The service uses the official supported ClamAV1.4.6 image, a private Cloud Storage signature mirror, the Google-managed runtime identity and actual clamscan. A separate daily Cloud Run job updates that mirror with Cisco's CVDUpdate utility. No external scanning SaaS, user API key, downloaded service-account key or Drive credential is involved. Google's reference architecture also separates file scanning from signature-mirror updates. [Google reference](https://docs.cloud.google.com/architecture/automate-malware-scanning-for-documents-uploaded-to-cloud-storage), [deployment guide](https://docs.cloud.google.com/architecture/automate-malware-scanning-for-documents-uploaded-to-cloud-storage/deployment).

The deliberate adaptation is **min0/max1/concurrency1/request-based CPU**,1vCPU/4GiB memory. Google's tutorial keeps min1 with background CPU because its clamd startup is expensive. This draft instead binds its HTTP receiver immediately, lazily obtains definitions within an authenticated request, and runs one bounded clamscan subprocess per file. There is no idle daemon or background updater. First scans will take longer; no latency promise is made. ClamAV's official guidance recommends4GiB and warns2GiB can be insufficient. Container scratch files also consume Cloud Run memory. [ClamAV container guidance](https://docs.clamav.net/manual/Installing/Docker.html), [Cloud Run memory/runtime](https://docs.cloud.google.com/run/docs/container-contract).

Files remain at their immutable original private object paths. Scanner results update trusted metadata; no clean-file bucket/copy is required. Publication still requires the existing actor/revision-bound preview and clean attestation. A clean scan is one security check and cannot guarantee detection of every malicious file.

## Source and exact trust contract

- `scanner.py`: private Eventarc receiver; authoritative Firestore re-read; one-attempt transactional lease/idempotency; exact-generation GCS download; hash/size check; format parser; real clamscan; result transaction.
- `policy.py`: allowed paths/types/limits, actual signed CVD age policy and complete-scan result policy.
- `validate_file.py`: bounded subprocess parses only the allowed JPEG/PNG/WebP or strict PDF. PDFs must be unencrypted. Decode limits prevent excessive frames/pixels/pages/content; parser failure remains blocked.
- `mirror.py`: separate one-shot signature updater with a conditional GCS lease, preserved CVDUpdate state, signed CVD verification, immutable content-addressed database objects and one final atomic manifest pointer.
- `Dockerfile` / `requirements.txt`: direct dependencies pinned from current publisher metadata. The official ClamAV registry digest was inspected without pulling/running an image. A full transitive dependency lock and actual Linux amd64 image build still require the reviewed build.

For each attachment, the scanner binds `{attachmentId,bucket,storagePath,generation,sha256,size,contentType}`. Authoritative path is exactly `contentUploads/{kind}/{parentId}/{attachmentId}` in the configured ISP upload bucket. Size limits retain images5MiB, event brochure10MiB and publication PDF25MiB. The downloaded exact generation must match stored metadata and its SHA-256; token-bearing or content-encoded objects are rejected.

A transaction writes `scanAttempt:{id,tupleHash,state:'running',startedAt,leaseExpiresAt}` before any database download or engine scan. Duplicates of the same tuple never start another scan, including after an expired lease. The final transaction re-reads authoritative metadata, requires the same tuple and attempt ID, then writes only its result. Own lease/result events are ignored because finalizedAt was already present before those updates. Missing/delayed events and failures leave publication blocked, rather than inventing a clean result.

Only real complete-success exit0 with scanned-file and zero-infection evidence, correct format, valid signed definitions and fresh actual daily.cvd can write:

```text
scanStatus: clean
scan: {
  generation, sha256, scannerId: isp-clamav-1.4.6-v1, scannedAt,
  engineVersion, databaseVersion, databaseManifestSha256
}
```

All other states are `infected`, `rejected` or `error`, with `scan:null`, private visibility and a bounded reason code. They are unavailable to members/public and fail the existing publish/download gate. This includes encryption, malformed images/PDFs, unsupported MIME, scan expansion/recursion/time limits, hash mismatch, stale definitions, crashes and operational errors. No client can set these fields. Frontend metadata may display these blocked statuses but cannot override them.

ClamAV options include max-file25MiB, max-expanded-scan100MiB, max1000 files, recursion16, max-scan120seconds, and alerts for exceeded limits/encryption/broken media. Python kills validation after30seconds and clamscan after150seconds. A heuristic/limit detection is blocked without falsely asserting it is confirmed malware. Option semantics were checked in the official1.4.6 source. [ClamAV options](https://github.com/Cisco-Talos/clamav/blob/clamav-1.4.6/common/optparser.c).

## Signature mirror and cold-start constraints

Direct freshclam downloads on every scale-from-zero instance are unsafe operationally: Google's reference warns shared Cloud Run external addresses can hit the public CDN rate limit and be blocked24hours. Cold scanners therefore read a **private same-region GCS mirror**, never the ClamAV CDN. [Google reliability guidance](https://docs.cloud.google.com/architecture/automate-malware-scanning-for-documents-uploaded-to-cloud-storage).

Proposed dedicated private mirror bucket: `isp-planter-app-clamav-definitions` (name availability/root choice pending). Scanner reads `manifest.json` and the exact immutable generations of main.cvd,daily.cvd,bytecode.cvd. Total definitions≤512MiB, each≤256MiB. Every first load verifies hashes and `sigtool --info` digital signatures, then checks the actual daily CVD header build time≤48hours old and not in the future. A fresh mirror checkedAt cannot make old signatures pass. ClamAV1.4 is supported LTS; image patch/version checks reject an unexpected engine. [CVD signatures](https://docs.clamav.net/manual/Signatures.html), [sigtool verification](https://github.com/Cisco-Talos/clamav/blob/clamav-1.4.6/docs/man/sigtool.1.in), [support policy](https://docs.clamav.net/faq/faq-eol.html).

The mirror updater restores only the bounded exact snapshot named by updater-state.json; historical remote CDIFF objects are never listed or used to choose current state. It invokes the official updater, verifies signed results, uploads new content-addressed objects, persists current state and switches the independent active signature manifest.json last. On an upstream429/tool failure, a finally path immediately persists the updated valid config/state JSON and its cooldown while retaining the prior verified database snapshot. That failure cannot reach signature-manifest activation. On success, the atomic updater-state index contains only the current locally retained/pruned CDIFF set; old remote content-addressed objects cannot displace current entries or grow the restoration listing. Existing databases are preserved across updates, avoiding repeated unnecessary full CDN downloads. Use a random non-round minute such as03:17 UTC daily; initial seed is one explicit root-reviewed job execution. Cloud Run job must have1task, parallelism1, retries0,1CPU/4GiB and a1200second task timeout. The tool's own bounded network retry behavior is separate from job retries. A failed update must be visible through Cloud Logging/job failure alerting; it never updates the pointer to a partial database. [Official CVDUpdate](https://github.com/Cisco-Talos/cvdupdate), [Google mirror reference script](https://github.com/GoogleCloudPlatform/docker-clamav-malware-scanner/blob/main/cloudrun-malware-scanner/updateCvdMirror.sh).

No background CPU is assumed. Scanner HTTP timeout proposal480seconds. A420second monotonic overall request budget starts before event parsing/authoritative reads, passes remaining time to network/subprocess calls and reserves40seconds for the result transaction/acknowledgement. A Linux POSIX interval timer is an additional best-effort Python backstop. It is not a guaranteed process kill when a native extension blocks signal handling. The explicit monotonic budgets, outer Cloud Run/operator time limits and sealed cost allowance remain required; an HTTP disconnect alone is not assumed to cancel work. A deadline failure remains blocked. Bind-before-load avoids expensive engine initialization blocking Cloud Run startup probes; /healthz means only receiver readiness and explicitly is not scan evidence. A first request can still fail from timeout/resource limits; it remains blocked and must not trigger a hidden retry loop. [Startup probes](https://docs.cloud.google.com/run/docs/configuring/healthchecks).

## Identity and deployment review checklist

These are proposed resources; none has been created here:

| Identity/resource | Proposed narrow access |
|---|---|
| `isp-scan-eventarc@isp-planter-app.iam.gserviceaccount.com` | Eventarc receiver role where required, Cloud Run invoker **only** on the scanner service. |
| `isp-upload-scanner@isp-planter-app.iam.gserviceaccount.com` | Upload bucket objectViewer; mirror bucket objectViewer; custom Firestore get/update permissions needed for the existing attachment document transaction. No Auth, Drive, mirror write, object delete or account administration. |
| `isp-clamav-updater@isp-planter-app.iam.gserviceaccount.com` | Object read/list/create/update/delete only on the dedicated mirror bucket; no Firestore/Auth/Drive/upload-bucket rights. |
| Scheduler invoker | Only the permission to execute the one mirror-update job. |
| Cloud Run scanner | Same-project private IAM service, no unauthenticated invoker, regionSingapore, min0/max1/concurrency1,1CPU/4GiB, request billing, timeout480s, no CPU boost or minimum warm instance. |
| Eventarc | Same-region Firestore updated event, database(default), document path contentAttachments/{attachmentId}, scanner destination, `--max-retry-attempts=1`. |

Firestore IAM permissions are not field-level or a substitute for application validation. Root must review the available custom-role/database IAM boundary; the source hardcodes the collection and permits only matching tuple/attempt result writes. Do not describe that permission as collection-scoped if the provider only supports database scope.

The current official Firestore trigger guide documents `--event-filters-path-pattern=document='contentAttachments/{attachmentId}'`, database(default), and `--max-retry-attempts=1` for single delivery with no retries. Root should inspect installed CLI help before creating the trigger; do not discover unsupported flags by repeated paid deployments. No new Firebase trigger export is needed. [Google Firestore/Eventarc guide](https://docs.cloud.google.com/run/docs/triggering/firestore-triggers).

Root must also review the region, actual default upload bucket, image digest/Linux amd64 resolution, direct+transitive package lock, resource memory, mirror initialization, job invocation IAM and alert receiver. The updater job uses the same image but overrides command to `python` and argument `/app/mirror.py`; the scanner default entrypoint is `/app/scanner.py`.

## Cost envelope before any paid trial

Cloud Run pricing is region- and billing-mode-dependent; free tiers are shared by billing account. Astra verified the exact embedded Singapore non-CUD tables from the official pricing page on29October2026. Request-based service rates are CPU US$0.0000336/vCPU-second and RAM US$0.0000035/GiB-second. For1CPU/4GiB this is US$0.0000476/active second, or US$0.022848 for480seconds. Job rates are CPU US$0.0000216/vCPU-second and RAM US$0.0000024/GiB-second;1CPU/4GiB is US$0.0000312/second, or US$0.03744 for1200seconds. [Official Singapore pricing tables](https://cloud.google.com/run/pricing).

Two480second scans plus one1200second seed job therefore have compute arithmetic of US$0.083136, excluding startup/shutdown, builds, image/GCS storage, operations, Eventarc, logging and data transfer. This is a planning calculation rather than a measured bill or spending cap. At1000 scans/month, service compute would be approximately US$5.712 at120seconds each or US$22.848 at480seconds each; thirty full1200second updater jobs add approximately US$1.1232 compute. Actual upload volume and all additional charges still need observation against the US$50/month planning alerts. Zero idle instances avoids permanent scanner compute usage.

The public pricing snapshot evidence is retained by root as isp-cloud-run-pricing-20261029.html (SHA-256 prefix7d4f8375, suffix91ed87 with full hash/region offsets in root's evidence). No provider price query or paid trial was made by this agent for that correction. A sealed first-deployment cost ledger and an explicit root trial allowance remain prerequisites even though the compute arithmetic is small.
Historical cumulative setup/testing authorization remains US$10 with boundUS$6.07624768 plus root's subsequent ledger. This source work incurred no scanner resource charges. Before the first build/seed/scan trial, root must verify current Singapore SKU costs and the current cumulative ledger, then assign a concrete remaining trial allowance (suggested planning reserve≤US$1.50 only if it still fits). Maximum instances, request/job timeouts and retries limit resources; budget alerts are not a spending cap. Do not deploy/provision or silently spend that reserve from this draft.

## Verification status and minimum future trial

Python syntax passes and4 original local fail-closed policy checks pass. Three additional targeted pure source-review checks pass for the overall deadline/reserved finish budget, persistence of an upstream429 cooldown before failure propagation, and exact indexed CDIFF state without historical listing. No existing core/endpoint suite was rerun for these fixes. They test tuple/path/size binding, actual daily-database freshness, complete engine-result interpretation and private content-addressed manifest shape. They do **not** run the engine or prove an antivirus PASS. No Docker build, signature seed, EICAR execution, Cloud Run request, IAM/trigger check or live clean attestation has run here.

After root/Astra source and cost review, the smallest meaningful trial is: one reviewed image build and mirror seed; one safe synthetic allowed image/PDF proving real clean tuple; one official harmless antivirus test fixture proving non-clean; one format/hash/stale/limit denial relevant to this integration; one member/public download only after trusted clean+publish, and one unchanged existing pending file remaining blocked. Use synthetic data and record exact generation/hash/engine/database evidence. Do not rerun the accepted Auth7/4 programme or broad unrelated suites.

One-attempt policy means errors do not silently retry. An operational failure requires a controlled operator decision or a fresh upload; this draft adds no new frontend rescan button. Expired in-progress leases, failed mirror jobs and stale definitions need explicit monitoring/operational handover. Abandoned uploads, staged registry versions and old signature objects require a separate manifest-aware retention policy: an age-only deletion rule must never delete an old main.cvd still referenced by the current manifest.

Source-review revision: scanner.py59B516D0..., mirror.py9FFC674A..., policy.py8CDA0FFD.... These are source-only corrections; no engine/provider trial has run.


