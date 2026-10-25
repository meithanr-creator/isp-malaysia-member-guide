# Identity lifecycle implementation and operating gates

This is a local implementation record, not authorization to send account email, provision the real administrator, import real members or launch. Owner decisions, SMTP/mailbox verification, hosted testing and named operational recovery ownership remain release gates. Shop and Plantation Jobs remain frozen demos.

## Account access and membership authority

New users default to pending. Only an administrator-reviewed eligible membership registry entry can receive a member invitation. A linked registry email cannot be reassigned by importing another identity. Invitation creates a pending member with a random unusable-to-the-reviewer password and links the existing approved registry row; no CSV role grants are accepted. The membership registry singleton is locked before user/token changes, and its revision advances when an invitation creates/links a user or activation completes.

Activation requires an unexpired, single-use link delivered to that email, the same eligible registry row and matching email. Activation verifies control of the email and sets the account active. Production member login and every session resume still check the linked eligibility and verified email. Technical account state does not certify membership beyond this supplied authority. Ineligible/suspended users cannot recover access by resetting a password. Re-eligibility never automatically reactivates a suspended account.

Known fictional example domains and .test/.invalid/.localhost identities cannot authenticate in production. The demo route is omitted there. Local sample account entry remains available only outside production.

## Sessions and administrator verification

The encrypted, HttpOnly, SameSite=Lax cookie contains a random opaque token. Production uses Secure cookies. The database stores its SHA256 digest, user security fingerprint, activity deadline and absolute deadline. Proposed defaults are 30 minutes idle and 12 hours absolute; the owner must confirm these before pilot. Login rotates the token; logout deletes the server row. Password/email/role/account/verification/MFA recovery changes revoke old sessions. Explicit per-user revocation is available through User#revoke_sessions!. A copied cookie cannot recreate a deleted row. Legacy user_id cookies are rejected.

A production administrator receives only a five-minute database challenge after a valid password. No administrator session or privileged endpoint opens until verification. First setup uses a ROTP time-based authenticator with an encrypted setup secret. A six-digit code is verified with a 30-second drift allowance; accepted time steps cannot be replayed across challenges. Ten random recovery codes are stored only as SHA256 digests. Each code works once. The initial recovery-code display is encrypted in a short-lived server record, consumed once, and cannot be replayed with an old cookie. Password recovery retains MFA. Nonproduction can exercise the same flow with ISP_REQUIRE_ADMIN_MFA=true; existing local review passwords otherwise retain their original path.

There is no public MFA removal endpoint. Loss of both authenticator and recovery codes requires the designated recovery owner, two independent human verification channels and control of the approved hosting operator account. Possession of the email mailbox alone must never authorize the reset. Record the nonsecret incident/approval reference and hosting operator identifier; protect supporting identity evidence outside application logs. The actual named two-channel procedure and operator drill remain release gates.

After that separately recorded authorization, the host-only AdminMfaRecovery service requires production, an existing approved administrator matching ISP_MFA_RECOVERY_ADMIN_EMAIL, exact confirmation `RESET ADMIN MFA <id>`, and validated authorization/operator references. It records those references, resets to pending with a random password and unverified email, removes the old authenticator/recovery codes, and revokes all sessions, pending challenges and links. It creates no admin session and sends no email. Its separately invoked send_reactivation method requires the matching reset audit and enabled authorized account mail; the fresh link then requires email activation, password selection and entirely new authenticator enrollment. Delivery failure revokes the new link and leaves pending state. No real operator reset was performed. Configuration and a reference string cannot prove that human verification happened; retain the owner-approved procedure and its audit evidence.

## Link handling and privacy

Activation links last 24 hours; password-reset links last 30 minutes. Resend invalidates earlier links. Only delivered links are usable. Failed or ambiguous delivery revokes the token. Consumption is serialized and rechecks account, eligibility, fingerprint and purpose. Validation errors preserve a valid link for correction. GET never consumes a link.

Email links place the raw random token in a URL fragment. The server never receives it in request paths or queries. A small Stimulus controller clears the fragment and moves the token into the CSRF-protected form body; token/password fields are filtered from request logs. Link pages use no-store/private and Referrer-Policy: no-referrer. JavaScript is required, with a useful disabled-JavaScript message. Account mail instrumentation redacts encoded body/recipient metadata; mailer arguments carry only a numeric delivery record identifier rather than the token or account record. Do not add analytics, session recording or unreviewed mail tracing to these pages.

## Email remains disabled

ISP_ACCOUNT_EMAILS_ENABLED defaults off. No real SMTP send or actual administrator/member account provisioning was performed during implementation. Enabling the flag does not approve delivery. The owner must approve the sender, mailbox/domain, SMTP provider and consent; then staging must test received links, failure, revocation and retry against that provider.

Administrator invitations report sent only after the configured provider returns success. Provider failure leaves the account pending, records the failure and revokes/scrubs the link. An authorized administrator can request a fresh invitation after service restoration.

Public password-recovery HTTP requests always use the same response. They never call SMTP. Known eligible users receive a bounded encrypted outbox record; unknown, suspended, invalid or throttled addresses do not reveal their state. IP and account limits use separate keyed database counters. Enqueued is not delivered.

A separately scheduled operator task sends a bounded batch:

    bundle exec rails identity:dispatch_account_email

It requires both ISP_ACCOUNT_EMAILS_ENABLED=true and ISP_ACCOUNT_EMAIL_DISPATCHER_ENABLED=true. Default batch size is 20, hard cap 50. A row is claimed under lock, completed only by its owning lease, and never automatically resent after an attempt. An abandoned five-minute lease is failed/revoked instead of duplicated. Failed/expired/completed delivery secrets are scrubbed; the database retains token digests and minimal outcome records, not raw email bodies. A fresh recovery request creates a fresh link after an outage. SMTP acceptance still does not prove inbox delivery.

Before enabling recovery: provision an approved recurring dispatcher (proposed once per minute), name its operator and alert destination, alarm on queued age above two minutes, failed/abandoned deliveries and a stopped dispatcher, and drill outage/restart/recovery. The flag is configuration evidence only; a running monitored dispatcher and received-link drill are required. No scheduler has been provisioned by this work. Confirm retention/deletion policy for audit/token records and encryption-key backup/rotation before real data.

## First administrator: protected future process only

The owner nominated rvrameshveloo@isp.org.my. No account has been created and no invitation sent. First verify mailbox ownership, named bootstrap/recovery operators and email delivery in isolated staging, record explicit provisioning approval, configure production encryption keys and close the relevant release gates.

The operator-only AdminAccountBootstrap service has no web/CSV route. It requires production, ISP_BOOTSTRAP_ADMIN_EMAIL equal to the approved address, an explicit matching confirmation argument, enabled account mail and no other administrator. It creates only a pending admin, mails a single-use activation link, audits the result and reports no success on send failure. A retry is allowed only for the same pending first admin. It never prints a password or raw link. After activation, the first sign-in must complete authenticator enrollment and securely retain recovery codes.

Operator code after recorded approval (do not run during local review):

    AdminAccountBootstrap.call(email: ENV.fetch("ISP_BOOTSTRAP_ADMIN_EMAIL"), confirmation: ENV.fetch("ISP_BOOTSTRAP_ADMIN_CONFIRMATION"))

Remove bootstrap configuration after successful setup. Do not copy a local database, sample password or sample account to production. This mechanism does not replace the release checklist, host/proxy validation, emergency recovery ownership, independent testing or Astra review.

The owner reports planterapp.co purchased through GoDaddy as the canonical domain. DNS changes and sender verification remain separate approved release steps; no DNS or live mail change was made here.

## Fresh verification and administrative audit

A proposed ten-minute freshness window protects event/publication draft and upload writes, bank/receipt instruction changes and publication of an exact reviewed revision. Production administrators verify their current password and a new authenticator code at /admin/verification. The server rotates the database session token while retaining necessary session/CSRF state; a copied old cookie fails. Editing GET requests verify before opening the editor. A stale submitted form receives 422 with submitted text kept in memory, no draft/blob write, and a separate-tab verification link. Upload files must be selected again after a rejected save. The form can be resubmitted after verification without another login loop.

AdministrativeAction locks and rechecks actor role, active access, server session/fingerprint/deadlines and fresh MFA before mutation. Event/publication draft changes and publishing commit together with AdministrativeAudit actor, target, revision, action, outcome and time. Audit failure rolls back the database mutation. Discover uses the same contract. Membership CSV import retains its own registry-first transaction and must not be wrapped with a user-first action lock. Audit records contain no bank values, password, OTP, token or enquiry body. Owner approval of the ten-minute policy and audit access/retention remains required; no financial processing was added.