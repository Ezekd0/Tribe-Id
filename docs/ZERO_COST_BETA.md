# Trueda Android beta — zero-cost review

Budget: ₦0. This supersedes the paid-resource proposal in CLOUD_ANDROID_BETA.md. No paid plans, resources, overages or automatic upgrades are authorized. Public exposure and APK distribution still require approval.

## Completed evidence
- Existing application retained; foundation branch unchanged.
- Draft PR #1 fixes the browser search race and supplies internal Android APK configuration.
- Full verification passed for commit 23765c7d081f19cbd0d21e15c2f8d4e2ffe5f2bf: https://github.com/Ezekd0/Tribe-Id/actions/runs/41175794272
- Render connected and My Workspace confirmed. Account inventory contains unrelated services and one free AI-CTDRS database. Do not reuse, delete or alter those resources.
- No Trueda backend, real tester accounts or APK exists yet. Expo authentication is not confirmed complete.

## Free-service feasibility (checked 2026-10-31)
| Component | Candidate | Cost gate and limitation |
| --- | --- | --- |
| API | Render Free | Shared 750 monthly service hours; sleeps after 15 minutes; about a minute to wake. Verify remaining quota and billing controls first. |
| PostgreSQL | Neon Free, separate project | $0, no card required; quota-limited compute/storage. Requires a user-owned account and verified TLS/restricted role setup. No project created. |
| Android build | Expo EAS Free | 15 Android builds/month in low-priority queue. Verify actual account plan and unused quota before build. |
| Authentication mail | Undecided HTTPS mail provider or qualified external worker | Existing app uses SMTP. Render Free blocks ports 25/465/587. Requires a reviewed delivery implementation and verified sender/controlled mailboxes. No fake verification or capture-mode production workaround. |
| Push, portraits | Defer for first sign-in beta | Keep disabled; mark these features unqualified. Do not provision paid cron jobs or storage. |

A second free Render database is unavailable while this workspace's existing free DB is active. Render Free databases also expire after 30 days. Do not delete the other project's DB to make space.

Render Free is not inherently a guarantee of zero billing: bandwidth/build overages can be billed when a payment method exists. If current account controls cannot guarantee no charge, do not deploy there. Do not remove a payment method or change shared workspace settings without separate authorization. No quota-bypassing keepalive traffic.

Neon is a proposal, not an established account connection. Use existing application authentication and pg SQL migrations; do not replace it with provider authentication or recreate the app. Confirm current Free plan limits in the actual account and stop on quota exhaustion rather than upgrading.

An HTTPS email API could avoid blocked SMTP ports, but is NOT implemented in this branch. It would need the existing encrypted outbox, bounded retries, strict TLS, private API key, idempotency, controlled recipients, sender verification and real delivery tests. A free mail tier does not establish sender ownership or authorization. Existing domain/DNS access must be confirmed; no domain purchase is authorized.

Free Render has no shell or one-off jobs. A reviewed cloud migration/bootstrap mechanism is therefore also needed before deployment; do not run migrations on every API request/startup or expose an unauthenticated setup endpoint. No paid cron scheduler is included.

## Build preparation gate
Run npm run beta:preflight from repository root BEFORE invoking EAS. It requires an actual HTTPS API origin, testing mode, real Expo owner/project UUID and the internal APK profile. It does not contact providers or print supplied URL credentials.
The mobile eas-build-pre-install hook repeats the check in EAS. This remote hook can only fail an already queued build; it is not a free-quota or billing control. Check locally in the cloud workspace first.
A pass proves configuration shape only. Verify DNS, readiness, sign-in, ownership, signing and free quota independently. No placeholder URL or invented project ID may be committed to obtain a pass.

## Ready for boss review
The code and verification evidence are reviewable now. Funding is not required to review them.
Compatible dependency updates now include node-forge 1.4.2 and Expo 57 tooling patches. npm audit reports 13 findings (2 high, 9 moderate, 2 low), down from 14 (3 high). Remaining high findings are zod and its @expo/cli dependency chain. The CLI requires zod ^3.25.76; do not force Zod 4 or an Expo SDK major upgrade without compatibility work. This remains a build-toolchain release blocker, not a clean audit.

Next technical work: resolve or explicitly assess the remaining dependency findings; provision a maintained password blocklist; implement and test a free-compatible email delivery/worker path; qualify a free migration runner; obtain the user-owned database/mail connections and Expo project association.
Only then present the exact free-resource proposal and exposure risks for approval. Do not promise an APK installation link or live health status before actual build/deployment evidence exists.

## Tester acceptance
Use synthetic identities with real controlled mailboxes and unique passwords. Exercise invitation, verification, activation, invalid-password denial, privileged MFA, session refresh, logout and logout-all. Never directly mark email verified or bypass MFA. Record sanitized device/build versions and outcomes. No real membership or identity data in this preliminary beta.

## Sources
- https://render.com/docs/free
- https://neon.com/pricing
- https://expo.dev/pricing
- https://docs.expo.dev/build/internal-distribution/
