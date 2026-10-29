# Membership-list upload

The owner will upload the approved membership list through https://isp-planter-app.web.app/admin/members/import after authenticator sign-in. Do not paste records or passwords in chat.

Use membership-import-template.csv with exact columns: name,email,member_reference,status. Status is eligible or ineligible. Preserve references as text, including leading zeros. Use UTF-8 CSV with no extra password/role columns, at most 2 MiB and 5,000 rows per file.

Review the private preview before confirming. For 10,000 members, complete one batch, then obtain a fresh preview and confirm the next disjoint batch. Split into smaller files if needed for the byte limit. Source preserves omitted memberships during sequential merging; this is not a 10,000-user load/performance claim.

Imports do not create accounts, grant administrator rights or send invitations. Existing members still complete the approved activation flow. Suspension restoration stays off unless explicitly selected during review. No real membership list has been imported by the agent.

## Invitation-only registration

An eligible, unsuspended entry in the approved CSV is ISP's invitation authorization. The server refuses new password-account creation when that email is missing, ineligible, suspended, duplicated, malformed or already bound to an existing member account. It does not send invitations or approve unverified email ownership. An invited member creates a password, verifies the listed email, then activates with the exact membership reference; the server saves the approved profile and permanent account binding. Unlisted people are directed to Contact ISP.

The accompanying membership-import-mock.csv is a local test fixture with reserved example.invalid addresses. Do not upload it into the live membership registry. The local test uses the actual preview, confirmation and activation handlers with substituted storage/Auth services; it is not a real email or live registration proof.
