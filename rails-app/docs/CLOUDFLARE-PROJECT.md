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

## Next execution gates

Review and validate the Rails/scanner container and Worker adapter; then connect isolated PostgreSQL and ISP-only credentials. A specific runtime allowance is still needed before starting billed container work. Do not reuse CWC or any other project's credential. Public URLs/builds stay disabled until the reviewed configuration and operational checks justify activation. Mail, backups/restore, first-admin MFA and real mobile-device acceptance remain separate gates. No real-data import or domain cutover has occurred.

Local evidence (not committed): audit/cloudflare-isp-project.png and audit/cloudflare-private-r2.png.