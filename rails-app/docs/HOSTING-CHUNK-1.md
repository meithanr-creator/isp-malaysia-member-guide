# Current milestone — Rails and Neon verified on Cloudflare

Observed27October2026 at23:19:43 Malaysia time. The corrected private probe returned Rails /up HTTP200 and /app-ready HTTP200. The latter returns its exact success body only after a PostgreSQL SELECT1 and pending-migration check. The existing approved Neon URL and certificate verification remain unchanged.

Astra reviewed the forwarding fix before live execution and independently accepted the saved live receipts afterward. Both requests now use the configured public hostname consistently in the URL and forwarding headers; Rails hostname security remains enabled. A fresh ISPNeonProof namespace preserves the earlier stopped controller. The unchanged pinned Rails image was used.

Source9f986c93d4c4ef294ce5fd16db527ef0387e16ff passed all required CI in push40529068461. All105 local adapter/startup checks and pinned Wrangler dry-run passed. The container stopped, and parent plus independent watch confirmed the exact application absent and ingress closed by23:19:59. The test used one fixed six-minute limit. Conservative commitments/reservations totalUS$4.50 withinUS$5; actual billed usage is not asserted.

| Gate | Status | Evidence / remaining condition |
| --- | --- | --- |
| Hostname forwarding | PASS | Consistent configured authority; local Rails host-policy reproduction and hosted corrected readiness response |
| Rails startup on Cloudflare | PASS | /up HTTP200 |
| Hosted Rails-to-Neon readiness | PASS | /app-ready HTTP200; SELECT1 and pending-migration check |
| Shutdown | PASS | Container stopped; both controllers confirm app absent and ingress closed |
| Full hosting readiness | INCOMPLETE | Private-file/scanner and recovery evidence remain |
| Full hosted member/admin/mobile acceptance | OPEN | Startup/database proof does not close the63-case business acceptance inventory |
| Production launch | NO-GO | Remaining hosting/workflow/mail/operations/domain gates and final director decision |

Public receipt: audit/staging-3/neon-forwarding-live-proof.json. All local source, tooling, credentials and evidence remain on driveD. Earlier checkpoints below are historical.

---

See docs/RAILS-STARTUP-CHECK.md for the run boundaries. Shop and Plantation Jobs remain frozen DEMO; Academy and Forum remain excluded.
