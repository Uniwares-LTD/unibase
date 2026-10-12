# Base application architecture

## Current foundation

Base is one Next.js App Router application with Firebase Authentication, MongoDB profiles, a responsive shell, appearance preferences, opt-in diagnostics and PWA support. Account acceptance uses the Auth Emulator and isolated MongoDB. M3 retains a configurable Bubblewrap Android project and manual release workflow; Android compilation and live activation are pending as recorded in the implementation plan. M4 provides standalone container, isolated VPS release/check/rollback tooling and independent advisory workflows. Live deployment remains a separate activation step.

`src/app` owns routes, layouts, metadata, loading, and recovery pages. Server Components provide page content by default. `src/components` owns the application shell and interactive appearance/navigation controls; `src/components/ui` contains CLI-generated shadcn primitives. `src/lib/server` owns server-only access, starting with configuration. `src/lib/config` contains pure schemas and the explicitly public configuration type. `src/lib/utils` is the shadcn class-name helper.

Client boundaries cover browser authentication, interactive forms, themes, navigation, diagnostics, payment controls and error recovery. The shell accepts server-rendered children rather than moving all page code into a Client Component. There is no custom API server or client state library. Server reads call server modules directly; web mutations use Server Actions and external HTTP contracts use Route Handlers.

The public display default is Base. `APP_NAME` feeds server-rendered metadata and
the request-time install manifest as well as the shell; image builds do not freeze
an environment's name. Internal cookie, database and deployment identifiers remain
stable for compatibility; derived projects follow the [identity inventory](../README.md#start-a-derived-project).

## Design system

`src/styles/tokens.css` owns shared typography/effect defaults and page/reading
spacing; `src/styles/presets/classic.css`, `glass.css` and `soft-blue.css` supply appearance palettes. `src/app/globals.css` maps these into Tailwind and defines
fonts, page typography, focus and motion/touch rules. `page-patterns.tsx` composes
existing shadcn Alert/Card primitives into headers, notices and empty states used
by account, credits and administrator screens. Navigation remains responsive and
uses the existing shadcn Sheet and DropdownMenu.

`/design-system` is a development-only route with synthetic interaction examples,
a sample wallet and a labelled static creator preview. It returns 404 outside
`next dev`; a path-scoped `src/proxy.ts` guard returns that status before streaming,
with a second guard in the page. It does not add creator models, generation or provider calls. Theme
selection updates browser appearance; sample actions otherwise remain in memory.
The style provider keeps the public appearance cookie and root data-style in sync.
The root validates that cookie before rendering; APP_STYLE is the runtime default.
Profiles may save default/classic/glass/soft-blue independently of light/dark/system. Older
profiles default to the application style, and updates omitting style preserve it.
Glass observes the current page's `og:image` metadata in the browser, loading only
while Glass is active. Successful covers receive a light canvas wash. Local reading scrims and denser
form/table surfaces protect contrast while clear panels show artwork through
blur, highlights and inset edges. Absent, unsafe or failed covers retain the
gradient canvas. No cover is persisted on the account.
See [design-system maintenance and testing](design-system.md).

## Configuration boundary

The server-only reader explicitly selects APP_NAME, APP_STYLE, APP_ENV, and APP_ORIGIN. It returns separate public and server configuration objects. The application name crosses into the shell and the validated default style goes to the appearance provider. The client-safe public schema reads no environment variables and strips unknown properties. Server validation rejects malformed origins, credentials in URLs, path/query/fragment suffixes, and HTTP in staging/production. Error messages identify settings without reflecting supplied values.

The Next.js instrumentation hook checks application, database, authentication and payment configuration at startup. The command-line validator loads Next.js environment files and uses the same pure parsers. `src/lib/config/database.ts` validates MONGODB_URI/MONGODB_DATABASE independently of Firebase; `src/lib/server/database-config.ts` reads only those private settings, and `mongo.ts` reuses the connection pool. Index setup uses the database parser directly; bootstrap and maintenance validate their required database/auth settings separately. Local development defaults to demo Firebase authentication and loopback MongoDB. The authentication form receives only the Firebase browser allowlist (project ID, app ID, public API key, same-origin auth domain, and local emulator URL); database configuration and Admin credentials stay server-only.

## Extension conventions

### MCP tools

`/api/mcp` is an opt-in Node Route Handler using the official MCP SDK's stateless
Streamable HTTP transport with JSON responses. Each request authenticates a
private service credential, receives a permission-filtered catalog, and uses an
isolated server/transport. The typed server-only registry calls application
services directly. Initial tools return only public app metadata and synthetic
reference data. No user identity is inferred from a service token; private reads,
writes, OAuth and persistent sessions are outside v1. Request/result bounds,
execution cancellation and allowlisted runtime logs apply at the shared boundary.
See [MCP implementation and maintenance](mcp.md) for configuration, lifecycle and
future extension requirements.

Keep one application and extend the current directories:

| Location               | Responsibility                                                        |
| ---------------------- | --------------------------------------------------------------------- |
| `src/app`              | Routes, thin Server Actions/HTTP entrypoints, page composition        |
| `src/components`       | Interactive application UI; reuse `ui` shadcn primitives              |
| `src/lib/contracts`    | Pure validated inputs and explicit output DTOs                        |
| `src/lib/config`       | Pure environment parsers with safe field-only errors                  |
| `src/lib/server`       | Server-only authorization, application services and provider adapters |
| `src/lib/server/store` | Typed MongoDB persistence, indexes and transactions                   |
| `scripts`              | Operator commands and process entrypoints                             |

Feature services derive the actor from current sessions; persistence receives
explicit authorized ownership and transaction context. Keep provider credentials
and responses behind server-only adapters. Do not copy the source project's parallel `db` /
`lib/application` trees, global agent registry or shared-user assumptions. Add
feature subdirectories only when real code needs them, not empty scaffolding.

Persisted changes must preserve profiles, access, wallets, ledger and idempotency
records. Prefer additive indexes/fields and explicit, versioned migrations when
stored data actually changes. Review existing-data compatibility and rollback
before dropping indexes or rewriting records. `db:indexes` is idempotent index
setup, not a migration/reset framework; never import the source project's destructive reset.
Dify orchestrator Runs extend the shared durable execution engine.
The existing payment worker stays focused on payment reconciliation and credit
maintenance. Quality warnings remain advisory; required behavior must still work.

## Accounts and profile ownership

The browser SDK handles Google redirect and explicit email registration/login. Unverified accounts stay in the temporary verification flow with resend and account switching. After verification, a recent ID token is exchanged for a five-day HttpOnly, SameSite=Lax cookie, Secure with a __Host- name on HTTPS. Browser SDK state is cleared after exchange. Firebase Admin checks session revocation on every protected data access. Protected profile reads and updates require a verified email, and MongoDB selectors always use the session UID.

Firebase persistence is selected during SDK initialization, before redirect processing. A recent tab-scoped Google-attempt marker permits completing a Google user already restored by the SDK when the separate redirect result is empty; unrelated or stale SDK state is never reused. An incomplete redirect displays an explicit error. Local browser emulator URLs use the application's loopback hostname so localhost and 127.0.0.1 do not create different sites for helper storage; the Admin emulator endpoint remains independently configured.

`src/lib/server/profiles.ts` owns profile access through a reused official MongoDB driver pool. `scripts/db-indexes.ts` provisions the unique UID index. Profiles contain only UID, email, display name, color mode, style preference and update timestamp. Strict mutation schemas reject supplied ownership fields. Account edits display name and shows read-only email; Preferences edits color mode and design style. Their separate Server Actions use fresh authorization and an expected-account guard, updating only their own fields so stale tabs cannot overwrite the other section; explicit HTTP clients use `/api/profile`. Server reads call the profile module directly.

Session creation/logout and HTTP profile mutations require the exact configured Origin plus a double-submit CSRF token obtained from `/api/auth/csrf`. The CSRF cookie is HttpOnly and returned as JSON for an explicit request header. Session logout revokes Firebase refresh tokens (and therefore the user's existing sessions), clears the current cookie, broadcasts a non-secret account-change marker, and performs a full document navigation. A shared root session boundary unmounts private state, aborts pending browser API requests and rejects late responses on account changes. It covers AI, history and administrative pages as well as account/credits, and reloads on cross-tab changes and back-forward cache restoration. There is no shared client profile cache that can repopulate an old account after switching.

The fetch helper is same-origin, validates response schemas, carries request cancellation and a timeout, and never retries mutations. API failures expose a stable code, safe message and generated request ID; provider errors and credentials are not returned. The Firebase helper proxy is limited to `/__/auth/` helper filenames on the configured Firebase project host and never forwards application cookies. Its source folder is `%5F%5F` because Next.js treats literal underscore-prefixed folders as private.

## Administrator access

`accountAccess` contains server-owned roles, active/suspended status and a minimum
authentication timestamp. Missing records mean active/member; Firebase claims or
submitted profile fields cannot grant administrative privileges. Session reads and
session exchange both consult current access. Reactivation does not revive cookies
issued from authentication before suspension. Firebase provider settings remain
independent and provider-disabled accounts still cannot authenticate.

The `/admin` routes and `/api/admin/users` call fresh authorization in their server
modules. Administrative Server Actions additionally validate exact origin, current
actor identity, authentication within 30 minutes and strict inputs. Session
exchange uses the same freshness window; session cookies still last five days.
User lists are paginated
Firebase reads enriched with MongoDB application profiles; search is exact email or
UID. Account editing changes the application name, not Firebase identity fields.

Admin mutations and audit records share a MongoDB transaction. A common control
document serializes permission changes to prevent snapshot-isolation races where
admins remove each other. The actor's current access is checked again inside that
transaction. No browser role cache or old session claim authorizes the mutation.
The first admin is appointed explicitly by UID through an operator command.
Local development and transactional tests use single-node replica sets and retain
the existing development directory. Stripe code is locally verified; live provider
acceptance and Play billing remain separate checkpoints in
[the extension plan](admin-credits-plan.md).

## Stored reports

`/admin` counts application profiles, active administrators, suspended accounts,
stored errors and audit changes from the last day. Profile counts describe users
who have entered the application, not every Firebase identity. `/admin/reports`
and `GET /api/admin/reports` require fresh administrator authorization, including
inside the read transaction. Runtime and audit tables use 25-row keyset pagination
and UTC date filters; their server reads do not call our HTTP endpoint.

Structured server logs are printed to stdout and persisted after the response
through a shared queue of at most two active and 100 pending writes with 500ms
MongoDB operation deadlines. Storage failures are advisory and do not fail the
application action. Only fixed events, timestamps, status, duration, request ID
and derived severity are stored. Runtime records have a 30-day TTL and reports
exclude older records even before a TTL sweep. Admin audit and credit accounting
remain required transactional writes with no TTL. Operator stdout and browser
diagnostics are separate; reports do not ingest arbitrary console output.

## Credit accounting

`src/lib/server/store/credits.ts` owns integer wallets, source/expiry lots,
reservations, append-only ledger entries and permanent idempotency records.
Existing users start at zero. Every mutation locks its wallet, settles due holds
and unreserved expired funds, and commits its projections and ledger together
with snapshot/majority MongoDB transactions. Required admin adjustment audits
share that transaction and the administrator permission fence. Session-driven
wallet mutations also write the user's access record so a racing suspension
forces a retry with current permissions.

Promotional grants default to 90 days, allow an explicit expiry or no expiry;
purchased lots never expire. Allocation consumes earliest-expiring grants first,
then oldest perpetual lots. An ordinary reservation lasts 15 minutes and protects credits
eligible at reservation time even if the source grant expires before commit.
Release and timeout expire any such freed funds. Commit is terminal and cannot
be undone by releasing the hold. Managed AI holds bypass this timeout and retain
funds until verified settlement or audited operator resolution; a review deadline
is not an automatic refund.

Ordinary holds and admin deductions cannot create debt. Purchase reversals reclaim
unused purchase credits first, then other available credits; a shortfall becomes
debt and blocks spending. Holds backed by a reversed lot are cancelled; when other
funds are needed all wallet holds are cancelled first. Restoration restores the
paid entitlement as non-expiring credits, repaying debt first. Billing callers
must supply a verified cumulative reversal target; Stripe provider verification
and money-to-credit rounding live in its server adapter, not the wallet core.

`src/lib/server/credits.ts` derives ownership from the current verified session.
Reserve/commit/release are server-module interfaces for priced features; AI jobs
use managed reservations with atomic job/result persistence,
with no public arbitrary-spending endpoint. Retry keys return the original result;
changing the operation behind a key is rejected. Ledger, lots, reservations and
retry records have no automatic retention expiry. `npm run db:indexes` installs
credit history/expiry indexes and unique purchase references. Paid lot IDs also
derive from the source reference to enforce global ownership at insertion.

The `/credits` Server Component reads an owned wallet snapshot, 25 ledger entries
with sequence-based pagination, the next 10 expiring available lots and up to 25
active holds. `/api/credits` exposes the same allowlisted, uncached read and accepts
only a history cursor; it always derives ownership from the session. Administrators
see the target wallet and a confirmed adjustment form on the user detail screen.
Admin reasons appear in that user's ledger as well as the permanent audit.

`PAYMENTS_MODE` and `CREDIT_PACKS_JSON` are server configuration. Only IDs, labels
and credit quantities cross into the local catalog UI, not provider mappings or
private configuration. Local emulator mode defaults to labelled 100/500/1000
fixture packs; other environments default to disabled payments. Simulation is
rejected outside local emulator mode. Stripe Checkout is implemented and opt-in
with matching provider configuration; live acceptance is pending. Play billing
remains unimplemented, even if a catalog is supplied.

Simulated orders snapshot their server-selected pack quantity and owner. Success,
failure, cancellation and refund state changes commit with credit accounting using
an internal transaction callback. Replays retain the original grant key and never
restore refunded funds. Order lookup is scoped to UID and provider. All screens use the shared session boundary to clear stale content on cross-tab account changes
and back-forward-cache restoration.

## Stripe delivery and maintenance

Stripe Checkout and signed notifications are opt-in C5 code. Orders snapshot
server-selected terms and verified UID ownership. The inbox retains only provider
event/object IDs, with permanent duplicate suppression. A MongoDB-leased worker
retrieves canonical Stripe state under an order fence, verifies checkout/payment
terms and applies idempotent grants/reversals with transactional order projections.
Successful cumulative refunds use exact integer rounding; disputes reverse the
grant and wins restore only entitlement not already refunded. Checkout return
pages do not grant credits. Detected Play contexts have no web checkout fallback.

`scripts/build-worker.mjs` bundles separate payment-maintenance and AI entries. Docker copies
both bundles into the existing non-root runtime image; Compose starts the payment worker
using the same env file and database without a public port or Redis. It retries
notifications, polls overdue orders and settles due credit expiry/holds. Runtime
logging is allowlisted and advisory; financial/order writes remain mandatory.
See [payments](payments.md) for configuration, tests and external acceptance.
The separate `ai-worker` service handles generation and recovery using the same
image and runtime settings. Live Stripe activation and all actual Play billing remain unverified.

## UI and appearance

Use shadcn primitives generated by the pinned CLI and existing components before adding new ones. Application-specific compositions are allowed; parallel primitive libraries are not. Semantic Tailwind/CSS tokens define light and dark appearance. next-themes persists system/light/dark choice under a Base-specific browser storage key and handles initial appearance before hydration.

Interactive theme controls render a stable initial state until mounted. Root hydration suppression is limited to the html element modified by next-themes. Keyboard-visible focus, skip navigation, labelled icon controls, active route state, and modal focus management are part of the shell. Desktop and mobile navigation contain Home, Start run and Runs. The avatar menu contains Account, Credits and Preferences, plus Administration for verified admins and Sign out for signed-in users. Menu visibility is resolved on the server; destination authorization remains enforced independently. Admin navigation includes a Design system link in development, matching the showcase?s development-only route.

## Validation and failure behavior

Configuration tests exercise missing/invalid inputs, non-local origin requirements, public allowlisting, and non-disclosure in error messages. UI acceptance uses a real browser at desktop and mobile widths, including theme reload/system changes, account/menu navigation, focus, not-found recovery, and console/hydration checks.

Error boundaries show a safe message and retry/home recovery, emitting only a fixed event type to diagnostics if enabled. They never expose caught messages or stacks. API/action catch blocks preserve Next.js control-flow exceptions with `unstable_rethrow`; observation listeners do not suppress browser/framework handling.

Use the installed Next.js `retry` error-boundary callback for recovery: it refreshes server content and clears the error. `reset` alone only clears client boundary state and can rethrow the same failed server response. Recovery was verified in a production server using a temporary failing Server Component, removing the failure, and clicking Try again without reloading the page.

Quality checks are advisory, with individual outcomes retained. Build compilation/bundling and later runtime-readiness failures remain blocking. Imported skill workflow defaults cannot change this policy.

M4 deployment work uses `output: standalone`, with public/static assets copied into
a multi-stage non-root container. Runtime Firebase browser values still come from
the existing explicit server allowlist; no credentials are supplied at build time.
Liveness and readiness have separate uncached routes. Readiness validates mounted
Firebase credential availability and bounds the MongoDB ping. Deployment tooling
and live acceptance are described in [VPS deployment](deployment.md).

## Diagnostics, offline behavior and Android

`src/lib/diagnostics.ts` constructs records from an explicit allowlist: fixed event type, generated timestamp, bounded HTTP status, elapsed time and UUID request ID. Unknown/free-text fields never enter records. Server-only logging emits JSON with severity for API/helper completions and profile actions. Next.js `onRequestError` emits a safe event independently; it omits timing rather than inventing a request duration. No raw error, request URL, headers, body or identity is forwarded. Framework development output remains separate.

Browser diagnostics default off in every document, retain at most 100 events in memory, and clear on disable/reload. The diagnostics panel on Account uses existing shadcn controls. Error listeners and the API helper record only sanitized metadata; there is no console interception, durable buffer, diagnostics upload or debug-header response mode.

The request-time manifest uses the allowlisted runtime application name. The SVG, PNG install icons and generated favicon describe the shared app. `public/sw.js` caches only the standalone public HTML fallback. Full document navigation uses the network and falls back on network failure, without writing fetched responses. API/auth-helper requests, RSC payloads, mutations and subresources are not intercepted. There is no offline account cache, mutation replay or automatic form-discarding refresh. Worker upgrades follow the browser's normal lifecycle.

`ANDROID_HOST` and `ANDROID_PACKAGE_NAME` supply wrapper identity through `.env.local` or process environment; `android/config.json` owns only the version. The pinned Bubblewrap generator retains `android/project`, using local icons without a live deployment. Generated sources embed the selected identity and must be regenerated when settings change. CI supplies the same names through GitHub environment variables. Signing comes from environment variables outside the generated project. The manual Android workflow is independent of web deployment and Play publishing is explicitly opt-in. Digital Asset Links uses the server runtime package/certificate settings; the private signing key is never part of the website. See [Android delivery](android.md) and [M3 testing](m3-testing.md) for setup, boundaries and pending external verification.

## Orchestrator Runs

`/runs/new`, `/runs` and `/runs/[id]` replace task/chat and creation-workspace UI.
Dify 1.17.1 Workflow apps own their instructions, Agent nodes and child tools.
Unibase owns authentication, credit admission, durable history and registered UI.
The existing `aiJobs` engine stores immutable `RunAttempt` snapshots, application
logical Run IDs, linked predecessors and provider run/task IDs. `runEvents`,
`runDecisions`, `runResults` and `runAssets` hold normalized progress, server-only
form tokens/intent, safe outputs and private bytes/references. Queries always use
the verified session UID. Server pages read services directly; clients poll
uncached owned HTTP snapshots.

Dispatch intent precedes the generation POST. Unknown acceptance cannot dispatch
again. The worker fences stale leases, retrieves saved provider identity and
reconnects by workflow-run ID with matching end-user identity and state snapshots.
Node events deduplicate on execution ID/status; forms deduplicate on node/token.
A decision intent is saved under fresh access checks before its one-shot provider
submission. Dropped responses remain uncertain until provider evidence confirms
them; browser retries do not blindly resubmit. Parent Human Input mediates child
questions because workflow tools cannot pause in this Dify version. Child calls
appear as parent stages without promising their complete internal tracing.

Structured result outcomes distinguish technical success from business success,
failure and partial completion. Generated cards use the shared Runs registry and
shadcn components; executable HTML/React and unknown versions are rejected.
Images contain bounded validated bytes and UUID references that the server remaps
to owned asset IDs. Model-selected URLs are never fetched. Image normalization,
Mongo/private S3 storage and exact-object deletion remain server-only.

`/admin/settings` stores typed `baseSettings`, revisions and audited updates.
Environment values seed once; public pages use bootstrap appearance until
initialization. Database-dependent actions fail when settings cannot be read.
Workers read current settings between cycles; accepted attempts freeze pricing,
limits and reconciliation policy. Credit packs and expiry policy feed the existing
credit/purchase ledger. Management/encryption secrets, connections, deployment origin and Android
identity remain private environment configuration; absolute safety ceilings,
protocol versions and component registrations remain in code.

`/admin/orchestrators` offers a **Create orchestrator** template dropdown and
formless registration of an existing Workflow. `registration.ts` reads the
publication, acquires an encrypted key, verifies API inputs and enables a derived
definition. `dify-capabilities.ts` checks supported Start controls, Human Input
WebApp delivery/form contracts and referenced MCP authorization/tool metadata.
`orchestrator-lifecycle.ts` reconciles complete provider catalogs, verifies app
existence before admission and handles audited Disable/Unregister operations.
Missing workflows are unavailable; incomplete reads and provider errors are not
deletion evidence. A catalog cannot invalidate registrations newer than its read.
Lifecycle changes fence pending registration and increment the configuration
revision. Admission conditionally writes the current orchestrator inside the
credit/job transaction, preventing a concurrent disable from slipping through.
Unregister leaves a private tombstone to prevent seed resurrection. Accepted job
snapshots, encrypted credentials, saved results and tracing remain untouched.
Registration validates the saved draft, publishes when new or changed and checks
the resulting publication. It performs no draft mutation, injected inputs or provider
response wrapping. Obsolete input/graph setup, validation and manual-save modules/routes
were removed. Registration/audit records retain sanitized progress, not graphs.

The app contract normalizes native End outputs on the Unibase server, retaining
explicit valid structured business outcomes/cards/images. Invalid claimed rich
results fail validation. Local owned Run/attempt IDs map to Dify's returned
`workflow_run_id` and active `task_id`; declared legacy fields remain compatible.
Zero-control workflows send empty inputs. Human Input uses provider form tokens,
matching end users and event reconnect; Generative UI is validated data, never
executable model code. Saved node events form the owned tracing timeline.

MCP provider checks do not invoke remote tools or prove network reachability.
Connected providers may expose read/write operations under their own permission
and ownership rules. The built-in Unibase MCP catalog remains read-only until a
specific authorized save operation is defined; service tokens never imply user
ownership. Registration performs no generation or MCP side-effect probe.

Create selects an allowlisted JSON DSL from `src/lib/server/runs/templates` through
a shadcn dropdown. Server Components pass only template metadata to the client;
graphs and provider configuration stay server-only. Document summary, Catalog
picker and Quote approval exercise public synthetic MCP reads/calculation and
human decisions. `demo:read` separately grants the new tools. Each creation journal
binds its template ID; browser retry keys are separate per template. Existing
template-less journals map to Document summary. A template switch cannot reuse
the same import intent. Create imports its graph, checks that its draft is unchanged,
publishes it and invokes the same registration service. `orchestratorCreations`
journals the client idempotency key, irreversible import intent and confirmed app
ID with a fenced lease. Unknown imports are not repeated. This path is separate
from general registration. New starters disable the public Dify site while retaining
API access and Human Input WebApp delivery. Create merges its confirmed app into
the client list and refreshes discovery. The starter uses zero inputs, an authorized reference MCP
tool, a Human Input Generative UI choice and Code/End native text output. MCP
structured content is consumed from `json`, because Dify may leave `text` empty.
Reconnect consumes events following historical pauses; polling completed Runs
also replays available events. When terminal snapshots omit historical nodes, the
worker reads bounded Console node metadata for its accepted app/Run and saves only
titles, statuses and timings. Raw inputs/outputs are discarded. Trace transport
failure does not invalidate verified termination or charge the Run twice.

App keys use AES-256-GCM in `difyCredentials`; `difyCredentialAcquisitions` serializes
reuse/creation and retains uncertain create intent. Web/workers resolve only private
credentials. Encryption uses a dedicated secret or HKDF from the management key,
scoped to instance/workspace/app. Deterministic registration IDs prevent duplicate
orchestrators, unchanged re-registration retains revisions, and accepted attempts
keep their previous immutable configuration and credential reference. Legacy
execution references and history remain readable without reintroducing manual UI.

Existing credit reservations reserve the disclosed maximum once. Default fixed
charges apply only on business success. Verified-usage failure billing excludes
fixed/hybrid base charges and requires trustworthy summary usage. Missing usage
requires administrator reconciliation. Reconnection and decisions incur no new
reservation. Explicit recovery creates a new attempt with current terms and a
compatible checkpoint version. Otherwise restart uses latest enabled configuration.
Uncertain attempts need reconciliation or an audited administrator resolution.
Administrator diagnostic stages require a declared entry point and use new owned
executions, not arbitrary node replay.

`/admin/ai` retains usage and execution resolution. Preview-confirm cleanup removes
old terminal attempt content while retaining ownership/financial/audit/retry
identity. It excludes active or uncertain jobs and skips changed preview targets.
Private S3 removals use durable fenced intents on the existing maintenance worker.
No local database is automatically deleted.

## Runtime packaging

One Next.js standalone web application and the existing AI/maintenance workers are
bundled. `sharp` stays external for image normalization. DSL templates are traced
into the standalone app and copied by the local standalone runner. PDF/ZIP
renderers, fonts, export jobs and dependencies are removed. Container smoke checks
verify all worker entries, image normalization, excluded development dependencies
and health boundaries. Tests use disposable MongoDB and Firebase Auth emulator;
live provider, VPS and Android acceptance remain external checkpoints.
