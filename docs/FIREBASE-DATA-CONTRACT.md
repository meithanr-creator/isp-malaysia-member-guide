# Firebase data and callable contract

Milestone 3 implementation, 29 October 2026. This document describes source implemented in `functions/`, not a live deployment or production approval. Existing Auth/MFA/core proof results are separate and were not rerun. No service-account key, live import, identity email, cloud invocation or deploy was performed for this backend work.

## Runtime and authorization

- Firebase gen2 Functions (17 callables and one authenticated HTTP binary endpoint); `asia-southeast1`; `minInstances: 0`, `maxInstances: 2` per callable, concurrency 4, 256 MiB, timeout 120 seconds; Node 22 deployment engine. Local build used the existing D-drive Node 24 runtime.
- Functions initialize the Google-managed Admin SDK with ambient credentials. They do not accept credentials, claims or roles in request data.
- Member operations require a verified ID-token email and `members/{uid}.status == approved`. Missing membership denies access.
- Administrative operations require verified email, server-owned `admin: true`, `staff/{uid}.active == true`, and ID-token `firebase.sign_in_second_factor == totp`. Transactional writes re-read staff in the write transaction. Admin access is independent of the member eligibility registry.
- Once `registryState/current.activeVersion` exists, member access additionally requires a server-owned `members/{uid}.registryKey`, equal to SHA-256 of UTF-8 trimmed membershipReference, and a matching active registry row: same memberReference and normalized email, `status == eligible`, `accessSuspended != true`. Token email must match that row too. Before any active registry version exists, the existing approved-member gate remains unchanged.
- **Migration consequence:** an approved account without registryKey is denied member access after the first registry activation. Pairing must be performed through a separately controlled server process, preserving exact existing email/reference pairing. No browser may write registryKey. Imports create no Auth accounts, approve no accounts, send no invitations and grant no administrator claims.
- All content, consultation, interest, attachment reservation and registry writes below use callables. Core profile writes remain under the existing narrowly allowed profile rules owned by root.

## Collections and access

| Collection | Shape / intended client reads |
|---|---|
| `eventDrafts/{id}` | Admin only. Draft record below. |
| `events/{id}` | Public published projection only. |
| `discoverDrafts/{1..3}` | Admin only; exactly three positions. |
| `discover/{1..3}` | Public published projection only. |
| `publicationDrafts/{id}` | Admin only. |
| `publications/{id}` | Approved-member metadata only. |
| `contentAttachments/{attachmentId}` | Server-owned metadata; admin inspection and narrowly authorized published file reads only. |
| `consultations/{id}` | Owner approved member or admin. Immutable ownerUid/requestKey; received enquiry, not confirmed booking. |
| `eventInterests/{eventId}__{uid}` | Owner approved member or admin. One interest per member/event. |
| `memberRegistryPreviews/{id}` | Admin metadata only; sensitive preview rows are private Storage JSON, never in this Firestore document. Callable preview access additionally checks actorUid. |
| `registryState/current` | Server-owned `{activeVersion, revision, updatedAt, updatedBy}`. Rules may read to enforce eligibility. |
| `memberRegistryVersions/{versionId}` | Server-only version metadata. |
| `memberRegistryVersions/{versionId}/entries/{registryKey}` | Server-only immutable version rows `{name,email,memberReference,status,accessSuspended}`; rules use exact single-row lookup. |

Draft document: `{data, revision, preview, publishedRevision, publishedAt, createdAt, createdBy, updatedAt, updatedBy}`. Initial saved revision is 1. `preview` is null or `{actorUid,revision,digest,tokenHash,expiresAt,bindings}`. A save clears the preview and increments revision. Revision replaces the old separate Rails lockVersion.

Projection: `{revision,data,publishedAt}`; document ID is supplied separately as `id` by adapters/lists. Unpublished edits do not modify the last projection. Publish updates the projection and draft publish metadata in one transaction. Timestamps are Firestore Timestamp in storage and ISO UTC strings in callable responses.

Every list is a bounded document-ID cursor page of 25; no browser-wide member reads or listeners. Direct authorized SDK reads may fetch a single draft or projection by document ID.

## Callable API

Use `getFunctions(app, 'asia-southeast1')` and `httpsCallable`. Unless shown otherwise, optional cursor is omitted for the first page. Unknown request fields are rejected. Event/publication IDs accept 1–80 ASCII letters, digits, `_` or `-`; the frontend may allocate a stable 16-hex ID before first save to avoid duplicate creates after an ambiguous network result. Repeating a save at an already advanced revision returns a conflict; reload before continuing.

| Callable | Request | Response |
|---|---|---|
| `saveContentDraft` | `{kind,id?,expectedRevision,data}` | `{id,revision}` |
| `previewContentDraft` | `{kind,id,expectedRevision}` | `{id,revision,data,attachmentStatus:'clean'|'pending',previewToken,previewExpiresAt}` |
| `publishContentDraft` | `{kind,id,expectedRevision,expectedPreviewToken}` | `{id,revision,publishedAt}` |
| `listContentDrafts` | `{kind,afterId?}` | `{items:[{id,revision,data,previewRevision,publishedRevision,publishedAt}],nextCursor}` |
| `prepareContentUpload` | `{kind,id,role,name,mimeType,size}` | `{attachmentId,bucket,storagePath,scanStatus:'pending',uploadExpiresAt}` |
| `finalizeContentUpload` | `{attachmentId}` | `{attachmentId,scanStatus,generation}` |
| `getContentFile` | `{kind,id,attachmentId}` | `{attachmentId,bucket,storagePath,generation,contentType,fileName,size,sha256,scanStatus}` |
| `saveEventInterest` | `{eventId,name,email,company}` | Saved interest document plus `id`, with ISO createdAt |
| `withdrawEventInterest` | `{eventId}` | `{withdrawn:true}` |
| `submitConsultation` | `{category,subject,message,requestKey}` | `{id,reference,createdAt,status:'received'}` |
| `listMyConsultations` | `{afterId?}` | `{items,nextCursor}`; includes message for owner detail |
| `listMyEventInterests` | `{afterId?}` | `{items,nextCursor}` |
| `listAdminConsultations` | `{afterId?}` | `{items,nextCursor}` |
| `listRegistry` | `{afterId?}` | `{items,nextCursor,activeVersion,revision}` |

`kind` is `event`, `discover` or `publication`. A preview receipt is random, actor-bound, kind/id-bound by its containing document, revision/digest/file-generation-bound, expires in 15 minutes and is consumed by a successful publish. A wrong/expired receipt or changed draft rejects with failed-precondition. A pending safety scan blocks publish. Do not automatically retry publishing.

Interest stores `{ownerUid,eventId,name,email,company,eventRevision,eventSnapshot,createdAt}` against the current published event. A repeated save returns the original interest unchanged. Withdraw then register again intentionally captures a new snapshot. It records interest only; no booking/payment/email is created.

Consultation ID is SHA-256 of `uid:requestKey`, reference is server-issued `ISP-Q` plus a 12-hex uppercase identifier. UUID request keys use lowercase hex with 8-4-4-4-12 groups. Retrying identical content returns the stored receipt; reusing the key for changed content rejects. Server owner and timestamp are never client supplied. No email is sent.

## Content fields

All data field names are camelCase. Unknown fields fail validation. Text limits are characters; file limits are binary MiB.

- Event: title110, format (`Workshop`, `Field visit`, `Webinar`, `Conference`), summary180, description4000, audience240, programme2500, date ISO YYYY-MM-DD, startsAt/endsAt HH:mm with end after start on the same date, timezone (`Asia/Kuala_Lumpur`, `Asia/Singapore`, `Asia/Jakarta`, `UTC`), venue180, venueDetails700, admission `free|paid`, fee as decimal string, paymentMethod `bank|organiser`, bankName100, accountName140, accountNumber60, receiptEmail160, paymentNotes1200, images attachment-ID array (max3), brochure attachment-ID or null. Preview requires title/summary/description/date/start/end/venue. Paid fee RM0.01–100000, up to2dp, valid receiptEmail; bank requires all three bank fields. Free events clear all payment fields; organiser payments clear bank fields. Up to3 JPG/PNG/WebP images, 5MiB each; brochure PDF10MiB.
- Discover: fixed document ID1/2/3; tag80,title140,description700,websiteUrl2048,imageAlt180,defaultImage (`plantation-small.jpg`, `planter-cover.jpg`, `member-events.jpg`), image attachment-ID or null. All text and HTTPS URL are required for preview. HTTPS forbids login details, controls, encoded controls and backslashes.
- Publication: title160,subtitle200,description4000,author140,issueDate ISO date or blank, cover and pdf attachment IDs. Title/description and both attachments required for preview. Cover JPG/PNG/WebP5MiB, PDF25MiB.
- Interest: name80,email160,company120; name/email required.
- Consultation: category exactly `Plantation feasibility`, `Operational due diligence`, `Vendor management`, `Cost and inventory optimisation` or `Other enquiry`; required subject140/message5000.

## Private files and scan gate

Upload path is exactly `contentUploads/{kind}/{parentId}/{attachmentId}`; no user-controlled object path or download token. Reservation expires after15min. Root-owned Storage rules must allow only the reserving active TOTP administrator to create the matching object once, enforcing size/type/expiry and denying subsequent browser overwrite/delete; finalized objects are immutable. `finalizeContentUpload` verifies exact stored size/type, streams SHA-256 from an exact generation, removes Firebase download-token metadata and records that generation/hash. It returns pending honestly.

**No trusted malware scanner is implemented in this source.** Only a separately trusted server worker may set `scanStatus:'clean'` together with `scan:{generation,sha256,scannerId,scannedAt}` matching the finalized exact generation/hash. That worker must verify actual format/signature and scan content, not trust upload MIME/extension. No client/callable marks clean. A scanner failure/absence leaves the attachment unpublishable. Publication workflows therefore cannot complete file publication until this gate is implemented and proven.

Publishing records `visibility:'public'|'member'`, publishedKind/publishedId/publishedRevision on clean attachments. Public/approved-member file reads must also prove the attachment ID is still referenced by its current published parent. Pending/quarantined originals are unavailable to members. Admin metadata may describe pending uploads; this does not make them a member download. `getContentFile` returns file metadata and exact generation information; it does not grant Storage read permission. There are no signed/public/bearer URLs or25MiB base64 responses. **Private publication Storage SDK reads remain denied.** Root may permit guest reads of clean public event/Discover objects with exactly two Storage-rule Firestore lookups: attachment and current published parent. That public route must verify clean exact-generation/hash attestation, current parent reference, public visibility and immutable object generation. Full member/status/registry enforcement exceeds the Storage rules two-lookup limit, so private bytes use the authenticated binary endpoint below. Objects must never be overwritten after finalization.

## Registry CSV preview and atomic confirmation

Exact header order: `name,email,member_reference,status`. UTF-8 (optional BOM), 2MiB maximum, at most5000 rows, max2048 characters per CSV field, exactly four columns. Name/reference required≤80; email required≤160 and normalized lowercase; status eligible/ineligible. Trim outer whitespace; references stay strings, preserve leading zeros and remain case-sensitive. Reject malformed quoting, invalid Unicode, field controls, extra columns and duplicate normalized emails or references. Existing email/reference pairings cannot be reassigned. Administrator identities and conflicting existing account pairings reject the preview.

| Callable | Request | Response |
|---|---|---|
| `previewRegistryImport` | `{csv:string}` | `{previewId,digest,registryVersion,expiresAt,state:'ready'|'invalid',counts,errors,rows,nextCursor}` |
| `getRegistryImportPreview` | `{previewId,afterRow?:number}` | Same envelope, rows page25; state may also be processing/confirmed, with `progress` equal to the confirm response |
| `confirmRegistryImport` | `{previewId,digest,registryVersion}` | `{previewId,state:'processing'|'confirmed',phase:'copy'|'apply'|'activate'|'complete',processed,total,counts,activeVersion?}` |

Rows: `{rowNumber,name,email,memberReference,status,action:'add'|'update'|'unchanged'|'invalid',errors}`. `counts` includes total,add,update,unchanged,invalid,errors,omitted,duplicates. `omitted` is the actual count of existing registry rows absent from the CSV; all remain preserved. `duplicates` counts rows affected by a duplicate normalized reference/email, not excess duplicate occurrences. Preview errors in responses are capped at100; page rows carry their own issues.

Server JSON path `registryPreviews/{previewId}/preview.json` contains normalized rows and security fingerprints, private with no download tokens. Firestore preview metadata binds actor, SHA-256 digest, immutable object generation/payload digest, base registry revision and active version. Confirmation requires that exact server-held preview, same actor and current active admin/TOTP/staff; caller rows are never accepted.

Confirmation must start within15min. Acceptance creates an explicit resumable staging job valid24hours; the user need not finish copying before the original15min expires. Repeat the *same* confirm request to advance a bounded100-row step. A failed/ambiguous response may be resumed by the same request; no duplicate activation occurs. Keep processing visible and allow explicit resume, not an unbounded hidden retry loop.

The job first copies the full prior immutable version in100-row pages, then applies reviewed rows in100-row pages. Each chunk and its step/cursors commit atomically; concurrent resumes observe the committed progress instead of advancing twice. Only the final transaction switches `registryState/current.activeVersion` and increments revision. It rechecks actor/staff/TOTP, exact digest/base version, complete copied/applied counts, expiry and unchanged relevant account security fields; Auth identity/admin fingerprints are refreshed just before that transaction. A competing registry activation invalidates the old job. Incomplete staging is never an eligibility source. No single5000-write commit or silently partly active registry exists.

Ineligible imports set cumulative `accessSuspended:true`; later eligible rows preserve that suspension. This denies content immediately when the pointer switches but does not pretend to force a browser sign-out or restore account access. Separate account suspension/session revocation and explicit verified reapproval remain a controlled account process. No account activation, invitation or role grant occurs. Abandoned staged versions/private previews need a separately approved cleanup/retention policy; no scheduled cleanup or paid scanner was invented.

## Local evidence and remaining gates

`functions` TypeScript build passes. Thirteen focused local tests pass: field/CSV validation; revision/preview/publish projection stability; pending/stale scan denial; consultation idempotence/member denial; a501-row addition over a600-row base with bounded chunks, preserved omissions and one final pointer switch; stale/wrong import confirmation denial. Workflow tests use an in-memory Firestore/Storage/Auth substitute and make no cloud calls. They are **not** live Admin SDK, Storage-rule, production scan or deployed callable proofs.

Root owns deployment config/rules/indexes/cloud changes. Before milestone3 is complete: review/deploy callables and least-privilege runtime rules/identities, connect hosted screens, demonstrate focused real persistence/denial, pair any approved account before first registry activation, prove eligibility-specific rules, configure/prove a trusted scanner or retain the honest blocked file gate, and verify authenticated private HTTP file reads and any two-lookup public Storage reads. Milestone4 Drive backup/restore is separate. Historical setup/testing bound remains unchanged by these local checks; deployment costs were not incurred here.


## Authenticated binary download endpoint

`GET https://asia-southeast1-isp-planter-app.cloudfunctions.net/downloadContentFile?kind={kind}&id={parentId}&attachmentId={attachmentId}`

Send the current Firebase ID token only in `Authorization: Bearer <token>`. Tokens in query strings, body or download URLs are never accepted. Frontend fetches binary bytes as a Blob under its existing identity epoch guard, checks returned generation/hash against metadata, and revokes Blob object URLs on sign-out/unmount. No credentials or token are embedded in a file URL. This endpoint is source implemented, not yet deployed or live-proven here.

- Server verifies the ID token with revocation checking, verified email, and the same member/admin guards used by callables. Nonadmin publication reads require the full approved-member and active-registry eligibility guard. Administrator reads require active staff/admin claim/TOTP and a current draft reference, allowing a clean-file draft preview. Nonadmin event/Discover reads require verified sign-in and current published parent reference; anonymous public event/Discover reads may instead use root-approved two-lookup Storage rules.
- Every downloaded file, including administrator preview, must have a trusted clean attestation bound to the finalized exact generation/hash. Quarantine remains sealed. The path, bucket, supported MIME, size, parent and current attachment reference are independently checked. A generation-bound GCS read is used, with decompression disabled; encoded/compressed object metadata is rejected.
- Maximum body25MiB (and each role retains its smaller original limit). The endpoint preallocates at most25MiB, counts and hashes all bytes, then sends one binary response only after the full size/SHA-256 check succeeds. Firebase gen2 has a10MB streaming limit and32MB non-streaming limit, so this endpoint deliberately does not stream the HTTP response or use base64. Endpoint concurrency is1 to bound memory under256MiB. No range/partial-content endpoint is implemented. [Firebase quotas](https://firebase.google.com/docs/functions/quotas)
- Response is binary with exact Content-Type/Length, `Cache-Control: private, no-store`, `Pragma: no-cache`, `X-Content-Type-Options: nosniff`, restrictive CSP and no-referrer. PDF Content-Disposition is attachment; images are inline. Filename headers sanitize ASCII fallback and encode UTF-8 safely.
- `X-ISP-File-Generation` and `X-ISP-File-SHA256` are exposed through CORS, together with Content-Disposition/Length/Type. CORS accepts exactly `https://isp-planter-app.web.app` and `https://isp-planter-app.firebaseapp.com`. Local development origins require a separate explicit root decision; there is no wildcard/credential reflection.
- Common HTTP failures:401 missing/expired/revoked sign-in;403 membership/staff/parent denial;404 missing attachment;409 pending scan or generation/metadata conflict. Errors return small JSON without credentials. Integrity failures produce an error before any file bytes are sent. The frontend must also reject an incomplete transport response.

Endpoint-only local verification: seven focused substituted-service checks pass, including full registry/member denial, quarantine/stale-generation denial, TOTP clean draft preview, bounded25MiB verified binary bodies, header-only revoked-token denial, restrictive headers/CORS and one successful single-send exact binary PDF response. No live Auth/Storage calls or existing core proof reruns were made.

