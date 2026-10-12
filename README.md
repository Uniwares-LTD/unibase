# Base

Base is a Next.js application foundation with PWA support and a prepared Android Trusted Web Activity project. It uses TypeScript, Tailwind CSS, shadcn/ui, Firebase Authentication, MongoDB profiles, admin and credit management, optional Dify execution, and Classic/Glass/Soft Blue styles and persisted light/dark/system themes. See [the implementation plan](docs/implementation-plan.md) for verification status and remaining Android/VPS activation.

These guides describe the reusable Base project. `APP_NAME` controls the web
shell, metadata and install manifest at runtime; the credential-free default is
Base. Internal identifiers retained from the original implementation are listed
below so derived projects can replace them deliberately.

Use [the full feature test plan](docs/test-plan.md) for regression coverage and
[the readiness audit](docs/implementation-plan.md#clone-readiness-audit--2026-10-10)
for the current evidence and external limits.

## Start a derived project

1. Start from a reviewed commit. A normal Git clone includes committed files only;
   local edits must be committed before another clone can receive them. Create a
   new clone, then give it its own repository remote before publishing. Preserve
   the base revision so future fixes can be compared or carried over.
2. Install the pinned Node/npm versions and run `npm ci`. Create a new `.env.local`
   from `.env.example`, set `APP_NAME`, `APP_ORIGIN` and a **new local database name**,
   and use the local emulators. Run `npm run check:env` and `npm run db:indexes`
   before creating your own verified account and appointing the first admin.
   There is no shipped admin password or automatic credit grant.
3. Keep Dify/MCP disabled and payments disabled or in local simulation until the
   derived product needs them. Build the workers; run the maintenance worker for
   credits/private-media cleanup, and the AI worker for fake/live orchestrator Runs.
4. Replace product copy, home-page content, icons and colors. Run
   `npm run icons:generate` after editing `src/app/icon.svg`; it also creates the
   favicon. The offline fallback is deliberately generic public HTML.
5. Before deploying beside Base or another derived project, give the project its
   own runtime and infrastructure identities using the inventory below. Re-run
   affected tests after renaming; do not use a blind repository-wide replacement.
6. Run `npm run validate`, inspect each actual result, then run `npm run build`
   and the applicable HTTP/browser suites in [the test plan](docs/test-plan.md).
   Validate optional providers against new owned staging resources separately.

| Identity                        | Source to revise in the derived project                                                                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Display name, origin, style     | `.env.local` / runtime env; `APP_NAME`, `APP_ORIGIN`, `APP_STYLE`                                                                                                            |
| npm package/repository          | `package.json`, root package-lock identity, Git remotes, workflow/package settings                                                                                           |
| Local Auth/database             | `demo-unitale` in auth defaults, emulator commands/tests; `unitale_local` in database defaults and local runner; explicitly select a new database                            |
| Browser state/session isolation | `unitale-*` cookies, storage keys and offline-cache namespace in client/server modules and `public/sw.js`; use distinct origins even before renaming                         |
| Host/deployment isolation       | `/opt/unitale`, `/etc/unitale`, `/var/lib/unitale`, Compose names, SSH alias, locks and database/user prefixes in `scripts/deploy`, `deploy`, workflows and deployment tests |
| Android                         | Regenerate `android/project` with new `ANDROID_HOST` and `ANDROID_PACKAGE_NAME`; use your own signing identity and Digital Asset Links                                       |
| Optional providers/storage      | New Firebase/Atlas, Stripe catalog/webhook, Dify/MCP credentials and private object bucket/prefix; configure web and workers consistently                                    |

Copy source and licenses, not `.env.local`, caches, emulator data, ignored `output`,
private deployment snapshots, browser profiles, service-account files or signing
keys. Skill/font/Bubblewrap licenses and provenance stay with the source. Rewrite
`docs/implementation-plan.md` for the derived product's accepted scope and preserve
Base verification as reference evidence, not a claim that its new services work.

## Local development

Use Node.js **24.16.0**, pinned in `.nvmrc` and `.node-version`, and npm **12.0.1**. With your Node version manager, select the pinned version before installing.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Local development needs no cloud credentials. For account features, start `npm run emulators:auth` and `npm run emulators:mongo` in separate terminals first. The MongoDB runner downloads a local binary on first use, retains development data under `.cache/mongodb-data`, and creates the unique profile UID index. Firebase's emulator UI is at http://127.0.0.1:4000; verification and password-reset links are available in the emulator output. Auth emulator accounts reset when the emulator stops. On Windows PowerShell, use `npm.cmd` and `npx.cmd` if execution policy blocks the `.ps1` wrappers; do not change system execution policy just for this project. npm caches downloads in the ignored `.cache/npm` directory.

Copy `.env.example` to `.env.local` only when overriding the local defaults. `APP_NAME` controls the displayed name; `APP_STYLE` sets the Classic/Glass/Soft Blue default; `APP_ENV` is local, staging, or production; `APP_ORIGIN` is an origin with no credentials, path, query, or fragment. Staging/production require an explicit HTTPS origin. Only the application name, validated default style and explicit Firebase browser configuration are passed to browser components. Restart the development server after changing environment configuration.

Open [Preferences](http://localhost:3000/preferences) to switch Classic/Glass/Soft Blue and color mode. Style changes apply immediately and persist in this browser; signed-in users can also save them with Save preferences. Use the development-only [showcase](http://localhost:3000/design-system) to compare components. See [design-system customization and testing](docs/design-system.md).

## Commands

For the complete feature checklist, test accounts, automated suite order and
separate live-service acceptance, see [the full test plan](docs/test-plan.md).

For the full manual M2 checklist, emulator email links, Google troubleshooting, and automated checks, see [Testing M2 locally](docs/local-testing.md).

For port conflicts, service recovery, standalone assets and stale offline workers,
see [local troubleshooting](docs/local-testing.md#local-recovery-and-troubleshooting).

For diagnostics and offline checks, see [Testing M3](docs/m3-testing.md). For wrapper generation, signing configuration, the manual release workflow and pending device checks, see [Android delivery](docs/android.md).

For VPS setup, releases and rollback, see [Deployment](docs/deployment.md). After
building, `npm run test:health` verifies readiness with synthetic credentials and
disposable MongoDB; `npm run test:deployment` exercises release safeguards in an
owned local Docker container. `npm start` serves the standalone build and copies
its public/static assets. It defaults to loopback; set HOSTNAME and PORT explicitly
when running outside Docker.

| Command                    | Purpose                                                                                                                                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                   | Install exactly the dependencies in the lockfile.                                                                                                                                                                 |
| `npm run dev`              | Run the development server.                                                                                                                                                                                       |
| `npm run build`            | Create a production build; compilation/bundling failures return a nonzero exit code.                                                                                                                              |
| `npm start`                | Serve the production build after building.                                                                                                                                                                        |
| `npm run check:env`        | Validate configuration and report field names without printing values.                                                                                                                                            |
| `npm run typecheck`        | Generate Next.js route types and check TypeScript.                                                                                                                                                                |
| `npm run lint`             | Run ESLint without modifying source.                                                                                                                                                                              |
| `npm run format:check`     | Check application and tooling formatting without modifying files.                                                                                                                                                 |
| `npm test`                 | Run focused configuration, session-policy, and API-client tests.                                                                                                                                                  |
| `npm run emulators:auth`   | Start the local Firebase Auth Emulator.                                                                                                                                                                           |
| `npm run emulators:mongo`  | Start persistent local development MongoDB.                                                                                                                                                                       |
| `npm run db:indexes`       | Install profile/access, credit/payment, AI and reporting indexes.                                                                                                                                                 |
| `npm run test:accounts`    | Isolated access, credit, payment, AI execution and pricing tests using disposable MongoDB.                                                                                                                        |
| `npm run test:ai`          | Production HTTP tests with fake Dify and the Auth Emulator. Build first.                                                                                                                                          |
| `npm run test:ai-pricing`  | Production HTTP pricing-consent and partial-settlement tests. Build first.                                                                                                                                        |
| `npm run test:payments`    | Production HTTP payment fixtures; no Stripe calls. Build first.                                                                                                                                                   |
| `npm run worker:build`     | Build payment, AI and worker-healthcheck bundles without rebuilding Next.js.                                                                                                                                      |
| `npm run worker`           | Start payment reconciliation and credit maintenance using configured resources.                                                                                                                                   |
| `npm run worker:ai`        | Start AI dispatch and recovery using configured resources.                                                                                                                                                        |
| `npm run test:integration` | Test the production build against isolated local auth/database services.                                                                                                                                          |
| `npm run check:skills`     | Verify vendored skill resources against their recorded hashes.                                                                                                                                                    |
| `npm run validate`         | Run all local quality checks and write an advisory report to `output/validation/results.json`.                                                                                                                    |
| `npm run icons:generate`   | Render the existing Base SVG into install icons.                                                                                                                                                                  |
| `npm run android:generate` | Regenerate Bubblewrap using `ANDROID_HOST` / `ANDROID_PACKAGE_NAME` from `.env.local` or process environment, and version fields from `android/config.json`. Add `-- --release` to reject placeholder identities. |

Individual checks retain their real exit codes. The aggregate `validate` command reports warnings and exits successfully even if quality checks fail; it does not certify the build or runtime. Next.js type checking is deliberately separate from the build, following the agreed advisory policy. Always inspect the report. Dependency advisories can be inspected with `npm audit`; do not force a framework downgrade just to silence an advisory.

## Current application surface

- `/`: responsive home and application navigation.
- `/account`: email/Google sign-in, explicit registration, verification, password reset, display-name editing, read-only email, and opt-in browser diagnostics. Sign out/account switching is available in the avatar menu.
- `/preferences`: color-mode and design-style preferences, with an independent Save preferences action for signed-in users.
- `/credits`: owned wallet, held credits, debt, upcoming expiry, paginated ledger, local-only purchase simulation and opt-in Stripe Checkout.
- `/runs/new`, `/runs`, `/runs/[id]`: selectable orchestrators, durable progress, generated decisions, results and linked recovery attempts. Dify is disabled by default.
- `/admin/settings`: revisioned branding, credit packs and execution policies.
- `/admin/orchestrators`: create a working starter in Dify, register published workflows and check availability.
- `/admin/ai`: AI usage and paginated, audited resolution of uncertain executions.
- `/admin/operations`: worker/queue health, manual payment reconciliation and preview-confirm local AI cleanup.
- `/runs`: paginated owned execution history.
- `/admin/reports`: filtered runtime and permanent audit reports.
- `/admin`, `/admin/users`: authorized user management, access/profile controls and confirmed credit adjustments.
- `/manifest.webmanifest`, `/sw.js`, `/offline.html`: install metadata and a public-only offline fallback. No account/API data is persisted offline.
- `/.well-known/assetlinks.json`: Android app association from optional validated runtime settings.
- `/api/health/live`, `/api/health/ready`: uncached process and required-dependency health checks.
- Unknown routes: a recovery page with a link home. Route/global error boundaries provide retry/home recovery without exposing internal errors.

M2 account integration is locally verified; live Firebase/Atlas activation remains environment-specific. Firebase browser credentials are held temporarily in tab-scoped session storage during sign-in/verification and cleared after exchanging a verified ID token for an HttpOnly server cookie. Browser local storage holds appearance and a non-secret account-change timestamp, never application session tokens.

## M2 account configuration

Use the demo Firebase project and local MongoDB database defaults in [.env.example](.env.example); keep them aligned with the emulator command in package.json. Run `npm run db:indexes` to install the unique UID index for an explicitly configured database. Run `npm run build`, then `npm run test:integration` with the Auth Emulator running: the test runner starts a separate disposable MongoDB instance and an application server at 127.0.0.1:3101 with hardcoded demo/test configuration. Tests never use production Atlas or real Firebase accounts.

For a real environment, configure the public Firebase project ID, API key and app ID, `AUTH_MODE=firebase`, the application's HTTPS origin, a scoped MongoDB URI/database, and Firebase Admin Application Default Credentials. Remove `FIREBASE_AUTH_EMULATOR_HOST`; startup rejects emulator configuration outside local demo projects. Keep service-account files outside Git and pass their path through `GOOGLE_APPLICATION_CREDENTIALS`.

Enable Email/Password and Google in Firebase Authentication. Add the application hostname to authorized domains and `https://YOUR_HOST/__/auth/handler` as an authorized Google OAuth redirect URI. The browser receives the application hostname as `authDomain`; the narrow `/__/auth/` proxy forwards helper traffic to the configured project's Firebase Hosting domain without application cookies. Keep the default Firebase-hosted verification/reset email action handler and authorize the application return URL. Configure Firebase password policy and email-enumeration protection in the project console. Live Google OAuth, email delivery, and Atlas connectivity require verification with the intended environment's configuration; emulator results do not prove live activation.

## Administration

The administrator area is at `/admin`, with a link on the Account page for current
admins. Firebase remains the identity source; member/admin role and suspension
state are server-owned MongoDB records. All existing accounts default to active
members. Application suspension blocks both existing sessions and new session
exchange; reactivation requires a new sign-in. It does not alter Firebase provider
settings. Administrative changes require sign-in within 30 minutes, a reason
and confirmation, and write an atomic audit record.

Local MongoDB now runs a single-node replica set so access and audit changes can
commit together. Stop your existing `npm run emulators:mongo` runner before
restarting it with the updated script; it keeps `.cache/mongodb-data`. Do not delete
development data for this migration. Atlas also needs transaction support.

To appoint the first admin, create and verify an email or Google account, obtain
its exact UID from the Auth Emulator/Firebase console, then run:

```sh
npm run db:indexes
npm run admin:bootstrap -- FIREBASE_UID
```

This explicit operator command checks the configured provider/database, refuses
disabled/unverified accounts and refuses a second bootstrap when an active admin
exists. Keep the environment configuration pointed at the intended environment;
never put an admin allowlist in browser config. Later role changes use user
management. Self-demotion/suspension and removal of the last active admin are
rejected, including concurrent changes. User search accepts an exact email or UID.
`GET /api/admin/users` exposes the same authorized read with safe HTTP errors.

`npm run test:accounts` checks transactions and competing admin changes using an
owned disposable replica set. The HTTP integration suite checks member/anonymous
denial, immediate demotion and rejection of old tokens after suspension/reactivation.
Admin, credits, reports and Stripe implementation (C1-C5) are locally verified;
Play billing (C6) remains unimplemented. See [its checkpoint plan](docs/admin-credits-plan.md).

## Credits development

The wallet UI, transactional core, admin adjustments and local purchase simulator
are implemented. New accounts receive zero credits. Purchased credits
never expire; promotional grants default to 90 days and support explicit expiry
or perpetual grants. Ordinary spending defaults to 15-minute holds; managed AI holds remain reserved until
settlement or audited resolution and do not expire on that timer. Refund shortfalls create
debt, which blocks spending until covered. There is no public endpoint for
arbitrary grants or spending.

Run `npm run db:indexes` after this update to install the credit indexes as well
as profile/access/audit indexes and the 30-day runtime-log TTL. It is idempotent and uses the configured database;
it does not grant credits or change existing balances. Local MongoDB must use
the documented replica-set runner, not a standalone process.

Open Credits from your Account page. Admins can inspect a user's wallet and grant
or deduct credits from `/admin/users` after a recent sign-in. Reasons are visible
to the account owner and recorded in the permanent admin audit. The local simulator
offers labelled 100/500/1000 fixture packs and success/pending/failure/cancellation/
refund/replay outcomes without charging money. Real Stripe and Play billing remain
separate acceptance. Stripe implementation is opt-in and uses your own configured
catalog/secrets; Play remains pending. See [payment setup](docs/payments.md).

Admins can open `/admin` for a small dashboard and `/admin/reports` for runtime
and permanent audit reports. Filter by UTC dates and event, then by severity/request
ID for runtime or actor/target UID for audit. Runtime storage is best-effort with
stdout fallback and excludes free text and secrets; required administrative audits
remain transactional. See [local testing](docs/admin-credits-testing.md).

For Stripe, configure the environment values described in payment setup, install
indexes, build and run `npm run worker` alongside the app. Compose includes the
worker in the same image. `npm run test:payments` uses signed local fixtures and
never contacts Stripe; real provider acceptance remains pending.

`PAYMENTS_MODE` defaults to simulation only with local emulators and to disabled
elsewhere. Set it to `disabled` in `.env.local` to hide the simulator. Optional
`CREDIT_PACKS_JSON` defines server-owned IDs, labels, whole credit quantities and
provider mappings; private mappings are not sent to the browser. Stripe packs also
require an amount and currency. Startup
and `npm run check:env` reject invalid catalogs and non-local simulation.
See [admin and credits testing](docs/admin-credits-testing.md) for manual steps.

Run `npm run test:accounts` to exercise the wallet with a disposable local replica
set; it does not need live Firebase, Atlas or payment credentials. Tests cover
concurrent holds, duplicate requests, expiry, debt, access revocation, failed
ledger/audit rollback and ledger/projection reconciliation. Other priced features can use `src/lib/server/credits.ts` to derive the wallet owner from the session
and reserve/commit/release a server-selected price. Stripe reconciliation already
uses the internal store after provider verification; future providers must preserve
the same authorization and idempotency boundaries.

## Engineering references

- [Design system](docs/design-system.md): editable tokens, shared patterns and the development-only interactive showcase.
- [Architecture](docs/architecture.md): server/client ownership, configuration, and UI conventions.
- [VPS deployment](docs/deployment.md): M4 tooling, host inputs and activation boundaries.
- [Implementation plan](docs/implementation-plan.md): milestone scope and acceptance criteria.
- [Agent tooling](docs/agent-tooling.md): installed skills, provenance, and integrity commands.
- [Repository instructions](AGENTS.md): conventions for contributors and coding agents.

## Dify orchestrator Runs

Runs replace the former AI task/chat and creation-workspace features. Choose an
administrator-enabled Workflow orchestrator, provide its inputs, review maximum
credits and start. Progress and pending generated forms survive closing the
browser. Reopen the same Run to continue; restart and compatible stage recovery
create a new linked attempt. The default charge is one credit on successful
completion and zero on confirmed failure/cancellation.

Set `DIFY_MODE=fake` with local Firebase/MongoDB emulators for deterministic
fixtures (`decision`, `fail` and `partial` prompts). Use `DIFY_MODE=live` for
self-hosted Dify 1.17.1 and configure the connection/key references in
[.env.example](.env.example). Run `npm run db:indexes`, `npm run build` and
`npm run worker:ai`. Keep web and workers on the same database and private provider
configuration. No database is reset or migrated automatically.

Administration ? Base settings initializes defaults once, then saved policies
control web/worker behavior. Branding is explicitly allowlisted; management/encryption secrets,
connection/origin settings and Android build identity stay in environment
configuration. Accepted attempts and purchases retain their original billing
terms. Administration → Orchestrators lists Dify Workflow apps. **Create orchestrator**
creates, publishes and registers **Unibase starter**: zero Start inputs, an MCP demo
document, a Brief/Detailed Generative UI choice and a native text result. Connect
Unibase MCP in Dify first; the starter needs Dify's code sandbox, but no LLM key.
Existing published workflows use **Register** without a form. Registration checks API access, declared inputs, Human
Input WebApp delivery and referenced MCP tools, then reuses/creates an encrypted
app key and enables the Orchestrator. Register validates the saved draft and
publishes it automatically when new or changed; it never edits nodes or inputs.
Create refreshes the app list automatically and disables Dify's public Web App;
the Human Input node's WebApp delivery stays enabled for API forms.
Native End outputs are normalized by Unibase. Inline prompts require no
prompt field. Users start Runs and view owned status, node tracing and Human Input.
Disable stops new Runs; Enable checks Dify again. Unregister removes the Unibase
registration while preserving Dify and Run history. Missing Dify workflows show
Unavailable with Delete registration; stale Start requests are rejected before
reserving credits. Provider outages do not erase registrations.
Connected MCP tools can read or write according to their server's permissions;
Unibase's supplied tools are read-only examples. Manual JSON/DSL setup was removed.

See [registration and credential storage](docs/runs.md#administration-and-setup).

See [Runs setup and contracts](docs/runs.md), [AI testing](docs/ai-testing.md), and
[sanitized Dify templates](dify/README.md). The starter's live MCP/Human Input test
passed; broader plugin, image and recovery acceptance remains pending.

## MCP integration

Optional read-only MCP tools let Dify and trusted services fetch server data.
See [MCP setup, Dify testing and maintenance](docs/mcp.md). The endpoint is disabled
by default; its credential is separate from your Dify app API key.
