# Decisions and evidence

29October2026: User chose a full Firebase replacement, no Rails/Neon/Cloudflare dependency. User froze design/engineering and narrowed work to login, hosting and database, then requested Google Drive backup and capacity for5,000–10,000members. User approved dedicated Singapore project, Blaze andUS$50monthly budget alerts with explicit overage caveat; existingUS$10cumulative testing ceiling remains. User requested minimal keys/secrets and autonomous progress while asleep.

Existing approved visual source: D:/Projects/isp-member-rails/public/brand; approved CSS/page references; D:/Projects/isp-member-demo/mockups-2026-10-20. No legacy credentials, databases or synthetic backend test results are transferred as Firebase proof.

Official references:
- https://firebase.google.com/docs/auth
- https://firebase.google.com/docs/auth/web/totp-mfa
- https://firebase.google.com/docs/firestore/best-practices
- https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024
- https://firebase.google.com/docs/projects/billing/spend-caps
- https://firebase.google.com/docs/cli
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://firebase.google.com/docs/firestore/manage-data/export-import

Manual bank transfer and receipt by email remain unchanged. No payment gateway is introduced.

29 October 2026 implementation evidence: Blaze linked successfully; account currency MYR, so project-only RM200 actual-spend alerts were configured at25/50/75/90/100percent. BNM28Octreference4.0818MYR/USD (https://financialmarkets.bnm.gov.my/data-download-kl-usd-myr-reference-rate). Firestore Standard/native Singapore created with delete protection. Firebase Hosting live at https://isp-planter-app.web.app. Official Google Cloud sign-in and ADC saved under D:/Projects/isp-firebase-tools/config/gcloud; Firebase CLI additionally requires GOOGLE_CLOUD_QUOTA_PROJECT=isp-planter-app. No manual API tokens or service-account key downloads. Core member connection7/7 livePASS, adminTOTP4/4 livePASS, hosted dashboard/signoutPASS; temporary identities cleaned. No legacy checks replayed. Source/rules reviewed by Astra. Remaining feature connections, first owner onboarding, scanning and Drive backup are not production-complete.
