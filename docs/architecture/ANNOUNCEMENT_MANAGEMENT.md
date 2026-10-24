# Announcement authoring API (T15)

The approved authority workflow permits an active scoped administrator or owner with a valid MFA-authenticated session to author and directly publish plain-text announcements. There is no separate editor approval stage. Existing member announcement readers continue to return published content only.

| Method | Path relative to `/api/v1/tribes/:tribeId/admin/announcements` | Result |
| --- | --- | --- |
| GET | `/` | `{announcements:[...]}` |
| POST | `/` | Draft `{announcement:...}`, HTTP 201 |
| PATCH | `/:id` | Updated `{announcement:...}` |
| POST | `/:id/publish` | Published `{announcement:...}` |
| POST | `/:id/archive` | Archived `{announcement:...}` |

POST create accepts exactly `title` (1–200 characters, containing non-whitespace), `body` (1–20,000 characters, containing non-whitespace), and `category` (`important`, `event`, `general`). PATCH accepts at least one of these fields. Text is preserved as supplied and must be rendered as text by clients. Unknown properties, arrays, nulls, wrong types and status/author/tenant mass assignment are rejected before AJV can remove or coerce values. Publish/archive accept no request body. The server derives author membership, tenant and publication timestamp.

The admin list supports `limit` (default 50, maximum 100), `offset` (0–10,000), optional `status` and literal case-insensitive `search` of at most 200 characters. Results sort by creation time and ID descending. Search uses parameterized `strpos`, without SQL interpolation or wildcard expansion. Admin list includes drafts and archives only after scoped authority checks.

Repeated publish retains the original publication timestamp without duplicate mutation audit. Repeated archive also has no duplicate mutation audit. Published content may be edited directly under the approved workflow. Archived content cannot be edited or republished (409); no restore or delete workflow is introduced.

Every operation revalidates the live account/session/MFA and active authority membership inside a transaction. User then session locks precede membership/domain locks. Announcement lookups and mutations include tenant IDs. Create/edit/publish/archive audits commit in the same transaction as the mutation, with changed field names only; bodies, titles, email addresses and bearer credentials are excluded from audit metadata. Audit failure rolls back the mutation. The root registered-route error handler supplies safe denied-request auditing.

Verification: `apps/api/src/modules/announcement-management.test.ts` covers strict normalization/bounds and route validation; `scripts/verify-announcement-management.ts` requires an explicitly disposable database and exercises roles, tenant isolation, MFA, membership state, published-only member visibility, publication/archive idempotency, parameterized listing and audit rollback. The isolated database harness owns setup/migrations and teardown.

This API implements authoring/publication only. Web administration UI remains T17. Push/email/in-app publication delivery is separately scoped to notification tasks and has not been implemented or verified by T15. Production readiness still depends on the existing release gates.
