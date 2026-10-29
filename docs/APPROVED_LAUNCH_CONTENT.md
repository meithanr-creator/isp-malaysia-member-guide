# Approved launch content

Design B, crest, large text, top-right menu and existing layouts remain approved to preserve. The owner approved this existing copy and empty event/publication listings on 29 October 2026. Root checked the official ISP homepage for existing contacts and 1919 history; the existing welcome/Discover wording is now owner-approved. No new event, publication or member details were invented.

**Actual published-content inventory:** Root observed zero Discover, event and publication documents at 2026-10-29 11:57:40 UTC. No member records or binary files were read. The three homepage cards are source fallback content; no admin card or real event/publication is published yet. Draft counts were not inventoried. Honest empty events/library states are appropriate until actual approved content is published.

**Home:** “People. Plants. Progress.” / “A community of planters. A shared future.” / “Connect with your profession. Learn, contribute and grow with ISP.”

**Discover card 1** — Tag: “A profession. A community.” Title: “Rooted in the field. Looking to the future.” Description: “Since 1919, ISP has connected planters through knowledge, professional fellowship and a shared commitment to progress.” Picture: plantation-small.jpg. Destination: https://isp.org.my/v4/

**Discover card 2** — Tag: “Knowledge worth sharing”. Title: “A profession that keeps learning.” Description: “Explore The Planter and ISP publications, connecting field experience with fresh perspectives from the plantation profession.” Picture: planter-cover.jpg. Destination: https://isp.org.my/v4/library/

**Discover card 3** — Tag: “Ideas grow in good company”. Title: “Make a connection. Share a new perspective.” Description: “Discover workshops, field visits and conversations that bring the plantation community together.” Picture: member-events.jpg. Destination: https://isp.org.my/v4/event/

The public homepage uses these cards as fallback; published Discover records can override them. Admin can set up missing private drafts, then review/publish each saved card. Inspect existing saved cards before changing them.

**About/contact:** “Rooted in a shared profession.” / “Since 1919” / “ISP supports the plantation profession through knowledge, publications, education and professional fellowship.” Existing contact: +603 7955 5561; isphq@isp.org.my; Suite 3A01, Level 3A, PJ Tower, Amcorp Trade Centre, 18 Persiaran Barat, 46050 Petaling Jaya, Selangor. Existing destination: https://isp.org.my/v4/

**Owner decision:** The baseline copy, pictures, links and contact facts are approved. Events and the member library remain empty until the owner uploads actual approved material through administration. Root also found zero published event/publication documents; no tracked real event or publication seed was found. Event editor defaults are blank and are not an event. A real event needs approved description, date/times/timezone, venue/format and optional attachments; paid events also need finance-approved fee/payment/receipt details. A real member publication needs its actual authorised title/description, cover and PDF; planter-cover.jpg alone is not an issue/PDF. Consultation remains the existing member query form; administrators review requests in the existing admin list. No automatic consultation email is enabled. Shop/Jobs stay frozen DEMO references; CPD, Academy and Forum remain excluded.

**Membership handover:** The administrator will upload the approved list later at `/admin/members/import`. Header-only file: `D:/Projects/isp-firebase-tools/launch-packet/membership-import-template.csv`. It contains only `name,email,member_reference,status`; add approved rows before upload. No sample or real member data is included or required in chat.

Use UTF-8, at most 2 MiB and 5,000 rows per file. Status is eligible/ineligible; keep references as text to preserve leading zeros. No passwords, roles or extra columns. Review the private preview before confirming; restoration defaults off. Imports do not create/activate accounts, grant admin or send invitations.

**10,000 rows:** Source supports sequential merging: finish batch 1, then create a fresh preview for batch 2 and finish it. Two disjoint 5,000-row files suffice only when each meets the byte limit; otherwise split further. The server copies existing active entries in 100-row chunks, applies listed rows and atomically switches versions, preserving omitted memberships. Exact email/reference pairings and suspension rules still apply. This has not been performed for real members and is not a 10,000-user load or performance claim.

No cloud action, import, publication, new test or app change was performed for this packet.

Owner decision: current copy and empty listings approved. Membership-list upload will be performed by the owner through administration. Official contact/history reference: https://isp.org.my/v4/
