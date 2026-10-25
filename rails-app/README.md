# ISP member and events — Rails review

A native Ruby on Rails application for reviewing the next ISP member and event experience. Ruby 3.4.12, Rails 8.1.4, ERB, Stimulus and SQLite. Project and runtime live on drive D.

## Review the experience

- Public landing: top-right member access, Discover carousel and Events-only bottom bar.
- Events: visitors can browse published details; registering interest requires a member session.
- Member dashboard: own profile, saved event interests and withdrawal.
- Admin: save an event draft, upload images/PDF brochure, review the exact event page, edit and publish a reviewed revision. A new draft does not overwrite the existing published version.
- Payment instructions: fictional bank details and an email-app link. No money or email is sent; opening the email app is not proof of payment.

Other concept areas remain clearly labelled links to the earlier static demonstration. This phase migrates member access, profiles and event publishing.

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

Run checks with `& .\script\rails.ps1 test` on this computer, or `bundle exec rails test` elsewhere. The tests use a separate SQLite test database. GitHub checks also run Rails autoloading and Brakeman analysis.

## Delivery controls

See [the implementation plan](docs/PLAN.md), [milestone board](docs/MILESTONES.md), [release checklist](docs/RELEASE-CHECKLIST.md) and [run/hosting notes](docs/OPERATIONS.md). Astra high directs and reviews; Sol 6.1 extra high implements and independently tests.

This is a local foundation, not a live membership service. Production still requires approved member verification, account recovery, administrator MFA, session lifecycle, hosted storage/scanning, finance ownership, backups and compatible hosting. Cloudflare Pages cannot run the Rails application process. The earlier Cloudflare demo remains separate.

Never commit local keys, environment secrets, database files, uploads, logs or temporary files. Do not enable seeded review accounts for a hosted production service.
