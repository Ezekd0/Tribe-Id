# Administrative workspace read APIs (T17 backend)

All three endpoints require a live enabled, email-verified account, current credential version, valid MFA-authenticated session and active administrator/owner membership in the requested Tribe. Authority is checked in a database transaction using user, session and membership locks. A role/status filter cannot grant authority. Ordinary member endpoints and their existing projections are unchanged.

| GET endpoint under `/api/v1/tribes/:tribeId/admin/` | Response |
| --- | --- |
| `context` | `{tribeId,tribeName,membershipId,role}` where role is administrator or owner |
| `members` | `{members:[{membershipId,displayName,memberNumber,role,status,emailVerified,joinedAt}]}` |
| `invitations` | `{invitations:[{id,email,memberNumber,expiresAt,consumedAt,revokedAt}]}` |

Member results omit email, phone, date of birth, bio, occupation, location, password/credential values and unrelated profile fields. Invitation email is included only for the approved administrative invitation workflow. Invitation token hashes and raw invitation credentials are never included. Context uses server-derived authority and Tribe data.

Both lists accept `limit` (default 50, maximum 100), `offset` (0–10,000), and optional literal case-insensitive `search` (maximum 200 characters). Members also accept `status` (`pending`, `active`, `suspended`, `revoked`) and `role` (`member`, `administrator`, `owner`). Context accepts no query fields. Unknown keys, duplicate values, malformed bounds and types are rejected before AJV coercion or property removal. List ordering is creation time and ID descending. Member search covers display name/member number; invitation search covers email/member number. Parameterized `strpos` treats wildcard characters as literal text.

These are read APIs; existing authorized identity/invitation/membership mutations remain the mutation boundary. No new role management, owner transfer, bulk export, destructive deletion or business policy is introduced. Registered admin-route denials are audited by the root error handler without request contents. Successful reads do not write mutation audit events.

Verification sources: `apps/api/src/modules/administration.test.ts` exercises strict query and route validation. `scripts/verify-administration.ts` requires an explicitly disposable PostgreSQL database and checks exact response fields, privacy omissions, 109-member pagination, literal search, filters, invitation isolation, scoped role checks, inactive membership, missing MFA, stale credential versions, account disablement and session revocation. The root isolated harness supplies migrations and teardown.

This backend supports the approved web administration workspace. T17 is not complete until the web UI is integrated and verified, including authentication/MFA, authorized mutation bindings and denial handling.
