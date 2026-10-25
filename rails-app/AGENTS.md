# ISP Rails production work rules

- Ruby on Rails is the required application framework. Preserve the selected mobile design and existing member/public/admin authorization boundaries.
- Project, tooling, temporary files and test evidence belong on drive D. Do not copy production/member data, credentials, uploads or databases into source control.
- Production direction/review belongs to Astra (high); implementation and independent test work use GPT-6.1 Sol (extra high) when available and requested. Keep agent file ownership explicit and serialize shared database tests/migrations.
- Shop and Plantation Jobs are frozen demo references. Do not develop either or restore Academy/Forum without a new owner request.
- Use docs/PRODUCTION-PLAN.md for milestone gates and docs/PRODUCTION-REVIEW.md for current evidence and unresolved decisions. Passing local tests is not production approval.
- Use the production-readiness branch and a reviewed pull request; preserve the earlier static demo and local-review release history. Verify the remote head before updating a branch.
- Member eligibility comes from an administrator-reviewed membership list. Importing rows must not activate accounts, grant admin privileges or send mail implicitly. Preserve reference identifiers and reject identity collisions.
- No live member import, real account provisioning, outbound identity emails, paid hosting purchase or public production deployment until the corresponding owner decision and release evidence are recorded. Ordinary reversible coding, local synthetic tests and fixes remain authorized.
- Never represent missing MFA, email recovery, scanning, backups, physical-device checks or staging tests as complete. Fail closed when required identity, storage or scanner checks fail.
- Every completed milestone needs changed-file scope, test results, exact GitHub commit and review outcome. Reopen affected gates when a check fails or a relevant implementation changes.
