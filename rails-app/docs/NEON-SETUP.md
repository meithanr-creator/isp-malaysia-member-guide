# Neon PostgreSQL setup and verification

Updated 26 October 2026, Asia/Kuala_Lumpur. Project and evidence: D:\Projects\isp-member-rails. Tooling: D:\Projects\isp-rails-tools. This increment connects the existing Rails app to Neon PostgreSQL; Cloudflare remains the selected Rails host.

## Target and scope

- Organization: org-purple-wave-74281967.
- Existing project: isp-member-staging, royal-glitter-45740959; AWS Singapore; PostgreSQL 18.
- Branch: production, br-floral-tree-a1hpnagn (default). Its name does not change this project's approved synthetic staging scope.
- Neon services: PostgreSQL only. Existing Rails identity and private R2 remain the design.
- Owner-approved Cloudflare test allowance: at most US$5 incremental spend, at most one hour, then stop. No billed Cloudflare runtime has started through this database setup.

## Completed setup

Official neon@latest resolved to 8.11.4, installed globally with npm prefix D:\Projects\isp-rails-tools\npm-global. Cache, temp, npm configuration and Neon CLI credentials stay on D. The user completed browser CLI authorization. No credentials are recorded in this document or source control.

Executed from the Rails project root:

    neon init -y --org-id org-purple-wave-74281967 --project-id royal-glitter-45740959 --branch production --services postgres --no-agent-setup --package-manager npm
    neon config plan
    neon deploy

Commands use the dedicated D:\Projects\isp-rails-tools\neon-auth configuration directory and disable CLI analytics. --no-agent-setup avoids default global agent configuration on C. Official neon and neon-postgres skills were installed separately in this project's ignored .agents directory and consulted.

Plan and deploy both returned:

    No changes — branch production already matches the policy.
    Utilized services: Postgres
    Pulled 3 Neon variables into .env.local
      Postgres DATABASE_URL, DATABASE_URL_UNPOOLED
      Branch   NEON_BRANCH

The ignored .env.local contains the pulled URLs and local verified-TLS settings. Never copy it into Git, screenshots, an image build, or a chat. A later Neon env pull/deploy may restore provider-default sslmode=require; retain verify-full for both URLs and the CA configuration before using these helpers. Direct maintenance rejects a weaker or duplicate sslmode, endpoint changes, pooled maintenance URLs and query target overrides.

## Application wiring

Rails retains Active Record and pg 1.6; no JavaScript database driver replaces it. The helper reads dotenv values as data, never shell code, and passes them only to child processes. Application traffic uses pooled DATABASE_URL; migration and persistence checks use DATABASE_URL_UNPOOLED. Connection target checks bind maintenance to NEON_VERIFY_HOST. The operator set both URLs to sslmode=verify-full and PGSSLROOTCERT to the installed Ruby CA bundle on D. The Linux container uses its installed /etc/ssl/certs/ca-certificates.crt.

Use npm entry points with Node 24 and Ruby tooling available:

    npm run build
    npm run verify:neon
    npm run migrate:neon
    npm start
    npm run test:neon-e2e
    npm run test:neon-tools

Build runs real Rails production asset compilation with output under tmp/neon-build/assets, followed by the real Cloudflare configuration/SDK bundle check. The existing task-only asset-build dummy guard is used; no fake runtime secret or validator bypass is added. Schema dumping during local Neon migration is isolated under tmp/neon-build/schema.rb. The existing 4180 SQLite review preview is preserved. npm start runs the Neon-backed development app on 127.0.0.1:4181 with a separate PID file.

## Verified outcomes

- npm run build: exit 0; Rails assets and real Cloudflare bundle (63,700 bytes) passed.
- Five environment/target safety tests passed, including literal shell syntax, child-only environment isolation and duplicate TLS-parameter rejection.
- Before migration, the new database had zero public tables. All 14 existing Rails migrations completed through the direct connection; no seeds or account/member import ran.
- Real Ruby pg connections used certificate/hostname verification, TLSv1.3 and TLS_AES_256_GCM_SHA384. Both connections passed create/read/update/delete and cross-connection persistence checks; their unique synthetic table was removed.
- The running Rails app wrote one clearly labelled synthetic DiscoverSlide in an unused position. A separate direct connection read it, and HTTP GET on the landing page rendered its unique marker. Three member routes redirected an anonymous client to login with no-store headers. The exact synthetic row was removed in ensure and independently confirmed absent.
- App remained reachable with HTTP 200 after the test. This is local development PostgreSQL/HTTP evidence, not hosted production, private R2, SMTP, MFA or file-scanner acceptance.

## Failures and limits

The first init linked offline and failed to install dependencies because the manually bundled npm launcher was not in the expected D tool root. Corrected the launcher placement, installed dependencies and reran init authenticated successfully.

The first probe used PG.connect(dbname: URL), which this driver does not expand as a positional connection URL. It now uses libpq conninfo parsing. A subsequent strict host comparison also rejected Ruby pg's six repeated DNS candidates for the same approved endpoint; the corrected check requires a nonempty list with every candidate exactly matching the approved host. Neither failure created application records. The final probe passed.

Neon's proxy terminates client TLS, so backend pg_stat_ssl describes a different hop. The check uses the actual libpq ssl_in_use?, negotiated attributes and effective verify-full mode rather than claiming backend pg_stat_ssl proves client transport.

Local Windows asset build reports an unavailable libvips warning and two Propshaft font-resolution warnings. The packaged fonts exist under public/brand and the build exits successfully. This task does not prove Windows image processing; the Linux runtime already installs libvips. No upload was used in the database check.

Astra accepted the corrected bounded integration source at read-only review. The new increment's exact GitHub commit/CI result is recorded in PR #1 and the local audit record. Do not run Rails db:reset, db:drop or the destructive test suite against this staging branch. Hosted Cloudflare/R2/scanner integration, mail delivery, first-admin MFA/recovery, backups/restore and actual iOS/Android acceptance remain release gates.