# Tribe administration

This dedicated web workspace loads the current Tribe administration context from the server before rendering records. It supports bounded member/invitation/announcement searches, explicit evidence-backed activation, membership state changes, owner-only role grants, card issue/reissue/revocation, plain-text announcement draft/edit/publish/archive, event draft/edit/publish/cancel, and privacy-request review acknowledgement. Owner membership changes requiring controlled ownership transfer are not offered. Administration requires the established authenticator session; the server rechecks authority for every request.

The workspace reloads current context and records after every mutation. Ambiguous responses never automatically resubmit a write and never display confirmed success. If the latest records cannot be read, further actions stay blocked until reload. A 401 clears the workspace and presents sign-in. Cards can be revoked for inactive targets, while issue/reissue require an active verified target.

Privacy requests default to awaiting review, with reviewed/all filters and bounded 50-row pages. The workspace sends a bodyless acknowledgement, refreshes the current list, and explicitly states that review does not fulfill an export request or delete an account. It offers no approval, download or destructive fulfillment control. Malformed request states and lost authority block request controls.

Sign-in supports authenticator setup, recovery, replacement setup and one-time recovery-code acknowledgment. Credentials, setup keys and recovery codes stay only in component/tab memory. No browser credential persistence, uploads, public verification, protected profile editing or data export/deletion fulfillment actions are introduced here.

Playwright covers the workspace with routed API contracts; backend isolated database suites validate server authority/persistence. Real database-backed browser administration, production delivery and physical-device acceptance remain separate evidence requirements. T17 must not be reported as fully production verified from these routed browser tests.
