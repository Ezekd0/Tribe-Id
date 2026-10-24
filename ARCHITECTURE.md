# Trueda Tribe ID Architecture

## Decision and production scope

Trueda Tribe ID is a **React Native + Expo + TypeScript mobile application** backed by a **Fastify + TypeScript modular monolith** and **PostgreSQL**. The initial population is approximately 2,000–3,000 users, with a path to substantially larger workloads. This is a production-oriented foundation, not a claim that incomplete features are production-ready or that capacity has been benchmarked.

The mobile app is the primary member client. Existing `apps/web` code is preserved as an audited-layout/development reference, not the target application or an authentication implementation for mobile. `docs/ARCHITECTURE_WEB_REFERENCE.md` preserves the superseded design. Do not continue browser feature work as the primary product.

One API deployment owns business modules; multiple identical instances may run behind a load balancer. PostgreSQL is the authoritative store. Add Redis only when shared caching, high-volume rate limiting or background processing justifies it. No microservices, Kubernetes, service mesh, event bus, or mandatory monitoring cluster.

## Product evidence and terminology

Official identity: **Trueda Tribe ID**, project slug `trueda-tribe-id`. Use Tribe, Tribe Member, Tribe ID, My ID Card, My Profile, Tribe Hub, Announcements, Events, Tribe Settings, Tribe Administration and Admin Dashboard consistently.

Use `docs/FIGMA_AUDIT.md` for existing design evidence. The audited Tribe views are Hub, Profile, Announcements, ID Card and navigation drawer. Events appear in the Hub; no event-detail/registration design is established. Profile includes skills, teams, achievements and settings affordances. No final authentication or Tribe administration design is available. The marketplace Admin Dashboard is not a Tribe admin specification. Exact artwork remains unavailable under the Figma quota. No further audit or substitute artwork is required for this architectural correction.

Open product decisions: invitation versus signup, membership approval, ID verification/expiry policy, event registration/capacity/cancellation, notification channels, administrator delegation and retention/consent. Do not invent final screens to fill those gaps.

## Topology and stack

```text
React Native / Expo mobile app
          │ HTTPS, /api/v1, bearer access token
          ▼
Load balancer / reverse proxy
          ▼
Fastify modular-monolith API instances
          ├── PostgreSQL: domain data, sessions, shared limits
          ├── Private external object storage: uploaded images/files
          └── Optional Redis / background worker when needed
```

React Native and React versions must match the selected stable Expo SDK. Use Expo's dependency alignment rather than upgrading native packages independently. Use npm workspaces, strict TypeScript, explicit SQL migrations and `pg` pools. API contracts are transport DTOs, not raw database rows. Keep credentials entirely outside the app bundle and repository.

## Module boundaries

| Backend module | Ownership and public responsibilities |
| --- | --- |
| auth | Identity, credentials/recovery policy, access/refresh tokens, device sessions, revocation |
| members | Tribe membership, status, member number, role; member-area composition |
| tribe-id | Card issuance/expiry/revocation and minimal verification policy |
| profiles | Own-member biography/contact data, skills, teams, achievements and settings |
| announcements | Tribe-scoped draft/published/archive content |
| events | Events, registration, attendance and capacity transactions |
| notifications | Member inbox and future email/push delivery |
| administration | Audited privileged workflows using other modules' public services |
| health | Liveness/readiness/system checks |

Each module exposes services/interfaces. Routes validate inputs and call services; services enforce identity, Tribe scope, ownership and lifecycle rules; repositories alone issue parameterized SQL. Cross-module coordination calls public services/read interfaces rather than reaching into another module's tables from route handlers. The members read facade composes profile/card/content readers for the member area. Future extraction can replace those interfaces without changing the external API.

Infrastructure is separate: configuration, database/pool, security, logging, cache/rate limiting, storage and background jobs. Composition belongs in `app.ts`; it must not contain domain SQL. Modules do not start servers or allocate independent connection pools.

## Mobile architecture

```text
apps/mobile/
  index.ts          # Expo native registration
  src/App.tsx       # Composition seam; renders no invented UI
  src/auth/         # SecureStore and serialized refresh lifecycle
  src/api/          # Bearer HTTPS transport
  src/features/     # Reserved native domain boundaries
  src/theme/        # Observed Figma tokens, not new visual identity
```

Implement native screens incrementally from the existing audit after this correction. CSS/browser components are references, not React Native components. Use native safe-area, keyboard, touch and navigation behavior. No new authentication or admin UI is included in the architecture scaffold.

Keep the access token in memory. Store only the refresh token in Expo SecureStore using device-local keychain/keystore protection. Never put credentials in AsyncStorage, logs, URLs or `EXPO_PUBLIC_*` variables. `EXPO_PUBLIC_API_URL` is a non-secret HTTPS endpoint. Permit local HTTP only for development; release configuration must reject it. Serialize refresh attempts within the client to prevent concurrent rotations. Loss of secure storage requires signing in again; it must not be treated as durable user data.

## Database and integrity

Retain the normalized migration `001_foundation.sql`: users, tribes, memberships, profiles, cards, account tokens, announcements, events, registrations, assets, settings, skills, teams, achievements, notifications and audit logs. Binary uploads are not stored in PostgreSQL: assets hold storage keys, verified MIME/size, ownership and processing state.

Add a forward migration for mobile device sessions, hashed access/refresh tokens and shared rate-limit buckets. Preserve the old sessions table for a later explicit data-migration/retention decision; do not silently reinterpret indefinite browser sessions as mobile access tokens. Old cookies do not grant mobile access.

Use UUID primary keys; foreign keys and composite Tribe constraints; unique email/member number/event registration/card constraints; lifecycle/date checks; timestamps and indexes matching read patterns. Shared counters must be atomic. Frequently used lookups include hashed token, user/session, Tribe membership, published content ordering, event dates, notification inbox and audit chronology. Add cleanup indexes for expiring tokens/counters. Never mutate an applied migration; the checksum runner serializes migration jobs with a PostgreSQL advisory lock.

Bound feed sizes initially to 50 and introduce cursor pagination before feeds grow beyond that, retaining `(timestamp,id)` ordering. Avoid full-table scans, unbounded relationships and arbitrary SQL from handlers. Capture query latency and slow plans under realistic load. Foreign-key constraints and indexes alone do not prove throughput.

Transactions: credential verification/session issuance; locked refresh rotation and family revocation; membership approval/number allocation; owner transfer retaining an active owner; event-row lock plus capacity check and unique registration; card issue/revoke with audit write; domain change plus durable notification outbox. Domain writes and outbox insertion must commit together when jobs are implemented.

Runtime and migration database roles are distinct. Runtime roles cannot alter schema; audit writes should be append-only through permissions. Connection budget is explicit: instances × pool size + workers + migrations + operational reserve < PostgreSQL connection capacity. Default API pool is bounded by DB_POOL_MAX (10 by default); tune from load tests. PgBouncer is optional when connection count demands it, not mandatory for a few thousand users.

## Mobile authentication and authorization

Use cryptographically random, **opaque short-lived access tokens** (initial design: 15 minutes) and **rotating refresh tokens** tied to a revocable device-session family (initial absolute lifetime: 30 days). Opaque tokens avoid introducing signing-key distribution and let PostgreSQL enforce immediate revocation. Each request uses an indexed hash lookup; measure that cost before considering JWT or Redis optimization. Roles remain live database decisions, not stale token claims.

Store SHA-256 token hashes only; 256-bit random token values are returned once. They are not passwords and do not need a slow password KDF. Access is `Authorization: Bearer <token>`. No cookie or browser-origin requirement authenticates a native app. Refresh tokens appear only in the JSON body of refresh requests over HTTPS and in secure client storage; redact the body from logs.

Rotation locks the device-session row, verifies expiry/revocation and verified account, marks the presented refresh token consumed, issues a replacement and a new access token, and commits atomically. Reuse of a consumed refresh token revokes the entire family, including access tokens. Do not delete consumed hashes before the family expires, or replay detection is lost. The client must serialize refresh calls and must not blindly retry an uncertain refresh response with the old token; require reauthentication if the rotated token cannot be recovered. This favors secure revocation over silently accepting replay.

Session creation is an internal service for a future verified login flow, not a public shortcut. Device metadata is descriptive, never proof of identity. Logout revokes the current device session; password reset/security events revoke all device sessions. Device management and account-recovery endpoints require dedicated service tests before exposure. Require MFA/step-up before privileged production administration.

If passwords are adopted, use Argon2id with calibrated parameters, generic login/reset responses, verified email, single-use short-lived recovery tokens and atomic consumption. Login/reset/verification endpoints need shared per-IP and per-account throttles, progressive backoff, breached-password policy and enumeration resistance. No credential-verification or final login UI is implemented by this correction.

Roles: Tribe Member accesses own data and published content; Tribe Administrator manages membership/content/cards/events; Tribe Owner manages role grants/Tribe settings. Reject inactive memberships. Resolve session identity server-side, then check Tribe scope, then ownership/role. Never trust client-supplied user/role headers. Administrative mutations require audit entries.

## API consistency and security

REST JSON under `/api/v1`. Thin route schemas reject unknown properties; validate UUIDs, enums, lengths and size. A central authentication hook/service parses bearer tokens. Domain services authorize. Responses use explicit DTOs; errors are `{ error: { code, message, requestId } }`; internal SQL/stack traces never reach clients. Sensitive data uses `Cache-Control: no-store`. Auth responses must never be logged.

Native requests often omit Origin. Accept that while requiring bearer credentials on protected resources. CORS only controls browser access: optional exact allowlisted origins, no wildcard credentials. Reject disallowed supplied origins; do not use Origin as identity. Cookie authentication is unsupported in the mobile API, so cookie-based CSRF defenses are not its security boundary.

All instances share production rate-limit state through PostgreSQL initially. Do not rely on process-local counters for authentication protection. Use short-lived indexed buckets, an externally scheduled cleanup command, conservative timeouts and fail-closed behavior when the store is unavailable. Health checks bypass application throttles. Move the adapter to Redis when write load/latency justifies it. Proxy/IP identity trusts only explicitly configured TRUSTED_PROXY_CIDRS; do not blindly trust forwarded headers. Login/refresh/recovery have stricter limits than ordinary reads.

Security foundation: strict configuration, secure headers, 64 KiB JSON limit, request timeouts, credential redaction, parameterized SQL, live membership checks and explicit production DB requirement. Before launch: TLS end-to-end where appropriate, least-privilege accounts, secret manager, backup restore tests, retention rules, dependency scanning, MFA and API authorization review. Do not describe these planned release gates as completed.

## External storage, cache and background work

Use private S3-compatible object storage. The storage adapter authorizes initiation and issues short-lived scoped upload/download capabilities. Validate extension/MIME/signature, size, ownership and processing state; quarantine uploads and re-encode images before marking ready. Do not accept arbitrary SVG or expose internal object keys as public URLs. No bucket, credentials, SDK, uploads or fake signed URLs are provisioned in this foundation.

Optional cache entries have bounded TTL and explicit invalidation on writes. Never use an unbounded cache or make it the source of truth for sessions, membership or card revocation. No cache is required initially.

Long-running notification/image work runs outside requests in a separate worker process from the same repository. Start with a PostgreSQL transactional outbox/job store and `FOR UPDATE SKIP LOCKED`, bounded retries, leases, idempotency keys and dead-letter handling when the first real job is added. Delivery is at-least-once, so handlers must be idempotent. Redis/BullMQ is an optional later adapter. No in-memory queue is allowed for durable work; no worker is started until an actual task needs one.

## Observability and reliability

Structured Fastify/Pino request/error logs; server-generated globally unique request IDs; HTTP latency/status in completion logs; secret-redacted logging configuration. Liveness checks process responsiveness. Readiness checks the PostgreSQL connection and required migration version, and must return 503 when dependencies are unavailable. Do not leak connection strings, SQL or infrastructure details through health responses.

Observe request latency/error rate, DB pool wait/query latency, refresh failure/replay rate, rate-limit rejects, worker backlog and storage processing failure when those features exist. Logs can initially ship to the hosting provider; add OpenTelemetry/metrics collection when operational needs justify it. Do not add an expensive stack by default.

Graceful SIGTERM stops accepting work and closes the shared pool; deployment supplies a bounded drain period. Configure reverse-proxy limits/timeouts and trusted proxy ranges. Backups, restoration drills and rollout/rollback procedures are operational requirements before real users.

## Deployment

Container-friendly Node LTS API; multi-stage build, pinned lockfile, non-root runtime, explicit host/port, no baked secrets. A separate release job applies migrations with migration credentials before traffic shifts. API instances share PostgreSQL and the rate-limit store; no sticky sessions. Object storage and optional Redis remain external. No deployment, remote repository or commit is authorized here.

Expo development and release configuration are separate. Native release/app-store builds require platform signing and a supported SDK/OS toolchain; no native release is performed on this Linux foundation. EAS is optional build tooling, not backend hosting. Do not put server secrets in mobile public configuration.

## Implementation status and verification

This correction adds the Expo workspace/native entry, typed API/session-storage seams, mobile bearer/session foundations, module/service boundaries, shared PostgreSQL infrastructure, readiness checks and container configuration. It preserves useful existing schema, DTOs, policy tests, audit and web reference work. Auth credential flows, Figma native screens, uploads, administration and worker delivery remain intentionally unfinished.

Run typecheck, backend unit tests, builds, mobile bundle/config checks and disposable PostgreSQL integration/constraint tests. Test bearer parsing, expiry, refresh replay/atomic rotation, revocation, inactive/cross-Tribe denial, Origin handling, readiness failure and shared counters across instances. Native-device smoke/accessibility/performance tests and realistic load tests are required before production; browser layout tests validate only the retained web reference.

## References

- [Expo SDK version compatibility](https://docs.expo.dev/versions/latest/)
- [Expo monorepo guidance](https://docs.expo.dev/guides/monorepos/)
- [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)
- [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP secrets management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)

## Approved authentication implementation — 5 October 2026

The historical correction scope above is superseded for identity/credentials by `docs/AUTHENTICATION_IMPLEMENTATION.md`. Invitation enrollment, verified email/password, administrator TOTP MFA/recovery, account security and durable configured SMTP delivery are now implemented in the same Fastify modular monolith. Migration 004 adds security state and workflows; no previous migration is changed. Live user/version/MFA checks and a consistent user-lock ordering harden the existing opaque device-family sessions. No deployment occurred.
