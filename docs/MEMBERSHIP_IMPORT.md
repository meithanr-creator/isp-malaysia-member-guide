# Membership-list upload

The owner will upload the approved membership list through https://isp-planter-app.web.app/admin/members/import after authenticator sign-in. Do not paste records or passwords in chat.

Use membership-import-template.csv with exact columns: name,email,member_reference,status. Status is eligible or ineligible. Preserve references as text, including leading zeros. Use UTF-8 CSV with no extra password/role columns, at most 2 MiB and 5,000 rows per file.

Review the private preview before confirming. For 10,000 members, complete one batch, then obtain a fresh preview and confirm the next disjoint batch. Split into smaller files if needed for the byte limit. Source preserves omitted memberships during sequential merging; this is not a 10,000-user load/performance claim.

Imports do not create accounts, grant administrator rights or send invitations. Existing members still complete the approved activation flow. Suspension restoration stays off unless explicitly selected during review. No real membership list has been imported by the agent.
