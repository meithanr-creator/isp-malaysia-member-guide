# Rails review and release checkpoints

## Current review milestone

- [x] Ruby on Rails framework confirmed by the user.
- [x] Source, tooling, gems and temporary directory configured on D.
- [x] Rails 8.1.4 / Ruby 3.4.12 foundation boots.
- [x] Architecture and milestone plan reviewed by Astra high.
- [x] Requested five surfaces rendered and visually checked at mobile and desktop sizes.
- [x] Visitor/member/admin journeys tested independently: 61 tests / 380 assertions.
- [x] Event revision and attachment behaviour tested; default storage routes disabled.
- [ ] GitHub source commit and local run instructions recorded.
- [x] Final director review and open-issue register recorded in DIRECTOR-REVIEW.md.
- [x] Rails autoloading and Brakeman scan passed (zero warnings/errors).

## Before production activation

- [ ] Select a Rails-compatible host, production domain and approved costs.
- [ ] PostgreSQL production configuration, migrations, backups and restore exercise.
- [ ] Approved member identity source, invitations/activation, verified email and recovery.
- [ ] Administrator MFA, account recovery ownership, session expiry and revocation policy.
- [ ] Production credentials/secret storage, explicit demo-feature disablement, seeded review accounts absent.
- [ ] Private hosted asset storage, quarantine/scanning and image/PDF handling policy.
- [ ] Approved event content, bank information, receipt inbox and finance verifier roles.
- [ ] Receipt reconciliation and payment-status procedure tested with authorised staff.
- [ ] Privacy/retention/deletion decisions, notification wording and support ownership.
- [ ] Negative authorization, CSRF, throttling, concurrency and escaped-output tests pass on staging.
- [ ] Monitoring, rollback and incident response exercised.

Current page review is not production sign-off. Each unchecked production item remains an explicit gate, not an implied feature.
