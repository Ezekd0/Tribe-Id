# Public development and testing

This repository contains an Expo member app, Fastify API, browser administration interface, shared contracts and PostgreSQL migration definitions. Production release remains blocked pending security and operational qualification.

## Local checks

Use a supported Node version from `package.json`, then run `npm ci` and `npm run check`. `node scripts/ci-checks.mjs` adds disposable PostgreSQL integration tests, mobile JavaScript exports, browser checks, recovery checks and reproducibility checks. These tests use synthetic fixtures; never point them at member data or a production database. PostgreSQL binaries and browser dependencies must be installed locally.

`.env.example` contains configuration names and safe defaults only. Keep credentials outside Git and Expo public variables. Native signing keys, local environment files, backups and private operational records must remain excluded. Generated Android/iOS projects are not the authoritative source; Expo configuration is maintained in source.

## Free-first CI strategy

The existing GitHub Actions workflow performs verification only. It uses read-only repository permissions, disables persisted checkout credentials, cancels superseded runs and limits job duration. Public repository verification should use standard GitHub-hosted Linux runners; confirm the account's actual billing treatment before enabling additional services or runner types. No deployment, paid build service, live notification or cloud provisioning belongs in this verification workflow.

Start with pull-request typechecks, unit tests and builds. Run isolated PostgreSQL, browser and mobile export checks using synthetic data. Container inventory and local mail/worker tests provide additional packaging proof. Keep secret scanning and dependency review as merge gates; known dependency findings require explicit security decisions rather than suppression. Review and pin third-party actions to verified immutable revisions before treating CI as a release control.

Use local Expo development and local native builds first. EAS cloud builds, store memberships, macOS runners, private package registries and artifact retention can introduce charges; none is authorized by this strategy. Signed physical Android/iOS tests remain necessary, and JavaScript exports do not replace them.

No deployment automation is enabled. Any later continuous-delivery workflow must require a protected environment, reviewed immutable artifact, independently verified backup/rollback and explicit authorization for its destination and external traffic. Use short-lived workload identity where supported and staging-only permissions. Never grant privileged secrets to untrusted pull-request code.

## Publication boundary

Private audit, roadmap, account-access, deployment-decision and raw design records are retained locally and intentionally excluded. Historical links in development documents may refer to those unavailable records. They are not public release evidence. Publishing code does not establish that the application is ready for production.
