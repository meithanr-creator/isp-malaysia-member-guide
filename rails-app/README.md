# ISP member services — Rails production preparation

A mobile-first Ruby on Rails member portal. Ruby 3.4.12, Rails 8.1.4, ERB and Stimulus; SQLite for local review and PostgreSQL for production. Project and runtime live on drive D. The production candidate is under review; it is not a live member service.

## Review the experience

- Public landing: top-right member access, Discover carousel and Events-only bottom bar.
- Discover administration: use the admin menu's **Edit Discover ISP** entry to edit three cards inline, including picture, tag, title, description and website. Save updates the homepage. All card buttons read **Click to Access Website**.
- Events: visitors can browse published details; registering interest requires a member session.
- Member dashboard: own profile, saved event interests and withdrawal.
- Admin: save an event draft, upload images/PDF brochure, review the exact event page, edit and publish a reviewed revision. A new draft does not overwrite the existing published version.
- Payment instructions: fictional bank details and an email-app link. No money or email is sent; opening the email app is not proof of payment.

Membership, Publications and Consultation are native Rails services. Shop and Plantation Jobs are the only frozen links to the earlier static demonstration; no further demo features are being built.

Academy and Forum shortcuts are removed from Rails; Shop and Plantation Jobs have explicit DEMO badges. Mobile-first layouts target iOS and Android browsers. See [mobile review coverage](docs/MOBILE-QA.md) for executed responsive checks and the pending physical-device checklist.

## Run on this Windows computer

From PowerShell in `D:\Projects\isp-member-rails`:

```powershell
& .\script\rails.ps1 db:prepare
& .\script\rails.ps1 db:seed
& .\script\rails.ps1 -RailsArguments @('server', '--binding=127.0.0.1', '--port=4180')
```

Open http://127.0.0.1:4180. The address works on this computer while the server runs. The launcher uses Ruby, gems and temporary files under `D:\Projects\isp-rails-tools`.

The login page offers local sample-account entry. The seeded accounts are `member@example.com` / `MemberDemo!2026` and `admin@example.com` / `AdminDemo!2026`. These are public fictional review credentials, not production accounts. Demo entry and sample seeding are disabled in production. Use fictional inputs only: the local database persists changes.

## Other development environments

From the repository's `rails-app` directory, install the pinned Ruby version and run `bundle install`, `bundle exec rails db:prepare db:seed`, then `bundle exec rails server`. The Windows helper is specific to the D-drive installation.

Run checks with `& .\script\rails.ps1 test` on this computer, or `bundle exec rails test` elsewhere. The tests use a separate SQLite test database by default; TEST_DATABASE_URL selects PostgreSQL. The production-readiness workflow runs both database suites, Rails autoloading, Brakeman, dependency audit and a Linux production-container build. See the production review for executed results and remaining evidence.

## Delivery controls

See [the implementation plan](docs/PLAN.md), [milestone board](docs/MILESTONES.md), [release checklist](docs/RELEASE-CHECKLIST.md) and [run/hosting notes](docs/OPERATIONS.md). Astra high directs and reviews; Sol 6.1 extra high implements and independently tests.

Production preparation now includes administrator-reviewed membership imports, invitations and recovery, administrator MFA, revocable sessions, private-upload scanning, a mobile manifest and a network-only service worker. These controls require final independent validation and hosted operational evidence. The intended domain is planterapp.co, purchased through GoDaddy; nameservers and DNS remain unchanged. Hosting/cost, mail delivery, private storage, scanning and backup/restore setup remain pending. Cloudflare Pages cannot run the Rails application process; the earlier static demo remains separate.

Never commit local keys, environment secrets, database files, uploads, logs or temporary files. Do not enable seeded review accounts for a hosted production service.

## Member services

- Membership is the native `/member/membership` page, showing the signed-in member's stored profile. CPD and the legacy membership redirect are removed.
- Publications live at `/member/publications`. Only signed-in members see published issues and protected cover/PDF files. The homepage shows the latest two issues to members, or a generic login invitation to visitors.
- Administrators use menu → Manage publications to upload a PDF book (25 MB maximum) and JPG/PNG/WebP cover (5 MB), edit the title/description, preview, then publish the reviewed version. Later drafts do not change the member version until published again. The library starts empty; do not invent or upload unauthorized ISP issues.
- Consultation is a member enquiry at `/member/consultation_requests`. Members submit a question and see their own references/history. Administrators use menu → Consultation enquiries to read the inbox. The app does not send an email, book a consultation or take a payment.
- Shop and Plantation jobs remain the only legacy demo links.

These are persisted Rails workflows in the local review environment. Production identity, storage operations and hosting remain separate pending gates.
## Production candidate

The working branch is `production-readiness`, reviewed in [pull request #1](https://github.com/meithanr-creator/isp-malaysia-member-guide/pull/1). Follow [the production milestones](docs/PRODUCTION-PLAN.md), [Astra's review](docs/PRODUCTION-REVIEW.md), [identity operations](docs/IDENTITY-LIFECYCLE.md), [membership import](docs/MEMBERSHIP-IMPORT.md) and [production operations](docs/PRODUCTION-OPERATIONS.md). Earlier M0–M7 records describe local demonstration acceptance and do not certify this production increment.

The administrator imports a bounded CSV through upload → review → confirm. Import changes eligibility without automatically activating accounts or sending invitations. A separate invitation and verified password setup activate an eligible account. Production administrator access requires MFA, and sensitive edits require recent verification. Events and publications retain draft → exact preview → publish; administrator changes have transactional audit records. Event interests have a read-only administrator roster and remain requests rather than confirmed bookings.

Use `.env.example` as a configuration template, never as working credentials. No real administrator/member, membership list, mail delivery, DNS change or paid hosting has been created as part of local preparation. A fresh production database must not inherit local sample data or unscanned uploads. The PWA deliberately does not cache private pages or provide offline member access. Physical iOS/Android acceptance remains required.