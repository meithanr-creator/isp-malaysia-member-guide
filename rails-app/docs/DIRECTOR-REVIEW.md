# Astra director acceptance — local Rails review

25 October 2026. Director/PMO: GPT-6 Astra high. Builder, visual implementation and independent tester: GPT-6.1 Sol extra high.

No blocking source or visual defect remains for the local seeded Rails demonstration. This is not production sign-off.

| Gate | Acceptance |
| --- | --- |
| M1 Redesigned pages | Accepted. Astra inspected saved landing, dashboard and desktop-admin screenshots. The coordinator checked all five surfaces at 390px and narrow/desktop layouts at 320/1440px. |
| M2a Local identity | Accepted for sample accounts: password sessions, server-derived roles, constrained returns, CSRF, rate limiting, logout and production-disabled demo entry. |
| M3 Local publishing | Accepted: strict edit-version checks, stale-preview rejection, locked publication, draft/published isolation, shared renderer and protected attachments. |
| M4 Local interests/receipts | Accepted: ownership, published snapshot/revision capture, unique database constraint, withdrawal and user-operated email draft. |
| M2b/M5 Production identity and hosting | Pending; outside this approval. |

Independent suite: 61 tests, 380 assertions, zero failures/errors/skips. Final coordinator rerun and Brakeman/autoloading results are in TEST-REPORT.md.

The coordinator verified member login → exact selected event → interest → dashboard → logout, and admin image upload → preview → edit → preview revision 2 → public publication. No real emails or payments were sent.

The green/cream palette, serif headings and ISP crest are consistent. Top-right account access is clear, the landing body has no duplicate dashboard action, and the bottom bar contains Events only. Form fields and the menu remain within narrow screens.

## Evidence

Local screenshots in `D:\Projects\isp-member-rails\audit`: landing.png, login.png, dashboard.png, admin-form.png, event-preview.png and desktop-admin.png. These contain fictional review records. Source delivery is recorded in DELIVERY.md.

## Limits retained

### M6 Discover refinement acceptance

Astra inspected menu-refinement.png, discover-editor.png and discover-public.png and approved their responsive local design. The menu omits Academy/Forum and clearly labels Shop/Jobs DEMO; the public CTA is exactly Click to Access Website. Source review accepted admin-only access, optimistic edit tokens, image validation/replacement and current-slide image delivery. The independent tester identified an active invalid URL in the rejected-save preview; the shared server HTTPS validator now removes that href, and the amended suite passed 87 tests / 620 assertions. Physical iOS/Android compatibility is not certified by this review.

- Simultaneous duplicate HTTP requests are not proven gracefully idempotent; the unique database index prevents duplicate records, but controller recovery from a uniqueness race is not implemented. Sequential duplicate submissions are tested.
- Production membership verification, recovery, MFA, revocable sessions and distributed throttling remain pending.
- Hosted private storage, file quarantine/scanning, image processing, finance reconciliation, monitoring and backup/restore remain pending.
- Browser verification is desktop Chromium at responsive sizes; physical iOS/Android and assistive-technology testing remain future acceptance work.
