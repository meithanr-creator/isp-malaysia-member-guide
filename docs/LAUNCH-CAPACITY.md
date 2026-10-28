# Launch capacity: 5,000–10,000 registered members

Checked 29 October 2026. Operator planning note, **not a load-test result or production-capacity guarantee**. No application/configuration changes, new keys, paid API calls or new tests were made for this note.

Ten thousand registered accounts is a reasonable data-size target for this Firebase model. Cost and responsiveness depend on daily activity, simultaneous requests and downloaded bytes. A dormant account creates no recurring sign-in activity; a public visitor can generate reads/downloads without becoming a registered member. Identity Platform counts an account active when it signs in during a month and stores inactive accounts at no cost. Email/password is Tier 1: the first 50,000 MAU are currently free; the next tier is US$0.0055/MAU. Staff use authenticator TOTP, with no SMS workflow. [Identity pricing](https://cloud.google.com/identity-platform/pricing), [TOTP requirements](https://firebase.google.com/docs/auth/web/totp-mfa).

## Actual application bounds

Browser rosters, events, publications and owned enquiries/interests fetch at most 25 documents with document-ID cursors; Discover has 3 positions. There is no whole-roster browser listener. Published projections remain stable until explicit revision-bound publication. Private downloads require current membership/registry authorization and an exact clean file generation/hash.

CSV intake accepts at most 5,000 rows/2 MiB. Registry staging copies/applies at most 100 rows per confirmation call, then switches one active-version pointer. Omitted members remain; imports do not create Auth accounts, send invitations or grant administrator access. A 10,000-row first intake therefore needs at least two separately reviewed imports. Import preview/account fingerprinting and final transaction checks still read relevant existing records; the 5,000-row validation limit is **not proof that the worst-case linked-account import completes within 120 seconds**. Begin with small reviewed batches and observe actual latency before a large intake. Firestore's published limits include 1 MiB/document, 10 MiB/API request and 270 seconds/transaction; the function's 120-second limit is earlier. [Firestore limits](https://firebase.google.com/docs/firestore/quotas).

Core functions currently use min 0/max 2 instances **per function**, concurrency 4. That permits a small configured in-flight allowance for each endpoint; it does not reserve capacity for 10,000 simultaneous users. Binary download concurrency is 1, so its two instances can process only two downloads at once before platform queuing/rejection. The scanner is min 0/max 1/concurrency 1. Keep upload/announcement bursts modest until actual service timing is observed; raising instance limits requires a reviewed cost/capacity decision. A 25 MiB publication is buffered and checked before one binary response, within gen 2's 32 MB non-streaming response limit (streaming is 10 MB). [Functions limits](https://firebase.google.com/docs/functions/quotas).

## Volume and price signals

Current Singapore Firestore Standard non-CUD prices are US$0.0369/100,000 reads, 0.1107/100,000 writes and 0.0123/100,000 deletes; stored data is 0.1846/GiB-month. The default database has 50,000 reads, 20,000 writes and 20,000 deletes free per day and 1 GiB free storage. Additional guard reads, empty queries and applicable index reads also count. Cursor limits avoid paying for skipped offset rows. [Firestore pricing; select Singapore](https://cloud.google.com/firestore/pricing).

Illustrations assume two visits per active person/day and 50 returned documents/visit; they exclude guards, public visitors and other services:

| Daily active people | Returned documents/day |30-day read cost before free quota |
| --- | ---: | ---: |
|500 |50,000 |US$0.55 |
|1,000 |100,000 |US$1.11 |
|10,000 |1,000,000 |US$11.07 |

Files can dominate: 1,000 downloads of 10 MiB are 9.77 GiB; 10,000 downloads of 25 MiB are 244.14 GiB. Singapore Standard Storage currently costs US$0.02/GiB-month plus operations/transfer. Its US-only Always Free bucket allowance must not be assumed for this Singapore bucket. Private publication delivery adds gen2 compute and its applicable Internet transfer; do not price it as a free Firebase token URL or count same-region Storage→function transfer as a second Internet download. [Storage pricing](https://cloud.google.com/storage/pricing).

Hosting static files have 10 GB/month no-cost transfer, then US$0.15/GB; retained releases have 10 GB no-cost storage, then0.026/GB. Both cache hits and misses count. Gen2 functions use Cloud Run billing: Singapore request-based active CPU is US$0.0000336/vCPU-second and RAM0.0000035/GiB-second, plus requests/network and build/artifact costs. Free credits vary by service/account; they are not a whole-app US$50 promise. [Hosting](https://firebase.google.com/docs/hosting/usage-quotas-pricing), [Cloud Run pricing; select Singapore](https://cloud.google.com/run/pricing).

## Operating gates

Before onboarding real members: complete the reviewed new-workflow/scan/file proof and cleanup, owner staff-TOTP/recovery handover, reviewed registry pairing/intake, and backup plus sample restoration. Existing Auth/profile 7/7 and MFA 4/4 evidence carries; no broad replay is requested.

Watch daily reads/writes, download bytes, function latency/429/5xx, scan errors/stale definitions and backup failures. Authentication currently limits new signup to 100 accounts/hour/IP; Blaze verification mail is 100,000/day and password-reset mail 10,000/day, subject to abuse protections. Stagger onboarding rather than treating CSV eligibility as bulk signup/email delivery. [Auth limits](https://firebase.google.com/docs/auth/limits).

Keep the existing RM200 budget alerts at 25/50/75/90/100 percent and review forecast spend before raising capacity or starting mass downloads. Alerts are not a spending cap. Public endpoints and repeated authorized downloads can incur charges; authorization, deterministic writes and size limits are not a per-user billing throttle. No new abuse-control service or App Check expansion is assumed by this note.