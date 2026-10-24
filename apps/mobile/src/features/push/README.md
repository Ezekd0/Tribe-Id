# Native push integration (T38)

SDK 57 uses `expo-notifications ~57.0.21`, `expo-device ~57.0.2` and `expo-constants ~57.0.20` from the installed Expo compatibility manifest. The app config enables visible remote notifications and the private Android `tribe-notifications` channel. No silent background task or arbitrary URL execution is enabled.

A physical development/release build, EAS project UUID (`expo.extra.eas.projectId` / EAS build configuration), platform push credentials and authorized provider setup are required. Expo Go, simulator/web and missing project IDs report unavailable. Tokens stay in memory only until authenticated registration; they are never in a URL, local storage or logs. Provider calls occur during actual app use after saved push opt-in and OS permission; local automated tests inject adapters and do not call Expo.

Saving a push opt-in offers OS permission, after persisting the server preference. Existing grants reconcile on authenticated restore/foreground and token rollover. The explicit device button retries permission/registration. Denied or revoked OS permission unregisters the current session device. A disabled Tribe preference is enforced by the server and does not revoke the same device's other Tribe opt-ins. Each device registers its own current session.

Foreground notifications suppress OS banners and produce only a generic in-app inbox action; an open inbox remounts to fetch authenticated data. Background visible alerts are presented by the OS using the server's generic text. Taps, including cold-start responses, accept exactly two UUIDs (`notificationId`, `tribeId`), recheck current active membership and fetch that exact notification through the authenticated own-notification endpoint. Only the validated server source selects the events or announcements screen; a legitimate notification without a source opens the inbox. Foreign, missing or invalid notifications never navigate. Inbox source actions also navigate to events/announcements. Notification data never grants access or supplies displayed content. Duplicate hints are bounded/deduplicated, listeners are removed on sign-out/unmount, and a stopped session cannot navigate. Logout waits for dispatched registration then unregisters before server logout; backend session revocation independently prevents further delivery.

Local verification covers payload rejection, opt-in before permission, token rollover, denied permission, current-Tribe authorization, deduplication, cold start, safe failures, logout races, queued explicit permission and PUT/DELETE transport. Component QA simulates permission denial/retry after saved opt-in. This does **not** qualify real provider behavior, OS background presentation, signed builds or physical devices.

Official references:
- https://docs.expo.dev/versions/v57.0.0/sdk/notifications/
- https://docs.expo.dev/push-notifications/push-notifications-setup/
- https://docs.expo.dev/push-notifications/receiving-notifications/

## Verification on 2026-10-24

- `npm run typecheck -w @trueda-tribe-id/mobile`: PASS against actual installed SDK dependencies.
- `npm run test -w @trueda-tribe-id/mobile`: PASS, 20 test files; new push file contains 16 scenarios.
- `node --import tsx apps/mobile/src/api/push.test.ts`: PASS, 16/16 scenarios (including concurrent duplicate taps, logout races and an actual authenticated Fastify own-notification route bridge).
- `EXPO_OFFLINE=1 node node_modules/@playwright/test/cli.js test --config apps/mobile/qa/controls/playwright.config.ts`: PASS, 12/12 component cases, 25.2 seconds, local mocked Expo Web/Chrome. Sandbox startup attempts were unsuccessful; verified run allowed local networking outside the sandbox.

Task status: native implementation and local verification complete; T38 remains PARTIAL until signed-build/provider/physical-device release qualification passes. Android/iOS JavaScript export is an additional build check, not physical-device evidence.
