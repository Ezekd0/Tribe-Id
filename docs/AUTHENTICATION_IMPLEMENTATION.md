# Approved native authentication implementation

Implemented 5 October 2026 on `feature/trueda-tribe-id-foundation`. This follows the user's approval of `AUTHENTICATION_DESIGN_PROPOSAL.md`. No commit, push, remote, deployment, real email delivery, production identity or production secret was created.

## Identity and state machine

An authorized active administrator/owner with an MFA-authenticated session issues a member-only invitation, supplying the authoritative member number. The API does not invent a numbering format or external registry. Invitations expire after seven days and are revocable and single-use. New-account enrollment establishes a real Argon2id credential and pending membership, then queues a separate email verification token. Verification establishes mailbox control, not eligibility. An authorized authority explicitly records a membership attestation reference and activates the pending membership. Regular members cannot issue invitations or activate members.

Existing verified accounts accept an invitation after sign-in with matching canonical email; enrollment cannot replace their password. One global account can have multiple memberships. Suspended/revoked members lose Tribe resources immediately. Reactivation returns the membership to pending and requires a new authority attestation. Privileged reactivation/role grants require an owner. Owner removal requires a future controlled ownership-transfer workflow; it is rejected here.

Verified enabled accounts without active memberships can sign in and manage their own security and pending membership status, but cannot read protected Tribe content. Multiple active memberships receive a minimal API-driven chooser rather than an environment-variable-only dead end. The existing Hub and feature components remain intact.

Administrator/owner login stops at a five-minute password-authenticated challenge until MFA enrollment/verification succeeds. Members do not require MFA initially; an already-enrolled factor is honored. TOTP uses six digits, 30-second periods, a bounded one-step clock tolerance and a persisted last accepted step to prevent replay. Secrets are encrypted with purpose-bound AES-256-GCM. Ten random, hashed one-use recovery codes are shown only at enrollment. Recovery requires password authentication plus a recovery code, invalidates sessions/challenges, increments credential version, removes the old factor/codes and requires a new authenticator before issuing access. Ordinary email password recovery cannot bypass MFA. Loss of both the factor and recovery codes has no self-service bypass; identity/support recovery must be approved separately.

## Database and backend modules

Forward migration `004_identity_authentication.sql` adds account status, credential versions, session MFA assurance, invitation and administrator-attestation records, purpose-bound account-token metadata, global authentication security events, encrypted durable email outbox, challenges, MFA factors and hashed recovery codes. Migration `005_identity_lookup_indexes.sql` indexes user membership/privileged checks, challenge invalidation and audit request lookup for the added hot paths. Previous migration checksums are unchanged. Readiness requires migration 005.

`modules/auth` separates password/encryption/TOTP primitives, shared counters/mail/verification interface, identity workflows, route schemas, session repository and outbox delivery. `MembershipVerificationProvider` is the integration seam; `AdministratorVerification` records a real authorized administrator's attestation and does not claim to query an external system.

Argon2id uses 64 MiB, three iterations and parallelism one, with unique salts and encoded hashes. Hash/verify concurrency is bounded per API instance; hashing happens outside long-held database locks. Passwords accept 15–128 Unicode code points, reject common/repetitive entries, support managers/paste, and have no composition or periodic-expiry rule. Production public auth requires a maintained local common/compromised-password blocklist, not a tiny development fallback. Benchmark the KDF/concurrency budget under deployment load.

Password verification reads a snapshot, then issuance locks the user and checks the credential version/hash/status again. Reset, sensitive email confirmation, disable, role grants and refresh use compatible user-lock ordering. Cross-user administrative mutations acquire affected users in UUID order. Reset atomically consumes its token, changes the credential/version, invalidates outstanding account tokens/challenges and revokes both current mobile and legacy session records. It never automatically signs in.

The current 15-minute access/30-day absolute-family model stays. Only opaque-token hashes are stored in validation tables. Rotating refresh transactions retain consumed hashes through family expiry; replay revokes the family. Live account/version/privileged-MFA checks enforce immediate denial. Device listing and revocation are owner-scoped. Logout-all coordinates with issuance/rotation through the user lock.

## API contracts

Every path below is prefixed `/api/v1`. Mutation success is 204 unless stated; auth responses are `no-store`. Error envelope remains `{error:{code,message,requestId}}`.

| Method/path | Request and result |
| --- | --- |
| POST `/auth/enroll` | `invitationToken,password,displayName`; queues verification; pending membership; no session |
| POST `/auth/invitations/accept` | Bearer, `invitationToken,displayName`; matches authenticated email; no credential replacement |
| POST `/auth/verification/request` | `email`; generic 202 acknowledgement |
| POST `/auth/verification/confirm` | `token`; consumes one-hour mailbox verification token |
| POST `/auth/login` | `email,password,deviceName`; token pair or `{challengeToken,enrollmentRequired}` without access |
| POST `/auth/mfa/setup` | `challengeToken`; returns enrollment key/otpauth URI only for an unenrolled password-authenticated challenge |
| POST `/auth/mfa/verify` | `challengeToken,code`; token pair, plus recovery codes only at initial enrollment |
| POST `/auth/mfa/recover` | `challengeToken,recoveryCode`; replacement enrollment-required challenge, never direct access |
| POST `/auth/recovery/request` | `email`; generic 202 acknowledgement |
| POST `/auth/recovery/confirm` | `token,newPassword`; 30-minute token; atomically resets/revokes |
| POST `/auth/password/change` | Bearer, `currentPassword,newPassword`; reauthentication and all-session invalidation |
| POST `/auth/email/change/request` | Bearer, `currentPassword,email`; 202; old identity remains verified and unchanged |
| POST `/auth/email/change/confirm` | `token`; 30-minute new-mailbox proof; changes verified identity and revokes sessions |
| GET `/auth/memberships` | Bearer; own membership statuses only; no inactive member content |
| GET `/auth/devices` | Bearer; current session ID and at most 100 own active device families |
| DELETE `/auth/devices/:id` | Bearer; owner-scoped revocation; foreign IDs cannot revoke another account |
| POST `/auth/logout` | Existing current-device revocation |
| POST `/auth/logout-all` | All own families and pending challenges revoked |
| POST `/auth/refresh` | Existing transactional token-pair contract preserved |
| POST `/tribes/:tribeId/invitations` | MFA/scoped administrator or owner; `email,memberNumber`; returns invitation ID, not raw token |
| DELETE `/tribes/:tribeId/invitations/:id` | Authorized invitation revocation |
| POST `/tribes/:tribeId/memberships/:id/activate` | `evidenceReference`; verified enabled pending member; administrator/owner attestation |
| POST `/tribes/:tribeId/memberships/:id/status` | `status` = pending/suspended/revoked; privileged changes owner-only |
| POST `/tribes/:tribeId/memberships/:id/role` | Owner only, `role` = member/administrator/owner; revokes target sessions; no client self-grant |

Schemas bound all bodies and reject invalid token/UUID shapes. Invalid login states share a generic 401; public verification/recovery request acknowledgements do not reveal account existence. An invitation holder may receive `EXISTING_ACCOUNT` and must sign in; this is restricted to possession of a valid invitation. Unique-constraint conflicts return generic 409 with no SQL details.

## Abuse, audits and ambiguous responses

PostgreSQL counters remain shared across horizontal API instances. Fixed windows enforce five login attempts/account/15 minutes, three recovery/verification deliveries/account/hour, ten invites/actor/minute, three email-change requests/account/hour, five password-change reauth attempts/account/15 minutes, and thirty refreshes/device-family/minute. MFA challenges allow five attempts. Coarse IP budgets are separate by bounded known route groups: login 30/minute, recovery requests 10, enrollment/reset confirmations 20, refresh 120, revocation/general routes 100. Unknown paths share a bucket, avoiding arbitrary URL cardinality. These initial limits are tuning defaults, not a measured capacity guarantee. Hash saturation fails closed. No permanent attacker-triggerable account lockout is introduced.

Known and unknown activity writes `auth_security_events`, with actor/scope where available, action/outcome, request ID and optional keyed pseudonymous subject. Records omit passwords, raw tokens, seeds, recovery codes and complete bodies. Nested redaction is tested; 500 diagnostics do not log arbitrary error objects/body contents. Configure approved audit retention explicitly for cleanup; there is no automatic auth-audit deletion without that policy.

Mobile stores refresh tokens only in SecureStore and access tokens in memory. Single-flight rotation, generation guards, expiry and logout behavior are retained. Retry requires the structured `refreshUnconsumed:true` marker plus a recognized pre-rotation error. Arbitrary proxy 503, lost responses, malformed success and network uncertainty discard the old refresh token and require fresh authentication rather than replaying it. Unconfirmed logout does not falsely claim server revocation.

## Delivery, bootstrap and deployment configuration

`AUTH_ENABLED=true` requires explicit DB, independent random encryption/rate-limit keys, `MAIL_FROM` and configured SMTP. Production requires TLS and `AUTH_PASSWORD_BLOCKLIST_PATH` (at least 1000 entries, at most 10 MiB). No fake SMTP credentials, default production keys or seeded accounts exist. Keep keys consistent across replicas, backed up under deployment access control. Encryption-key rotation needs a deliberate re-encryption procedure; simply replacing the key would make existing MFA/outbox ciphertext unreadable.

Schedule `npm run auth:mail` in the existing deployment environment. It drains up to 50 outbox messages using `FOR UPDATE SKIP LOCKED`, TLS SMTP, bounded timeouts, bounded retry/backoff and ciphertext removal after delivery. No microservice, broker or process-local critical queue is added. Password reset and other domain changes commit with durable delivery records. At-least-once SMTP delivery can produce duplicate notifications after an ambiguous delivery/DB commit; validation tokens remain single-use. Expired/failed delivery must be monitored. This session did not configure or contact a real mail service.

Initial-owner bootstrap is a deployment-operator action, not a public endpoint. Configure `BOOTSTRAP_CONFIRM=establish-initial-owner`, explicit existing `BOOTSTRAP_TRIBE_ID`, `BOOTSTRAP_EMAIL`, `BOOTSTRAP_MEMBER_NUMBER`, and `BOOTSTRAP_APPROVAL_REFERENCE`; run `npm run auth:bootstrap` with the chosen password via private stdin. Never put passwords in argv/logs. A transaction/advisory lock refuses any Tribe with an existing owner and never silently grants privileges to an existing email. Controlled bootstrap explicitly attests initial ownership; mailbox verification and MFA remain required before authentication. No bootstrap was run outside the disposable test database.

Global account disabling is also a controlled operator operation, not a scoped Tribe-admin power: `npm run auth:account-state` requires `ACCOUNT_STATE_CONFIRM=controlled-account-operation`, explicit user ID, enabled/disabled state and approval reference. It locks the user, increments credential version and invalidates sessions/tokens/challenges. This preserves other-Tribe boundaries for ordinary membership suspension.

## Native UI and remaining boundaries

`AuthService`, `AuthField`, `SessionScreen` and `AccountSecurityScreen` use the existing dark/purple tokens, typography, state panels and touch controls. They support sign-in, enrollment, verification/resend, reset, MFA/recovery, device revocation, logout-all, password/email changes and accepting another invitation. Pending/no-membership access has a real status path; no mock member data enters the app. Screens scroll at small widths, avoid the keyboard, expose field/button labels, obscure secrets and provide polite error/loading announcements. Android back handling returns from auth/account forms without navigating into protected member content.

Exact authentication Figma screens are still unavailable. These are functional provisional layouts, not claimed final Figma reproductions. The Hub was not redesigned. No new official-looking assets, fonts or icon systems were fabricated; `HUB_VISUAL_FIDELITY.md` remains the asset/font manifest.

Admin visual screens, ownership transfer, recovery when both factor/codes/mailbox are lost, native automatic deep-link token delivery and unrelated member mutations are not implemented. Email token entry is deliberate POST-based confirmation, so link scanners do not consume credentials. Real SMTP delivery, device/keychain/keystore checks, native keyboard/back/screen-reader smoke checks and production load measurements remain operational validation work.

## Verification

- Strict workspace typecheck (backend/mobile/contracts/reference workspace and verification scripts).
- API/security tests: six test files; mobile/API integration tests: six test files.
- Real disposable PostgreSQL: forward migrations, existing member/session/constraint suites, and 28 authentication/security integration groups, including a paused stale-password verification racing reset, concurrent invite redemption and cross-instance replay.
- Android and iOS Hermes exports.
- Actual mobile components through isolated Expo QA host: 20 auth/account viewport/state/interaction checks at 402×769 and 360×640, no horizontal overflow; existing member tabs/menu/events/profile/settings/logout navigation checks at both sizes. This is component/browser verification, not native-device execution.
- Dependency review: 23 existing transitive Expo/Metro findings (16 high, seven moderate), rooted in braces pattern exhaustion, node-forge signature verification and uuid caller-supplied buffer bounds. They affect build/development tooling paths rather than imported Fastify auth/runtime or native auth modules. Build-tool inputs/signing remain relevant attack surfaces. Argon2/nodemailer introduce no listed advisory. Suggested automatic fixes downgrade major Expo/React Native versions; no blind fix/upgrade applied. Keep the existing deliberate framework-upgrade review.

Sources used for implementation details: [node-argon2](https://github.com/ranisalt/node-argon2), [Nodemailer SMTP](https://nodemailer.com/smtp), [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238), [OWASP MFA guidance](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html). The approved proposal records password/session/recovery guidance.
