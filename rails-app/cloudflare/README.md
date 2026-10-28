# ISP Rails container adapter — disabled deployment candidate

This adapter keeps the Ruby on Rails application. It is source preparation, not a live membership service or an approval to start paid compute.

## Actual Cloudflare project state

The separate `isp-member-production` Worker exists in account `a9720867333b64a4f8ee70cdfd673eb9` with a Hello World bootstrap. Its workers.dev and preview/version URLs are disabled; it has no custom domain or backend bindings. The existing GitHub repository is connected to branch `production-readiness`, with **Disable builds enabled**. The account already had Workers Paid; no plan was purchased. [Worker settings](https://dash.cloudflare.com/a9720867333b64a4f8ee70cdfd673eb9/workers/services/view/isp-member-production/production/settings).

**This adapter, its container declarations and the Rails application are not deployed.** The existing static ISP Pages demo stays separate. The coordinator separately created the empty private isp-staging-private R2 bucket; see docs/CLOUDFLARE-PROJECT.md. This adapter preparation created no database, secrets, account, email, public route, DNS record or nameserver change. Do not enable builds or run `npm run deploy` until the owner approves a bounded paid test and the isolated rehearsal setup is ready. Configure the GitHub build root as rails-app/cloudflare when enabling the reviewed build; the saved dashboard build-root value has not been verified here.

## Candidate routing and limits

The default scheduling policy supports a hard `max_instances: 1` cap. All requests use the fixed `isp-member-production` Durable Object name, proposed `standard-2` (6 GiB) size and 60-second idle sleep. The image is `../deployment/cloudflare/Dockerfile.runtime`, built with the Rails project root as `image_build_context: ".."`. PostgreSQL is external; no database or durable upload is stored on ephemeral container disk. SQLite-backed Durable Object storage is only SDK lifecycle bookkeeping.

`ISP_CONTAINER_ENABLED` defaults to `false`; missing/invalid required runtime values fail closed before acquiring an instance. The only public result while disabled is a generic 503 if the Worker is invoked internally. Public/version URLs, routes and persisted Worker/container logs remain disabled in source. Setting the flag alone does not establish scanner, database, storage, identity, sender or release readiness.

The Worker accepts only HTTPS for `APP_HOST`, obtains the platform client IP from Cloudflare edge metadata, strips incoming forwarding/internal headers and sets canonical Host/HTTPS values. One private Worker-to-Durable-Object metadata header preserves the trusted client IP for Rails login throttling; it is removed before Rails. Do not expose the Durable Object through another service binding or public gateway. Request cookies, CSRF headers, path, query, method and streamed body are preserved. WebSockets are refused because this application has no Action Cable channels.

Only the explicit production environment allowlist is passed to the container. Demo mode and dummy build secrets cannot override runtime settings; clamd is forced to loopback `127.0.0.1:3310`. The adapter waits up to 360 seconds for the runtime port, allowing 60 seconds beyond the scanner supervisor budget for Rails boot, then checks `/ready` before forwarding. It never runs migrations, seeds, account creation or mail dispatch on a request. Each application request is forwarded once with redirects handled by the browser. Errors and upstream 5xx responses become a fixed 503 without internal messages or payload logging; successful responses are no-store and nosniff.

Activity protection covers startup, uploads and the response stream through EOF/cancellation. A ten-minute overall deadline aborts/cancels requests, releases activity and lets the 60-second idle shutdown proceed, including clients that never drain a PDF. There is no indefinite activity hold. Cold-start/scanner readiness and real download behavior still need a bounded Cloudflare runtime test.

## Required backend setup

Provide Worker secret-manager values for `DATABASE_URL`, `SECRET_KEY_BASE`, the three `ACTIVE_RECORD_ENCRYPTION_*` keys, `STORAGE_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and approved `MAIL_FROM`; `APP_HOST` is the canonical hostname. Database transport must use `require` or `verify-full`. Optional S3-compatible storage endpoint must use HTTPS. Account email stays disabled by default; enabling it also requires the dispatcher flag and SMTP credentials. The allowlist is in `src/runtime.js` and follows `../lib/production_configuration.rb`.

A separately reviewed local ClamAV supervisor/image must be built and tested; runtime startup is blocked until its signatures/scanner are ready. Approved external PostgreSQL, private object storage, SMTP/sender and dispatcher schedule remain required. Warm containers must be restarted/rolled out after changing Worker secrets; changing a binding does not replace an already running process's environment. Migration/preflight, mail/EICAR/outage drills, restore/rollback, retention and owner approval remain in the production operations/review documents.

## Local and CI checks

Node 24 with all local tooling/cache/temp on D: was used for the adapter tests. `npm ci --ignore-scripts`, `npm test` and `npm audit --audit-level=high` operate only on this adapter. Tests mock the official Containers API and cover routing, activation/secrets, forwarding headers, privacy, readiness, errors and lifecycle deadlines; they do not run Linux, Docker, real Cloudflare, PostgreSQL, S3, ClamAV or SMTP. Docker is not installed locally; Linux CI must build and validate the runtime image before deployment.

Pinned versions were verified from official npm metadata on 26 October 2026: `@cloudflare/containers` 0.3.7 and Wrangler 4.152.0, with `package-lock.json` recording dependency integrity. [Containers API](https://developers.cloudflare.com/containers/api/container-class/), [Wrangler container configuration](https://developers.cloudflare.com/workers/wrangler/configuration/), [npm Containers metadata](https://registry.npmjs.org/@cloudflare%2Fcontainers/latest), [npm Wrangler metadata](https://registry.npmjs.org/wrangler/latest).

## Candidate validation and dependency correction

The 360-second port budget leaves 60 seconds beyond the scanner's bounded startup for Rails boot; the ten-minute overall request deadline still applies. Thirteen local adapter tests passed, and Wrangler's real configuration validator plus a real Containers SDK bundle completed without deployment. Linux CI repeats these checks.

Wrangler 4.152.0's Miniflare dependency pinned undici 7.29.1, which the refreshed npm audit flagged. An explicit same-major override to 7.30.1 fixes the three advisories without downgrading Wrangler or suppressing the audit. The refreshed lockfile reports zero known vulnerabilities. Remove the override only after the upstream dependency itself resolves to a maintained patched version and the checks pass. [Maintainer advisory and patched versions](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c).

Use `npm run check` for schema validation and in-memory bundling. It does not contact or deploy a Cloudflare service. Local cache/temp/config/log locations are set to D by the operator; CI uses its disposable Linux workspace. These checks do not establish hosted platform behavior or credentials.