# Trueda Tribe ID Architecture

## Overview and product purpose

Trueda Tribe ID is a digital Tribe membership platform. A Tribe Member uses the Tribe Hub to access their Tribe ID, profile, announcements, and events. Tribe Administration manages membership, content, events, and identity issuance. The canonical project slug is `trueda-tribe-id`.

Domain terminology: Tribe, Tribe Member, Tribe ID, My ID Card, My Profile, Tribe Hub, Announcements, Events, Tribe Dashboard, Tribe Settings, Tribe Administration, and Admin Dashboard. The source design file's title never names an application module, service, or database.

## Evidence and unresolved requirements

The entire Figma file was inventoried through MCP on 4 October 2026. It contains three pages. Only Page 2 establishes the Tribe experience: five mobile views with 24 prototype interactions. Page 1 and the Admin Dashboard page represent a separate marketplace/delivery product. They are not Tribe functional requirements or a Tribe admin design system. See `docs/FIGMA_AUDIT.md`.

Observed requirements: member status and number; profile biography, contact information, skills, teams and achievements; digital ID with avatar and member-since date; categorized announcements; upcoming events with registration affordances; notification affordance; password, privacy and notification settings; navigation drawer and bottom navigation.

Proposed requirements needing confirmation during implementation: invitation versus public signup, membership approval, card validity/verification policy, event capacity and cancellation rules, administrator delegation, data retention, legal consent, and notification delivery channels. No payment, runner, grocery, crypto, or delivery feature is implied. Desktop layouts, Tribe admin designs, form states, and empty/error/loading designs are absent. Do not claim visual fidelity for those gaps.

## Technology stack

- React and TypeScript: feature-oriented browser application and reusable UI components.
- Vite: development and static production build. The product is primarily authenticated, so server rendering adds little immediate value.
- CSS custom properties and component styles: translate Figma values directly without a new visual identity or utility CSS dependency.
- Fastify 5 and TypeScript: independent API with JSON-schema request/response validation and test injection.
- PostgreSQL 17+ and `pg`: relational integrity, transactions, parameterized queries, versioned SQL migrations. Explicit SQL keeps the initial data model reviewable without ORM generation.
- Node LTS, npm workspaces, TypeScript compiler, Node test runner through `tsx`.
- Planned: Argon2id password hashing, transactional email, private S3-compatible object storage, and browser integration tests. Add dependencies when those features are implemented, not speculatively.

## System architecture

Browser → same-origin reverse proxy → static web application or `/api/v1` Fastify API → PostgreSQL. The API alone accesses private storage and transactional email. A future worker may process a database-backed notification outbox; there is no queue or worker in this foundation.

One deployable modular API is sufficient for this product. No microservices or mandatory Redis dependency. If multiple API replicas are required, use shared rate-limit storage and consistent session persistence before scaling. The application design supports Tribe-scoped data but initially can serve one Tribe.

## Frontend architecture

`apps/web/src/features` owns authentication, Tribe Hub, profile, ID cards, announcements, events, settings, and administration. Add each feature as it becomes executable. `components` holds reusable buttons, fields, cards, navigation and async state components. An API client will own fetch, typed contracts, error parsing and session-expiry handling. Avoid direct fetch scattered across member screens.

UI authorization controls presentation only; the API always enforces permissions. Never store bearer/session secrets in localStorage. Sensitive profile responses must not be cached publicly. Initially avoid offline ID caching until expiry and revocation behavior is specified.

The design system starts in `tokens.css`: black `#010101`, purple `#7d57bb`, white and transparent borders, 5px card radius, Montserrat headings and Inter body text. Source dimensions are mobile-specific, with unusually small text in several cards. Responsive adaptation and accessible font sizing need deliberate review. Fonts and static imagery must be sourced/licensed, downloaded through Figma asset instructions, and locally served before member screens are claimed complete. The current connectivity screen uses system fallbacks and is not a Figma implementation.

## Backend architecture

Each module owns routes, JSON schemas, service rules, and repository queries. Routes perform input validation and invoke services; services apply authorization and transaction boundaries; repositories use parameterized SQL. Database rows do not automatically become public DTOs. Shared contracts expose only approved data.

Domains: authentication, membership, profile, ID cards, announcements, events, settings, notifications, assets, administration, and audit. Build folders when adding real behavior rather than generating unused service classes. The foundation implements only health, configuration, safe errors, headers, a rate limiter, an origin guard, and a pure authorization policy.

Use a request ID in error responses and structured logs. Do not expose stack traces or SQL errors. Use cursor pagination and bounded page sizes for member/admin lists. Use server timestamps and store event instants in UTC with an IANA display timezone. Capacity-limited registration must lock the event row and check capacity in a transaction; a unique registration key prevents duplicates.

## Database architecture and core entities

`packages/database/migrations/001_foundation.sql` defines the proposed relational foundation:

| Entity | Responsibility |
| --- | --- |
| User | Global email identity, password hash and verification status |
| Tribe | Tribe identity, slug and validated settings |
| TribeMembership | User-to-Tribe relationship, unique member number, role, lifecycle status |
| Profile | Tribe-specific display name, bio, private contact details, avatar |
| IDCard | Issuance/revocation, expiry, hashed verification token |
| Session | Hashed opaque token, expiry and revocation |
| AccountToken | Single-use email verification/password reset token |
| Announcement | Tribe content, category, author, draft/published/archive lifecycle |
| Event | Tribe event, dates, timezone, location, optional capacity |
| EventRegistration | Member attendance lifecycle, unique event/member pair |
| Asset | Private storage key, upload owner, type, size, processing state |
| MemberSettings | Notification preference and profile visibility |
| Skill / MemberSkill | Skills listed on the profile |
| Team / TeamMembership | Tribe teams shown on the profile |
| Achievement / MemberAchievement | Awards with awarded-at date |
| Notification | Per-member inbox and read state |
| AuditLog | Actor, action, affected resource and sanitized metadata |

UUID primary keys, unique constraints, foreign keys, indexes and lifecycle checks enforce integrity. Composite foreign keys prevent associating registrations, teams, achievements, avatars, or cards with a different Tribe. Application queries must also scope every resource by Tribe. No row-level security is configured yet: API isolation tests and query review are mandatory before member APIs ship.

Member numbers are human-facing identifiers; UUIDs remain internal keys. Preserve the observed `IBX-TRIBE` prefix as configurable Tribe numbering policy rather than assuming it is the product name. Allocate numbers transactionally; never compute `COUNT(*) + 1`. Only one issued card per membership is allowed. Expiry checking and revocation are runtime rules in addition to persisted state. A public verification flow, if approved, returns minimal status, never date of birth, email, phone, or full profile.

Audit records are append-only by application policy. Configure database roles to enforce that when deployment credentials are provisioned. A migration account may change schema; a runtime account must have only necessary data privileges. No application database or credentials have been provisioned. A disposable workspace-local PostgreSQL instance was used for schema verification and stopped afterward. Retention/deletion and owner-transfer constraints require dedicated service logic and tests.

## Authentication

Proposed email/password with Argon2id hashing using parameters calibrated against deployment hardware. Verify email before active member access. Password reset and verification tokens are cryptographically random, stored only as hashes, short-lived, single-use, and consumed atomically. Return uniform responses to avoid account enumeration. Revoke sessions after password reset; rotate session identifiers on login and privilege change.

Opaque server-side sessions stored in PostgreSQL; production cookie `__Host-trueda-tribe-id-session`, Secure, HttpOnly, SameSite=Lax, Path=/, no Domain. Configure idle and absolute expiry explicitly before launch. Require MFA/step-up for privileged administration before production. Authentication endpoints and cookies are not implemented in this foundation.

## Authorization, Tribe member roles, and admin roles

| Role | Intended access |
| --- | --- |
| Tribe Member | Own profile/settings/card, published Tribe content, event registration |
| Tribe Administrator | Member lifecycle, card issuance/revocation, announcements, events, teams and awards |
| Tribe Owner | Administrator capabilities plus role grants, owner transfer and Tribe settings |

Deny access without an authenticated active membership. `pending`, `suspended`, and `revoked` memberships cannot access active member operations. Resolve roles from the database, not from request JSON or trusted-looking client headers. Scope by Tribe, then check resource ownership or privilege. Member profile updates remain self-service in the initial policy; any administrative edit privilege must be separate and audited.

The implemented `can()` function is the initial policy and is tested in isolation. It is not yet attached to protected routes because those routes do not exist. Preserve at least one active owner through a transactional owner-transfer service. Treat role management and data export as auditable sensitive operations.

## API structure

Versioned REST JSON at `/api/v1`; proposed routes are documented in `docs/API.md`. JSON schemas reject unexpected properties and validate lengths, types and enum values before services run. Explicit DTOs avoid private field leakage. Error envelope: `{ error: { code, message, requestId } }`. Use 401 for missing/expired identity, 403 for insufficient permission, 404 for inaccessible resources, 409 for lifecycle conflicts, and 429 for rate limits.

Implemented: `GET /api/v1/health` checks process responsiveness only, not database readiness. Add separate readiness once DB connectivity is wired. Unknown endpoints return safe 404s; member endpoints currently return no data.

## Folder structure

```text
apps/
  web/src/
    features/          # Development entry point; domain screens added incrementally
    components/        # Shared UI added with member screens
    tokens.css
    styles.css
  api/src/
    config/            # Environment parsing and validation
    security/          # Authorization policy and tests
    modules/           # Domain rules, initial health tests, boundary guidance
    app.ts             # Testable server factory
    server.ts          # Process startup/shutdown
packages/
  contracts/src/       # Public product and domain types
  database/
    migrations/        # Versioned PostgreSQL SQL
    migrate.mjs        # Locked transactional migration runner
docs/                  # Figma evidence and API plan
README.md
ARCHITECTURE.md
.env.example
```

## Security strategy

Implemented: HTTP security headers, 64 KiB request body limit, 100 requests/minute per-process limiter, strict startup configuration, exact allowed-origin checks for unsafe methods, safe errors, conservative logging redaction, no permissive CORS, no hard-coded credentials. Trust proxy is off; configure only known proxy hops when deploying, otherwise IP limits may be ineffective or grouped behind the proxy.

Before authenticated routes: add secure session cookies, per-session CSRF tokens for mutations alongside the origin guard, dedicated login/reset limits with shared storage for multiple replicas, schemas on all mutation inputs, parameterized queries, object-level authorization, and transaction tests. Never perform state changes with GET. Origins are not authentication.

Before uploads: authorize upload initiation, constrain allowed types and size, verify file signatures, quarantine and decode/re-encode images, reject SVG uploads, generate storage keys server-side, and serve private assets through short-lived authorized URLs. Assets are not accepted by this foundation. Before rich content: sanitize allowlisted markup or keep plain text; never inject raw HTML.

Before production: enforce TLS, CSP appropriate to actual assets, least-privilege DB accounts, secret-manager provisioning, dependency scanning, backups with tested restores, administrator MFA, audit access controls, and retention rules. Do not describe the foundation as production-ready authentication or data protection.

## Testing strategy

Current tests cover authorization boundaries, inactive memberships, cross-Tribe access, self-owned profile edits, role escalation, production origin validation, safe API contracts, headers and unsafe-origin rejection. Run `npm run check` for TypeScript checks, Node tests and builds.

The initial migration and database boundary constraints also passed against disposable PostgreSQL 18.4 (see `docs/VERIFICATION.md`). Next: live repository integration; authentication token reuse/expiry/session revocation; repository isolation; event capacity races; ID revocation/expiry; input validation and safe field projections. Add browser tests for member flows and screenshot comparisons to requested Figma views at 402px and approved responsive widths. Review keyboard navigation, focus, contrast, touch targets, loading/error/empty states. Do not substitute implementation-mirroring tests for security and lifecycle assertions.

## Deployment strategy and environment configuration

No deployment is performed. Planned production topology: static assets at one HTTPS origin, reverse proxy `/api` to Node, managed PostgreSQL on a private network, private object storage, transactional email. Configure `APP_ORIGIN`, host/port, `DATABASE_URL`, mail/storage variables through deployment secrets. `.env.example` contains no credentials.

Pin dependencies in the lockfile and run `npm ci` in CI. Run typecheck/tests/build; run migrations as a separate least-privileged release job, never independently in each replica. Use additive migrations and backups; destructive migration/retention work requires a concrete plan. Set readiness checks, restart policy, resource limits, request timeouts, logs/metrics, and alerting when real persistence is available. Scale the API only after shared rate limits and worker coordination exist.

## Implementation phases

1. Foundation: workspace, build pipeline, domain proposal, SQL migrations, API security basics, policy tests, initial tokens. Current delivery.
2. Identity: signup/invitation decision, email verification, login/logout/reset, opaque sessions, CSRF, membership approval and owner bootstrap.
3. Member experience: Figma assets/fonts, reusable UI, responsive Tribe Hub, My ID Card and profile with private data protection.
4. Community: published announcements, events and transactional registration, teams/skills/awards, settings and notifications.
5. Tribe Administration: establish Tribe-specific designs, then implement scoped member/content/event/card management and audit trails.
6. Readiness: real DB integration, browser/accessibility/visual checks, security review, backups and deployment configuration. Deploy only when separately authorized.
