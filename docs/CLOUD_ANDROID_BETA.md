# First cloud Android beta — release worksheet

**Budget update:** The user has set a strict ₦0 budget. See [ZERO_COST_BETA.md](ZERO_COST_BETA.md). The paid estimates below are historical analysis only and are not an active deployment proposal.

Status: preparation only. No Render/Expo account connection, staging URL, signed APK or device qualification is established by this document.

## Source and CI
Base: feature/trueda-tribe-id-foundation at 938ad3eaf8202fed7ad023da3ba15bc260fc70d0.
Original failure: https://github.com/Ezekd0/Tribe-Id/actions/runs/40142038384
The admin browser test inspected a stale list before the filtered GET completed.
The fix waits for the successful response matching search and status, retaining the existing assertions.
Require a successful complete verification run on the final release commit, including Docker jobs.

## Account connection and approval gates
Connect Render using its ChatGPT integration. Confirm the actual workspace, billing plan and available region before creating anything.
Authenticate Expo through a secure browser sign-in; never paste passwords or tokens in chat.
Verify the intended Expo owner, existing projects, account plan and remaining build allowance.
No paid plan acceptance, resource creation, public staging endpoint, external mail send or APK distribution until the user approves the exact action, current quote and security consequences.
Keep account connection approval separate from resource/publication approval.

## Backend audit
Use the existing root Dockerfile, not a new application. It compiles the API and web and runs as non-root.
Set NODE_ENV=production, HOST=0.0.0.0, AUTH_ENABLED=true, ENABLE_MEMBER_PREVIEW=false.
Use the provider-assigned port and HTTPS origin as APP_ORIGIN; optional ADMIN_WEB_DIST=/app/apps/web/dist serves existing admin UI.
Set DB_POOL_MAX within the database connection budget and TRUSTED_PROXY_CIDRS only to verified load-balancer ranges.
Never trust arbitrary forwarded IPs.

Database: 12 ordered migrations in packages/database/migrations.
Run node packages/database/migrate.mjs using a separate migration role against the NEW staging database.
The runner checks applied checksums, locks concurrent migrations and commits each migration transactionally.
Repeat once to prove idempotency. Never run against production.
Use a restricted runtime DB role and a verified TLS hostname (sslmode=verify-full); verify connectivity and actual grants.
GET /api/v1/health must return 200, status ok.
GET /api/v1/health/ready must return 200, status ready after migrations. Liveness alone is insufficient.
Readiness checks the final migration marker; independently verify all 12 checksums.

Secrets: independently generated AUTH_ENCRYPTION_KEY and AUTH_RATE_LIMIT_KEY; private DATABASE_URL and SMTP_URL.
AUTH_PASSWORD_BLOCKLIST_PATH must point to a maintained list (at least 1000 entries, at most 10 MiB); the image currently does not supply it. Provision before enabling production auth.
SMTP must use smtps or requireTLS=true, with a verified MAIL_FROM sender.
Invitation/verification/reset email is queued encrypted in PostgreSQL. The separate bounded mail worker must run for delivery.
Keep AUTH_MAIL_DELIVERY_ENABLED=false until the specific synthetic mailboxes and send window are approved.
After approval, schedule node apps/api/dist/operations/auth-mail-worker.js and monitor delivery outcomes without recording tokens or message bodies.
Local capture is forbidden in production and cannot substitute for staging email proof.

R2 portraits are optional in runtime configuration. Leave all R2 credentials empty if deferring portrait qualification.
Existing scripts/release-preflight.mjs requires private EU R2 and retention settings; it will remain blocked without those.
Do not call a partial beta a full release or weaken the preflight to obtain a pass.
Push and informational email remain disabled. Existing Render template includes workers for these optional capabilities; do not create unused workers automatically.
Approve retention policy and qualified backup/restore procedure before storing any real user data. Use synthetic data only.

## Proposed staging scope (not authorized)
Prefer a separate staging database and API, with manual deployment and no production credentials.
Existing deploy/staging/render.yaml.example proposes Frankfurt, API 1c-2g, PostgreSQL 0.5c-1g with 5 GB disk, and four cron jobs.
Review template only: referenced secret groups do not exist by implication. Its STAGING_PROPOSAL.md reference is stale.
Public list rates checked 2026-10-31: API $25/month; PostgreSQL compute $19/month; disk allowance conservatively $1.50/month at $0.30/GB; cron jobs minimum $1/month each plus runtime.
Full template baseline estimate: $49.50/month before workspace fees, SMTP, storage/backup, bandwidth/build overage, taxes and FX.
Do NOT treat this as an account quote or a spending cap. A reduced API + DB + auth-mail + retention scope would estimate $47.50/month on the same assumptions.
Confirm rates/allowances and an explicit maximum before approval; stop if a plan change is required.
Sources: https://render.com/pricing and https://render.com/docs/cronjobs
Database external access stays denied until exact service/operator egress allowlists are approved. Do not use 0.0.0.0/0.
API exposure permits internet traffic to authentication endpoints; enforce existing rate limits, TLS, auth, MFA and synthetic-only data.
No public announcement, custom domain, autoscaling, third-party analytics or production-data import is included.

## EAS and real URL
apps/mobile/eas.json defines preview: internal distribution, APK, preview EAS environment, testing application environment.
Use the existing apps/mobile project from the monorepo. Do not create a replacement.
After secure account connection, link/create the intended EAS project and record actual owner and extra.eas.projectId in app.json.
Back up the Android signing key securely; never commit credentials.json, keystores or Expo tokens.
Set EXPO_PUBLIC_API_URL in EAS preview environment to the exact VERIFIED staging HTTPS origin (no /api/v1 suffix).
The client appends API paths. Never substitute localhost, a LAN address or a placeholder.
EXPO_PUBLIC values are extractable from the APK: only public URL/environment/project metadata belong there.
Run the existing mobile environment validator and export with the real preview configuration.
No EAS Update channel or automatic store submission is included.
Before triggering a build, inspect source archive, project, SDK compatibility, signing credentials, plan quota and cost; request approval for the build and later distribution.
From apps/mobile, approved build command: eas build --platform android --profile preview.
Pin the verified EAS CLI version in the cloud operator environment at execution time.
Record build ID, source SHA, APK checksum, application ID and version. A bundle export is not an APK or installation test.
Internal build links allow unauthenticated downloads by default; require Expo sign-in or explicitly approve link-based access before sharing.
Source: https://docs.expo.dev/build/internal-distribution/

## Synthetic testers and sign-in proof
Use four isolated fixtures: active member, pending member, suspended member, and administrator.
Mailbox addresses must be explicitly allocated, controlled and deliverable; example.invalid addresses are for isolated automated suites only.
No default password, direct verified=true edit, automatic MFA skip or shared real identity.
Existing scripts/bootstrap-owner.ts establishes the initial owner with private stdin and an actual approval reference.
scripts/qa-operator.ts uses real MFA-authenticated authority APIs for invitations and activation.
Follow invitation acceptance, password policy, email verification and membership activation with auditable evidence.
Prove invalid-password rejection, unverified/pending restrictions, valid login, MFA for privileged accounts, refresh after restart, logout and logout-all.
Run isolated HTTP/PostgreSQL/SMTP fixture tests first; then repeat against the real staging service and controlled mailboxes.
Do not publish passwords, verification tokens, recovery codes or session credentials in GitHub, logs or screenshots.

## Tester checklist
- Install approved APK on a physical Android device; record Android version and build ID.
- Confirm testing label and exact staging host; no Expo Go or running local PC is required.
- Accept invitation and verify controlled email; sign in normally.
- Check member identity/card, announcements, events and account security.
- Confirm pending/suspended users and member-to-admin attempts are denied appropriately.
- Restart app and check session restoration; log out, then confirm protected data is removed.
- Test password reset and revoked sessions; do not expose reset links in bug reports.
- Check offline/slow-network errors and retry behavior without duplicate mutations.
- Mark portraits/push as unqualified if excluded; do not claim full feature coverage.
- Submit sanitized steps, expected/actual results, device/build version and screenshots.

## Release evidence to fill after execution
Final verified commit:
Full CI run:
Render workspace/service/database IDs:
Migration and restricted-role checks:
Health + readiness timestamps and responses:
SMTP recipient approval and delivery proof:
Real sign-in/MFA/session proof:
Expo owner/project/build ID:
APK URL + SHA-256:
Link-access approval and named tester:
Device test result:
Rollback: stop distribution, disable tester accounts/revoke sessions, roll API back to prior verified image; do not reverse migrations blindly.
