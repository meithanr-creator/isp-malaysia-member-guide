# Rails with a private local scanner: Cloudflare container package

Prepared 26 October 2026. This package has not been deployed or approved for production. It changes only deployment/cloudflare files. The application, scanner whitelist, production validation, database migrations and application tests remain unchanged. No account, paid resource, real upload, external scanner account or scanner credential is created.

## Packaging choice and verification

Dockerfile.runtime builds from the project-root context and installs the official **ClamAV 1.4.6 LTS linux/amd64 DEB**. This exact version is already accepted by UploadScanner::SUPPORTED_ENGINES. It does not depend on a distribution repository serving an old/backported engine, and does not copy incompatible Alpine executables into Debian. Upstream documents that its DEB includes external library dependencies statically and installs to /usr/local on Debian-compatible systems. Other architectures deliberately fail the build until separately pinned/reviewed.

The build pins all three artifacts:

- Official DEB SHA256: d3ee9e401974855a1edc1761b1425417d126de618d5f0c91cd51209f69f6fcc2.
- Detached signature SHA256: 95bf86dad9b210164549a7369b6087d3f2e7f0976239e5693071bbae17406009.
- ASCII Cisco Talos public key SHA256: 5bfca75f112f04b89cd992f5f925018e8dfc28e0e7f6e33f6a4c33ed9e29d911; primary fingerprint 5BADCA2665EF59DCF8A23D8B707F0DB480836771.

It verifies the detached signature and confirms installed engine output equals 1.4.6. The public key is ASCII source, not a private credential. Only the verified installer crosses build stages, via a BuildKit read-only mount. Verify current upstream support, release signatures, application whitelist and image vulnerability results whenever updating this pin. A version pin must not become a reason to retain an obsolete patch.

Authoritative references inspected:

- [ClamAV support matrix](https://docs.clamav.net/faq/faq-eol.html): 1.4.6 is the listed latest 1.4 LTS patch; current expected LTS support ends 15 August 2027.
- [Official 1.4.6 release assets and published checksums](https://github.com/Cisco-Talos/clamav/releases/expanded_assets/clamav-1.4.6).
- [Upstream installer compatibility and GPG verification](https://docs.clamav.net/manual/Installing.html).
- [Upstream 1.4.6 daemon directive reference](https://raw.githubusercontent.com/Cisco-Talos/clamav/clamav-1.4.6/etc/clamd.conf.sample).
- [ClamAV container memory/signature guidance](https://docs.clamav.net/manual/Installing/Docker.html).
- [Cloudflare instance sizes](https://developers.cloudflare.com/containers/platform/limits/).

## Runtime boundary

All managed processes run as UID/GID 1000. Application source, daemon configs and binaries are root-owned; only logs/tmp/storage scratch, scanner database and scanner temporary paths are writable. No PostgreSQL server or durable member data belongs on the container filesystem. PostgreSQL remains an external managed service over TLS; uploads use the configured private object store. Ephemeral signatures are safe to discard and refresh. Database migrations are an explicit separate approved operation, never an entrypoint action.

Only application port 3000 is exposed. clamd binds **127.0.0.1:3310**; there is no public port mapping, Worker route or external scanning credential. The supervisor rejects a different scanner host/port. This colocated non-root runtime isolates the unauthenticated scanner from the network; it does not create a separate security identity between Rails and its local helper.

Image builds preload public signed signature databases. On every start the supervisor runs a bounded freshclam update, starts foreground clamd and uses the existing UploadScanner readiness protocol before starting Puma. The existing policy checks accepted engine, numeric signature revision, age at most 48 hours and at most one hour into the future. The startup budget is 300 seconds, then processes receive TERM with a 20-second shutdown grace before KILL. Coordinate the Worker port/readiness budget above this startup interval, including the first signature download; a 180-second proxy budget is insufficient evidence. Do not shorten startup by disabling freshness or production configuration validation.

After readiness it runs the foreground updater and Puma. Every required child is monitored; unexpected exit stops the others. Scanner readiness/freshness is checked every 30 seconds. Independently, every application upload performs the existing readiness and INSTREAM checks and cannot store bytes on scanner failure. SIGTERM/SIGINT reaches the supervisor through tini and is forwarded to managed process groups. Failed cold starts return failure rather than launching Rails with a missing/stale scanner.

freshclam uses only the official DNS/HTTPS signature service. Required egress includes current.cvd.clamav.net DNS and the official ClamAV download service over HTTPS. No custom mirror, proxy password or fallback scan bypass is configured. clamd SelfCheck observes database updates within 60 seconds; concurrent database reload is disabled to reduce double-load memory. Update/download errors and CDN rate limiting must be tested with the chosen container lifecycle; avoid needless cold-start loops and full database downloads.

Archive/PDF scanning, heuristic alerts, encrypted-document/archive alerts and limit alerts are explicit. ClamAV FOUND outcomes, including encryption/limit heuristics, never receive clean metadata. Stream size is 25 MiB, expanded scan limit 100 MiB, nesting 16, file count 1000 and archive scan time limit 12 seconds. The application retains its independent 15-second exchange deadline. MaxScanTime does not guarantee a universal wall-clock bound for every parser; the client timeout still fails closed. Real encrypted-PDF/archive and nested-limit fixtures remain part of the required scanner integration drill.

Docker HEALTHCHECK requests the actual /ready endpoint with APP_HOST and expects the controller's exact `ready` body. That existing endpoint checks PostgreSQL, pending migrations, private object-store access and scanner readiness. It does not run migrations or create a test object. No production secret is baked into assets; only the existing narrowly permitted asset-build dummy path is used.

## CI commands and evidence

From the project root, with the normal development/test bundle available:

    bundle exec ruby deployment/cloudflare/supervisor_test.rb

This is a standalone Ruby test file: no Rails environment, database setup or application migrations are loaded. It exercises process ordering, update failure, startup bounds, shutdown, child/freshness failure, scanner-only mode, actual VERSION/INSTREAM client framing and encrypted/limit FOUND rejection against synthetic local protocol responders. These responders do not certify ClamAV's real encrypted-file parser.

Build the actual Linux image (Docker/BuildKit required):

    docker build --platform linux/amd64 -f deployment/cloudflare/Dockerfile.runtime -t isp-cf-ci .

The context is the PROJECT ROOT, not deployment/cloudflare. Dockerfile.runtime.dockerignore excludes keys, env files, local databases/uploads/logs, node_modules and .wrangler state. Wrangler must set an equivalent root context or the coordinator must intentionally integrate this reviewed Dockerfile into the root packaging; pointing at the existing root Dockerfile alone does not include this scanner.

Run the bounded real scanner smoke without app/DB/mail/storage secrets:

    docker run --rm --no-healthcheck --memory=6g --cpus=1 isp-cf-ci --scanner-smoke

The same non-root supervisor updates signatures and starts clamd; the smoke streams synthetic clean bytes and standard benign EICAR bytes through the unchanged UploadScanner implementation, checks integrity metadata for clean bytes and requires explicit detection/no clean metadata for EICAR. EICAR is assembled only in memory; no actual malware or host test file is written. Smoke mode never starts Rails. It validates scanner startup/config/engine/signatures and the real protocol, not hosted Rails readiness or production application credentials.

Additional CI checks should record image User=1000:1000, exposed ports only 3000, installed clamd/freshclam versions and successful config startup; scan the final image and record its immutable digest. Keep logs free of environment dumps and secret values.

## Staging gates and resource contract

Proposed size is **Cloudflare standard-2, 1 vCPU / 6 GiB**, maximum one initial instance, subject to owner cost approval and actual staging measurements. No capacity was provisioned. ClamAV documentation recommends 4 GB for ClamAV; that is not evidence that Rails plus signature validation/reload fits a 4 GB container. Record steady Rails+clamd RSS and peak during concurrent upload plus background freshclam TestDatabases validation/update; ConcurrentDatabaseReload=no alone does not bound that overlap. Increase capacity or revise the approach if OOM/headroom/scan latency fails; do not disable scanning. A 4 GB alternative is conditional on a separately approved measured staging result.

Before deployment approval: Linux image build and real smoke pass; package signature/version checks pass; cold starts and platform health budget align; scanner crash/staleness/update outage and SIGTERM drills pass; encrypted/limited inputs are rejected; peak memory and 25 MiB latency fit; network verifies no access to 3310; real /ready is healthy using approved external PostgreSQL/private storage; migration and backup/restore procedure is reviewed; concrete runtime-cost/setup permissions are resolved and the release record references the existing production intent. SMTP/account email remains governed by existing disabled-by-default flags. This package does not imply an active scheduler, received identity emails, first-admin provisioning, DNS changes or production readiness.
