# Events

Active members register and explicitly cancel their own participation through bodyless scoped POST/DELETE registration endpoints. Cancelled registrations can be registered again before the stored event start. Attended events and events at/past their start have disabled participation controls. Details display the stored event timezone.

The server enforces publication, membership, first-come capacity and cutoff rules. Capacity numbers are not exposed by the current contract and are never estimated in the UI. `EVENT_FULL`, `EVENT_CLOSED`, and `EVENT_NOT_FOUND` have safe user messages. A full event remains disabled until a manual refresh; there is no waitlist.

Hub cards and the dedicated event list/details share the actual participation workflow. Pending writes disable duplicate actions. Every mutation reads current events afterwards. An uncertain response is never automatically resubmitted; the current persisted participation is shown with an uncertainty message. Failed reads block further writes until a successful reload.

Pure transport/state tests and a real-route native service bridge run in the mobile suite. Native component interactions run with `npx playwright test --config apps/mobile/qa/events/playwright.config.ts`. That Expo browser QA does not establish Android/iOS physical-device acceptance.
