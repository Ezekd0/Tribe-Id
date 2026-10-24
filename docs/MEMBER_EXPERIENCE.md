# Core native member experience milestones

> Historical milestone record. Current authentication/integration/device status is in [REAL_DEVICE_TESTING.md](REAL_DEVICE_TESTING.md) and [AUTHENTICATION_IMPLEMENTATION.md](AUTHENTICATION_IMPLEMENTATION.md); older missing-auth/member-screen statements below are superseded.

Current authentication status (5 October 2026): the approved credential/enrollment/MFA implementation supersedes the initial restore-only milestone below. See [AUTHENTICATION_IMPLEMENTATION.md](AUTHENTICATION_IMPLEMENTATION.md) for contracts, state machine, security checks and deployment requirements. The original milestone record is retained as history.

Implemented on 4 October 2026 on `feature/trueda-tribe-id-foundation`. Native React Native/Expo remains primary. Hub visual implementation is retained; its only feature change is wiring the existing View all action to Events. The modular-monolith Fastify architecture and PostgreSQL schema are unchanged. No new endpoints, dependencies, infrastructure, deployment, commit, remote or push.

## 1. Authentication/session milestone

Inspected `modules/auth/routes.ts`, `service.ts`, `repository.ts` and existing mobile SecureStore handling before implementation. Existing contracts:

| Contract | Mobile use |
| --- | --- |
| POST `/api/v1/auth/refresh` | JSON refreshToken; obtain rotated accessToken/refreshToken/expiresIn |
| POST `/api/v1/auth/logout` | Bearer-authenticated device-family revocation; 204 |
| GET `/api/v1/me` | Discover verified active memberships |
| Internal repository `issue` | Not public login; must follow credential verification |

There is **no public login/session issuance contract, credential verification, invitation acceptance or recovery flow**. The user's authentication-method clarification remains unanswered. Fresh sign-in is unfinished; do not represent this as a complete production authentication flow. No token-paste UI, hard-coded sessions or unauthenticated issuance shortcut was created.

`SessionCore` separates testable state/rotation logic from `MobileSession`'s Expo SecureStore adapter. Refresh tokens use WHEN_UNLOCKED_THIS_DEVICE_ONLY; access tokens remain in memory and honor expiresIn. Restoring is single-flight. 401 clears rejected credentials; known 503/429 can retry; network/unknown server outcomes discard the uncertain refresh token rather than replaying it. Late rotation cannot restore credentials after clear. Token responses validate opaque-token shape and positive finite expiry. HTTPS remains required in production. App foreground revalidates membership/session data. Protected request 401 renews once, then clears credentials and routes to signed-out UI.

`SessionScreen` is a minimal provisional member-access screen with restoration/retry and expired/signed-out messages. It does not display a credential form that has no endpoint. Final authentication visuals require Figma refinement. Real logout is available in drawer, Profile and Settings; local storage is removed only after confirmed server revocation (or rejected/expired credentials). Unconfirmed logout retains credentials for retry and does not claim success.

Typecheck, mobile/API tests and Android/iOS Hermes exports passed at this milestone. Session unit checks cover rotation concurrency, access expiry, ambiguous-network handling, retriable known failures, late-response clearing, authenticated logout order and rejected-session behavior. SecureStore itself still requires native-device validation.

## 2. My ID Card milestone

`IDCardScreen` loads GET `/api/v1/tribes/:tribeId/id-card` through `MemberService`. `DigitalIDCard` presents real identity, member number, portrait, join date, location and card state. Missing card, loading, error/retry and session-expiry states are supported. Revoked/expired cards are not labelled active. Uses saved `454-7.txt` proportions and the existing theme/avatar/icon system; wrapper/card grow for real data on smaller screens. Background/logo/verification remain neutral placeholders. No QR, download or verification workflow is claimed.

Typecheck, mobile/API tests, both native exports and 12 viewport/state checks passed.

## 3. My Profile milestone

`ProfileScreen` loads GET `/api/v1/tribes/:tribeId/profile`; `ProfilePresentation` renders summary, bio, private personal information, skills, teams and achievements from that response. Presentation follows saved `395-132.txt` section inventory, outlined panels, purple labels and adaptive two-column cards. Empty profile and individual missing values are explicit. All data remains private to the protected API path.

Prepared editable-field projection and proposed validation live in `editable-fields.ts`, apart from presentation/services. Those rules are preparation, not an established backend mutation policy. No endpoint exists for profile updates, so no Save request or fake edit form was added. Contact values are never seeded from Figma samples. Settings and real logout are reachable.

Typecheck, mobile/API tests, both native exports and 12 viewport/state checks passed.

## 4. Announcements milestone

`AnnouncementsScreen` loads GET `/api/v1/tribes/:tribeId/announcements`. `AnnouncementFeed` reproduces the saved `428-11.txt` category/title/body/date structure using the shared visual system. The full body is displayed inline, matching the audited feed. No unsupported announcement-detail route or data fetch was invented. Loading, empty, errors/retry and expiry are supported. Current API cap is 50 published announcements; there is no invented pagination contract.

Typecheck, mobile/API tests, both native exports and 12 viewport/state checks passed.

## 5. Events milestone

`EventsScreen` loads GET `/api/v1/tribes/:tribeId/events`. `EventsPresentation` reuses Hub `EventCard` and offers details from the returned payload. `EventDetails` displays only existing contract fields: title, location, startsAt, endsAt, timezone and registrationStatus. Dates use event timezone, including multi-day ranges. Detail/back and Android hardware-back handling are prepared; Hub View all opens the list. Current API cap is 50 upcoming published events.

Event registration has no backend/product contract. Register explicitly explains unavailability; it never changes registrationStatus or sends a fake mutation. Dedicated event-list/detail visuals were absent in the audit and remain provisional using the existing tokens/components.

Typecheck, mobile/API tests, both native exports and 12 viewport/state/detail checks passed.

## 6. Limited Settings milestone

`SettingsScreen` presents only the audited Change Password, Notification Settings and Privacy Settings labels, each with its unavailable-contract explanation. No fake toggles, local preferences presented as server state or unsupported saves. Logout works via the existing endpoint. Profile/Settings/back navigation is implemented; Settings is an internal destination, not a new bottom tab.

Typecheck, mobile/API tests and both native exports passed. QA exercised Profile→Settings→back and logout affordance at both mobile sizes. No settings read/write endpoint exists; loading/empty/network states are not fabricated for unavailable settings features.

## Shared architecture and verification

`MemberContent` dispatches typed member routes. `useResource` handles load/retry, obsolete-result cancellation and session-expiry callbacks. `FeaturePage`, `ResourceBoundary`, `Section` and `UnavailableAction` reuse existing states/tokens. Session orchestration, member services, profile preparation and presentation are separate. Bottom navigation stays Home/ID/Announcements/Profile; Events maps to Home and Settings to Profile. Android back returns Settings→Profile, Events→Hub and event detail→list; drawer dismissal behavior is preserved.

After each feature: workspace strict typecheck; all API and mobile test files; Expo Android/iOS exports. Fastify integration tests pass actual mobile ApiClient/MemberService calls through app.inject with test repositories, asserting identity/card/profile/announcement/event responses. This is not a live PostgreSQL/device round trip.

Final QA checks:

- 48 combinations: four read screens × normal/long/empty/loading/error-retry/expired × 402×769 and 360×640.
- Zero horizontal overflow or JS runtime errors in those runs.
- Actual shared production dispatcher: tabs/menu, ID/profile/feed destinations, Hub→Events→detail→back, Profile→Settings→back and logout affordance.
- Provisional access UI normal/expired/loading at both sizes.
- Screenshots reviewed for ID, Profile, Announcements and event content. QA data stays in the isolated preview/tests; no fixture import is reachable from the mobile app entry.
- Prior Hub regression script remains runnable and verifies unchanged Hub visual/state navigation foundation.

Browser QA renders actual native components via Expo/React Native Web; it cannot validate native SecureStore, hardware-back events, gestures, safe-area, VoiceOver/TalkBack or device rendering. Signed native release builds, device smoke tests and production load tests remain outstanding. Thousands-of-members scalability is preserved architecturally, not newly benchmarked.

No Figma MCP calls or broad audit were performed. Montserrat and temporary Feather icons remain; Inter and exact artwork are still missing. All asset/font requirements remain in `HUB_VISUAL_FIDELITY.md`. Authentication, dedicated event views and standalone Settings require later Figma refinement. ID/Profile/feed are saved-context implementations, not pixel-identical certifications.

## Remaining implementation contracts

- Public authentication issuance/login and recovery, after authentication method/account lifecycle are decided.
- Profile update/validation/authorization contract.
- Event registration/capacity/cancellation contract.
- Password changes, notification and privacy-preference contracts.
- Assets/upload/resolution and card verification requirements.

No absent contract is represented as completed functionality.
