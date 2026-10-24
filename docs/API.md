# Trueda Tribe ID API

Versioned REST JSON under `/api/v1`. Protected requests require `Authorization: Bearer <opaque-access-token>`. Browser cookies do not authenticate. Native requests may omit Origin; supplied foreign origins are rejected. Browser reference uses its same-origin proxy; no wildcard CORS is enabled.

| Implemented endpoint | Behavior |
| --- | --- |
| GET `/health` | Process liveness, product identity |
| GET `/health/ready` | Database and migration readiness; 503 otherwise |
| GET `/me` | Active memberships for verified session identity |
| POST `/auth/refresh` | JSON `refreshToken`; atomic rotation; replay revokes device family |
| POST `/auth/logout` | Revokes bearer-authenticated device session; 204 |
| GET `/tribes/:tribeId/member-view` | Authorized member-area composition |
| GET `/tribes/:tribeId/hub` | Identity, card, latest announcement and two events |
| GET `/tribes/:tribeId/profile` | Own identity/profile |
| GET `/tribes/:tribeId/id-card` | Own identity/card/location |
| GET `/tribes/:tribeId/announcements` | Up to 50 published announcements |
| GET `/tribes/:tribeId/events` | Up to 50 upcoming published events |

Invalid/missing credentials return 401. Inactive or foreign Tribe memberships return 404. Sensitive responses use `Cache-Control: no-store`. Errors use `{error:{code,message,requestId}}`; response `X-Request-ID` is server-generated. PostgreSQL-backed limits are shared across configured instances, with independent bounded route/IP and account/session budgets documented in `AUTHENTICATION_IMPLEMENTATION.md`. Health checks bypass limits. Counters fail closed if the database fails. Development without a database uses non-production process-local limits.

Approved invitation enrollment, verification, login, recovery, email/password changes, administrator MFA, device management and scoped invitation/membership-authority APIs are implemented; their exact request/response table and configuration requirements are in [AUTHENTICATION_IMPLEMENTATION.md](AUTHENTICATION_IMPLEMENTATION.md). Internal user-ID issuance remains inaccessible as a public shortcut. Profile mutation, event registration, uploads, general notification preferences, final Admin UI and public card verification remain unavailable. No production credentials or seed users are provided.

The non-production `/development/member-view` fixture endpoint remains explicitly opt-in via `ENABLE_MEMBER_PREVIEW=true` and is prohibited in production. It does not create sessions or production members.
