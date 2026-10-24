# Trueda Tribe ID frontend feature boundaries

`FoundationStatus.tsx` is the initial development connectivity view.

Add authentication, tribe-hub, profile, id-cards, announcements, events, settings, and administration incrementally. Keep each feature's components, data adapters and state together. Shared interactive controls belong in `../components`; API requests should move into a shared client when authenticated routes are available. Use shared contracts for public DTOs, not database row types.

Only Page 2 in the inspected Figma file establishes the Tribe member design. Download and verify its assets and fonts before implementing its screens. The development view does not serve as a visual source of truth.

## Reference sign-in boundary

The reference supports existing-account password sign-in, authenticator setup/verification/recovery, bearer member reads, refresh rotation, server logout, and a dedicated authorized administration workspace. It reuses the platform-neutral mobile `SessionCore` and `ApiClient`; the web adapter explicitly omits cookies on all requests. Access and refresh credentials remain only in the current JavaScript tab memory. A reload starts signed out. No localStorage, sessionStorage, IndexedDB or cookie credential store is used.

This remains a member UI reference, not a supported client with account lifecycle parity. Account enrollment, email verification, password recovery/reset, personal security settings, device management and membership switching remain in the mobile client. An authenticator challenge grants no member access until verification succeeds; newly issued recovery codes require explicit acknowledgment before continuing. Authorized administrators can manage invitations in the administration workspace. No fixture credential is accepted by this sign-in path. The illustrative preview remains separately gated by development mode and explicit `VITE_MEMBER_PREVIEW=true`.
