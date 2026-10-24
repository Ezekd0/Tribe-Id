# Trueda Tribe ID module boundaries

Add executable modules incrementally: authentication, membership, profiles, id-cards, announcements, events, settings, notifications, assets, administration, and audit.

Each module owns route schemas, service rules and repository queries. Route handlers must resolve identity server-side, validate input, authorize the Tribe and resource, then call a service. Repository queries use parameters and explicit Tribe predicates. Services own transactions and audit writes. Public response DTOs must not serialize raw database rows.

No mock session, default administrator, or fake production data may bypass these boundaries. `health.test.ts` verifies the current HTTP foundation; protected member and identity/security routes are implemented; see docs/REAL_DEVICE_TESTING.md for current verification.
