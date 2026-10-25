# Cloudflare ISP project record

Created and verified on 25 October 2026 (Asia/Kuala_Lumpur) following the owner's instruction to use Cloudflare and create a new ISP project.

- Project/Worker: **isp-member-production** in the existing Cloudflare account.
- Dashboard: https://dash.cloudflare.com/a9720867333b64a4f8ee70cdfd673eb9/workers/services/view/isp-member-production/production
- GitHub repository: meithanr-creator/isp-malaysia-member-guide.
- Connected production branch: production-readiness.
- Automatic builds: disabled. This saves the source connection without reusing another project's deployment credential.
- Production workers.dev URL: disabled; preview URLs: disabled; no custom domain or route.
- Bindings, runtime secrets, cron triggers and data services: none added.
- Cloudflare dashboard confirmed the account already has a paid Workers plan. No new plan, subscription, paid container or database was purchased.
- Existing Pages demo remains a separate application; no other project was edited. planterapp.co nameservers/DNS remain unchanged.

The project was bootstrapped with Cloudflare's default Hello World Worker solely to create the application. Its public URL was then disabled. **The Rails application has not been deployed to Cloudflare.** The project is not a working member service and must not receive real member records.

Before enabling builds, prepare the reviewed Cloudflare container deployment configuration and an ISP-specific least-privilege deployment credential; do not reuse CWC credentials. Before deploying Rails, validate container orchestration, external PostgreSQL, private R2, upload scanning, email, backup restoration and physical-device acceptance against the existing production milestones. No active container or external database has been provisioned by this project-creation step.

Proof of saved repository/branch and disabled builds: audit/cloudflare-isp-project.png (local audit artifact on D, not committed).