# Tribe ID card

The existing digital card presentation supports an explicit, selectable short-lived opaque proof and authenticated same-Tribe proof verification. Proofs are kept only in component memory, cleared on refresh/expiry, and never added to Hub projections or persistence. The backend enforces active membership and the current issued card; revocation, reissue and suspension invalidate an existing proof immediately.

Verification displays exactly display name, member number, issued status and card expiry. Strict exact-key parsers reject malformed responses and unexpected fields before rendering them. Invalid, expired, revoked or wrong-scope proofs receive a uniform unavailable/invalid message; previously displayed verification results clear when input changes. A displayed result reflects the time of that check and does not promise continuous validation.

This member UI does not add a public verifier, QR generation/scanning, download, or card lifecycle administration. T14 remains partial until the separate T17 administration workflow and T07 native-device acceptance evidence are completed.

Run mobile transport/contract/real-route bridge tests with the mobile test command. Run isolated native component interactions with `npx playwright test --config apps/mobile/qa/cards/playwright.config.ts`. Browser execution of native components does not establish physical Android/iOS behavior.
