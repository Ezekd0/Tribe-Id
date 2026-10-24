# Profile

The existing profile shell reads the authenticated profile contract. Its editor updates only the current member's bio, phone, location and occupation via scoped `PATCH /api/v1/tribes/:tribeId/profile`; protected identity, email, date of birth and Tribe-managed fields stay read-only.

The editor validates approved lengths and phone rules, sends only normalized changes, disables duplicate saves, discards canceled drafts, and reloads the persisted profile after a 204. An uncertain write is never automatically resubmitted: the editor reads the latest profile and reports uncertainty. If that read fails, another write is blocked until a successful reload. Cancel/back reloads the profile before exposing editing again.

`profile-validation.test.ts`, `profile-transport.test.ts`, and member service tests cover payload boundaries and transport behavior. The verification-only Expo host has interactive scenarios in `qa/profile.spec.ts`, run with `npx playwright test --config apps/mobile/qa/profile.playwright.config.ts` from the repository root. Browser execution of native components does not establish Android/iOS physical-device acceptance.
