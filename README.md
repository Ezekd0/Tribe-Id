# Trueda Tribe ID

Production-oriented mobile membership foundation: **React Native + Expo + TypeScript**, **Fastify modular monolith**, and **PostgreSQL**. Designed for approximately 2,000–3,000 initial users with horizontally scalable API instances; actual capacity requires load testing.

The architecture correction is documented in [ARCHITECTURE.md](ARCHITECTURE.md). Existing browser work remains under `apps/web` as a layout/development reference. It is not the primary member client. Raw design extracts and private operational records are intentionally excluded from this public source distribution.

## Workspace

- `apps/mobile`: Expo/React Native client foundation, feature boundaries, native theme, secure refresh-token storage and typed API transport.
- `apps/api`: Fastify API, business modules, infrastructure adapters and security tests.
- `apps/web`: administration interface and retained browser reference with opt-in synthetic development fixtures.
- `packages/contracts`: public transport types shared by clients/API.
- `packages/database`: normalized SQL migrations and constraint verification.

## Setup

Use the supported Node LTS version in `package.json`, npm and PostgreSQL 17+. No credentials or application database are supplied.

```sh
npm ci
npm run build -w @trueda-tribe-id/contracts
# Supply your own connection URL through your shell or secret manager:
DATABASE_URL='your-own-connection-url' npm run migrate -w @trueda-tribe-id/database
DATABASE_URL='your-own-connection-url' npm run dev:api
npm run dev:mobile
```

Copy `.env.example` only as a configuration guide. The API reads the process environment; it does not automatically load `.env`. Mobile `EXPO_PUBLIC_API_URL` is public, never a place for credentials. A physical device needs a reachable development API address; loopback points to the device itself. Production requires HTTPS and a configured database.

The native member read experience and approved invitation/email-password/MFA authentication are implemented. See [authentication implementation and operational setup](docs/AUTHENTICATION_IMPLEMENTATION.md). Final authentication Figma visuals remain provisional. Production public auth requires explicit keys, TLS SMTP, a maintained password blocklist and controlled owner bootstrap; private development QA can use the explicit loopback-only mail-capture mode; no credentials or seed accounts are supplied. Mobile API requests use bearer access tokens, not browser cookies.

See [public development and testing](docs/PUBLIC_DEVELOPMENT.md) for safe local checks and the verification-only CI strategy. Physical-device readiness is still pending; private operator instructions are excluded.

## Checks

```sh
npm run check
# On a disposable migrated database only:
DATABASE_URL='your-own-test-connection-url' npm run verify -w @trueda-tribe-id/database
DATABASE_URL='your-own-test-connection-url' npm run test:database
DATABASE_URL='your-own-test-connection-url' npm run test:auth-database
npm run export -w @trueda-tribe-id/mobile
```

Mobile bundling/configuration checks do not replace running on Android/iOS devices. Private verification reports are excluded from the public distribution. Browser tests cover the administration interface and retained reference; native device verification is separate.

## Production foundation

Versioned `/api/v1` routes, thin handlers, services/repositories, PostgreSQL-backed device/token state, shared production rate limits, live Tribe authorization, structured redacted logs, request IDs and readiness checks. External private object storage is the target for uploads; Redis/cache/jobs are optional adapters added only for actual requirements. No Kubernetes or microservices.

The API Dockerfile is a build foundation, not a deployment. Provision runtime/migration roles, secret-manager values, TLS, backups, drain timeouts and operational monitoring before serving users. No secrets are baked into images.

Development fixtures contain fictional test identities and example-domain addresses; they are never production seed data. Publishing this source does not authorize deployment or establish production readiness.
