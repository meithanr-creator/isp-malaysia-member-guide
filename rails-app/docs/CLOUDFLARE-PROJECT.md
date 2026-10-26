# Cloudflare ISP project record

Verified 26 October 2026 (Asia/Kuala_Lumpur). The owner selected Cloudflare and requested a separate ISP project. All local source, tooling and evidence stay on D.

## Application project

- Worker: **isp-member-production** in the existing Cloudflare account.
- Dashboard: https://dash.cloudflare.com/a9720867333b64a4f8ee70cdfd673eb9/workers/services/view/isp-member-production/production
- GitHub: meithanr-creator/isp-malaysia-member-guide, branch production-readiness.
- Automatic builds disabled; production workers.dev and preview URLs disabled; no route/custom domain.
- Default Hello World bootstrap only. **Rails is not deployed.** No container, runtime secrets, binding or cron has been activated.
- Existing account already has Workers Paid and R2. No new subscription or paid database was purchased.
- Separate static Pages demo remains unchanged. planterapp.co DNS/nameservers remain unchanged.

## Private synthetic staging storage

Created **isp-staging-private**, Standard storage, automatic Asia-Pacific (APAC) placement. Empty at creation; no member records or publications uploaded. No custom domain; public development URL disabled. No bucket API credential was created. APAC placement is not a legal residency guarantee.

Dashboard: https://dash.cloudflare.com/a9720867333b64a4f8ee70cdfd673eb9/r2/default/buckets/isp-staging-private/settings

Rails configuration will use AWS_REGION=auto and the account HTTPS S3 endpoint. Credentials must be restricted to this bucket and stored in the ISP secret manager. Dashboard privacy is verified; authenticated read/write/delete and anonymous-denial probes are still pending. Do not infer tested backups from a private bucket.

## Connected PostgreSQL and next execution gates

Neon staging project isp-member-staging (royal-glitter-45740959), Singapore PostgreSQL18, branch production (br-floral-tree-a1hpnagn), is now authenticated, configured for PostgreSQL only, migrated and verified through local Rails/HTTP and certificate-verified TLS. See NEON-SETUP.md. No Neon credential has been installed in the Cloudflare Worker yet.

The 8d73ac0 Cloudflare package baseline passed its Linux image/real scanner smoke and adapter checks. The owner approved a bounded US$5, at most one-hour isolated Cloudflare test, followed by shutdown; it has not started. The next integration work is ISP-only Worker/R2 credentials, approved staging hostname, real hosted startup/private-object/proxy/scanner checks and combined update-memory measurement. Do not reuse CWC or another project's credentials. Public URLs/builds remain disabled until the reviewed staging setup is ready. Mail, backup restore, first-admin MFA and real mobile-device acceptance remain separate gates. No real-data import or domain cutover occurred.

Local evidence (not committed): audit/cloudflare-isp-project.png, audit/cloudflare-private-r2.png and audit/neon-setup.txt.