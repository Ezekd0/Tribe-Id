# Native mobile implementation status

> Historical milestone record. Current authentication/integration/device status is in [REAL_DEVICE_TESTING.md](REAL_DEVICE_TESTING.md) and [AUTHENTICATION_IMPLEMENTATION.md](AUTHENTICATION_IMPLEMENTATION.md); older missing-auth/member-screen statements below are superseded.

**Current core-member status:** see [MEMBER_EXPERIENCE.md](MEMBER_EXPERIENCE.md). The Hub-only report below records the prior visual milestone; its pending-screen/logout notes are superseded by that report. Fresh sign-in still awaits a public authentication contract.

Updated after the Hub visual-fidelity pass, 4 October 2026. React Native + Expo + TypeScript remains the primary client; Fastify/PostgreSQL architecture is preserved. Scope is the Hub and reusable member shell only.

## Implemented

- Native member shell with safe-area support, icon header, fixed bottom navigation, modal menu, Android back handling and selected-route accessibility state.
- API-driven Tribe Hub: identity/member number, compact card, latest announcement and two upcoming events; no production fixtures or fake notification count.
- Reusable `TribeHeader`, `MemberIdentityCard`, `AnnouncementCard`, `QuickAccessCard`, `EventCard`, `TribeBottomNavigation`, `Avatar`, `TribeIcon`, and `MemberShell`. Existing state primitives expose `LoadingState`, `EmptyState`, `ErrorState` and retry behavior.
- Montserrat Regular/Medium/SemiBold/Bold bundled with license. Consistent Feather placeholders replace text navigation. Source black/purple/white, border opacities, compact typography, radii and spacing restored from saved Figma context.
- Scrolling content and flexible layouts for long data, a stacked welcome below 380px, and adaptations for larger text. API/session orchestration remains separate from visual components.
- Existing protected `/me` and `/tribes/:tribeId/hub` integration and SecureStore refresh preserved. Request generations guard stale completions.

Set `EXPO_PUBLIC_API_URL` to the Fastify base URL reachable from the device; production requires HTTPS. Set `EXPO_PUBLIC_TRIBE_ID` when multiple active memberships exist. No first-Tribe selection is silently made. Designed authentication must later integrate issued tokens with the app runtime's `MobileSession.accept`; no public issuance/login endpoint currently exists.

## Remaining fidelity gaps

The saved high-fidelity context supports geometry, but no Figma reference screenshot or exact exported artwork is locally available. No further MCP calls were made during this pass. The Hub is substantially closer to the saved design, **not certified pixel-identical**. Inter body fonts, card background, Tribe logo, drawer background and exact Figma icon exports remain missing. Neutral labelled artwork slots and one temporary icon family are deliberate. Sample portraits remain API-driven, with a neutral fallback.

Exact source filenames, slots, font requirements and adaptive decisions are documented in [HUB_VISUAL_FIDELITY.md](HUB_VISUAL_FIDELITY.md). Drawer width/touch targets adapt the miniature source for readable mobile interaction. Card verification remains an empty neutral slot, not a QR feature. Notification count is omitted because no notification contract supplies one.

Profile, ID-card and announcements routes still show explicit implementation-boundary panels. View all and Register still explain their missing designs/API. Logout integration is unfinished and remains absent. No additional screens, authentication design, settings design or administration UI were invented.

## Verification results

- `npm run typecheck`: strict workspace and verification-script checks passed.
- `npm test`: all five API test files and all three mobile/integration test files passed.
- Native integration test: mobile `ApiClient`/`MemberService` consumes authenticated Fastify `/me` and Hub responses through `app.inject`, preserving actual supplied identity, card, announcement and event projections. Repositories are test doubles; this is not a live PostgreSQL/device round trip.
- Presentation tests: smaller-screen/large-text layout policy, announcement age, multi-day dates and event timezone formatting passed.
- Android and iOS Expo/Hermes exports passed with the local Montserrat/Feather font assets bundled. This is bundle validation, not a signed native release.
- `scripts/verify-native-hub-layout.mjs`: 12 combinations across 402 × 769 and 360 × 640 passed, covering normal, long data, empty, loading, error/retry and signed-out states. Zero horizontal overflow/runtime errors in those runs. Header/ID CTA/quick-access/drawer/bottom navigation and selected tabs passed. Screenshots reviewed at both sizes, including scrolled event content.
- Accessibility basics reviewed: named actionable controls, selected tabs, meaningful card identity/status label, heading roles, loading label/live status, 44px primary controls, font scaling enabled, nontruncated data and image-failure fallback. Native VoiceOver/TalkBack and enlarged system-font rendering remain device checks; small accent typography retains the source palette rather than claiming full accessibility certification.

The isolated `apps/mobile/qa` host renders the actual native components through Expo Metro + React Native Web, with test-only fixtures. It is not imported by the native app entry. Browser QA cannot establish native safe-area, gesture, Android hardware-back or screen-reader behavior. Android back logic remains intact; emulator/device verification is still outstanding.

Metro explicitly pins shared dependencies to the mobile React instance, fixing duplicate-React resolution caused by the retained web reference's different React version. Backend routes, architecture and database schema are unchanged.

## Dependencies

Added Expo-compatible `@expo/vector-icons`, `expo-font` and `react-native-safe-area-context` for the native visual system. React DOM 19.2.3 and React Native Web are development dependencies solely for QA. No existing backend, Expo or React Native dependency was upgraded to suppress advisories.

The successful package install audit still reports **23 findings (16 high, 7 moderate)**. Earlier provenance review remains applicable: braces through Expo CLI/Metro/micromatch; node-forge through Expo CLI/code-signing tooling; uuid through Expo config plugins/xcode. These are transitive tooling paths, with no direct mobile application imports. Full advisory-by-advisory remediation remains a deliberate upstream review; no forced downgrade or blanket fix was applied.

## API gaps

Existing read endpoints support the remaining audited member views. Missing: public authentication issuance/login/recovery, event registration mutation, profile mutation, settings/preferences, notification inbox/read state and asset upload/resolution. Card verification is undesigned and has no endpoint. Resolve contracts and authorization before implementation.

Git remains on `feature/trueda-tribe-id-foundation`. No commit, push, remote creation or deployment. No additional member screens implemented.
