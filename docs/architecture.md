# Base application architecture

## Current foundation

Base is one Next.js App Router application with Firebase Authentication, MongoDB profiles, a responsive shell, appearance preferences, opt-in diagnostics and PWA support. Account acceptance uses the Auth Emulator and isolated MongoDB. M3 retains a configurable Bubblewrap Android project and manual release workflow; Android compilation and live activation are pending as recorded in the implementation plan. M4 provides standalone container, isolated VPS release/check/rollback tooling and independent advisory workflows. Live deployment remains a separate activation step.

`src/app` owns routes, layouts, metadata, loading, and recovery pages. Server Components provide page content by default. `src/components` owns the application shell and interactive appearance/navigation controls; `src/components/ui` contains CLI-generated shadcn primitives. `src/lib/server` owns server-only access, starting with configuration. `src/lib/config` contains pure schemas and the explicitly public configuration type. `src/lib/utils` is the shadcn class-name helper.

Client boundaries cover browser authentication, interactive forms, themes, navigation, diagnostics, payment controls and error recovery. The shell accepts server-rendered children rather than moving all page code into a Client Component. There is no custom API server or client state library. Server reads call server modules directly; web mutations use Server Actions and external HTTP contracts use Route Handlers.

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
Reusable Dify execution is implemented; product-specific content schemas and workflows remain downstream feature work.
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
actor identity, recent authentication and strict inputs. User lists are paginated
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

Interactive theme controls render a stable initial state until mounted. Root hydration suppression is limited to the html element modified by next-themes. Keyboard-visible focus, skip navigation, labelled icon controls, active route state, and modal focus management are part of the shell. Desktop and mobile navigation contain Home and the two workspace destinations. The avatar menu contains Account, Credits and Preferences, plus Administration for verified admins and Sign out for signed-in users. Menu visibility is resolved on the server; destination authorization remains enforced independently. Admin navigation includes a Design system link in development, matching the showcase?s development-only route.

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

The manifest and PNG install icons describe the shared app. `public/sw.js` caches only the standalone public HTML fallback. Full document navigation uses the network and falls back on network failure, without writing fetched responses. API/auth-helper requests, RSC payloads, mutations and subresources are not intercepted. There is no offline account cache, mutation replay or automatic form-discarding refresh. Worker upgrades follow the browser's normal lifecycle.

`ANDROID_HOST` and `ANDROID_PACKAGE_NAME` supply wrapper identity through `.env.local` or process environment; `android/config.json` owns only the version. The pinned Bubblewrap generator retains `android/project`, using local icons without a live deployment. Generated sources embed the selected identity and must be regenerated when settings change. CI supplies the same names through GitHub environment variables. Signing comes from environment variables outside the generated project. The manual Android workflow is independent of web deployment and Play publishing is explicitly opt-in. Digital Asset Links uses the server runtime package/certificate settings; the private signing key is never part of the website. See [Android delivery](android.md) and [M3 testing](m3-testing.md) for setup, boundaries and pending external verification.

## AI execution extension

The reusable AI modules under `src/lib/server/ai` are server-only. The workflow
adapter uses bounded streaming and validated execution IDs; product contracts are
registered separately in `capabilities.ts`. The worker owns durable dispatch and
reconciliation, outside the web request lifetime. Unknown acceptance never causes
an automatic repeat generation request.

`aiJobs` stores owned inputs, binding fingerprints, execution evidence and leases.
`aiUsage` stores deduplicated execution/node observations with exact decimal costs
and explicit unknown values; it is separate from diagnostic `runtimeEvents` and
the user credit ledger. Managed AI reservations share the existing transactional
wallet/lot ledger, but remain held until execution settlement instead of expiring
after fifteen minutes. The credit UI identifies managed holds separately.

Owner job routes require the existing verified session and mutation protection.
Administrative resolution requires recent administrator authentication and records
an audit entry in the same transaction as credit settlement. Owner DTOs expose
outputs only after success is settled. The separate AI worker rechecks Firebase
and database access before initial dispatch. Dify is disabled by default.

`aiConversations` serializes owned chat turns and `aiFiles` stores owned provider
upload references. Neither replaces permanent product asset storage. Registered
capabilities can prepare authorized inputs and materialize database results using
the credit-settlement transaction; external calls must stay outside that hook.
The `/ai` workspace and `/admin/ai` operations page expose explicit safe DTOs.
VPS Compose runs the bundled AI worker separately from web and payment processes.

The foundation is locally verified and reviewed. See [AI foundation checkpoints
and invariants](ai-foundation.md) and [setup, testing and extension contracts](ai-testing.md).
Live provider compatibility and VPS deployment have not been exercised.

### AI credit pricing

Capabilities resolve optional `AI_PRICING_JSON` policies. Jobs snapshot these terms and reserve the maximum charge; successful settlement uses exact decimal arithmetic, rounds once, consumes the calculated credits and releases the remainder atomically. `credits` on a job is the reserved maximum; `charge.credits` is the actual consumption. Provider expense observations remain separate. Missing required completed-summary usage requires review. See [pricing contract and tests](ai-testing.md#configurable-credit-pricing).

## Operations and local retention

`/ai/history` provides owned execution history in 25-row keyset pages; `/admin/ai`
paginates uncertain executions oldest first and exposes audited manual resolution.
`/admin/operations` reports active queue counts/age, unresolved AI jobs and worker
progress for the current release. Workers persist MongoDB heartbeats and atomic
local health files. Five minutes without progress or a failed cycle is unhealthy;
Compose and release checking probe the local files independently of web readiness.
Worker heartbeat documents expire after one day; `db:indexes` installs their TTL
and the operations query indexes.

Administrators manually reconcile payments using canonical Stripe evidence and
the existing fenced ledger. `paymentReviews` records each attempt before provider
access; interrupted attempts remain visible for review. A replayed request key
returns its existing report. This operation neither issues provider refunds nor
authorizes arbitrary payment outcomes.

Cleanup uses administrator-owned previews in `cleanupReports`, a 15-minute expiry,
a bounded target snapshot and explicit confirmation. Execution rechecks access and
eligibility, skips changed targets and writes its report plus audit atomically.
Old terminal job inputs/results/source references and failed-upload names are
cleared; upload tombstones reclaim local quota. A separate abandoned-private-upload
scope fences old unattached stages and queues physical removal on the maintenance
worker. Reports distinguish database confirmation from pending/failed/deleted bytes.
Active or uncertain AI records,
provider files, billing, usage and retry fingerprints remain. Financial and audit
records have no cleanup expiry. There is no scheduled deletion or user deletion UI.
Owners can archive/restore workspaces. A separate administrator scope deletes old
archived workspace content after rechecking revision and terminal execution/upload
evidence. An owner access write serializes deletion with uploads/admissions; snapshot
deletion, event/run/inline-byte erasure, object-removal intents and the workspace
tombstone commit together. Job and command fingerprints, ledger and global audit
survive. Restored/changed targets are skipped, and tombstones prevent creation retries
from resurrecting deleted workspace IDs.
See [operator workflow](ai-testing.md#administrator-operations) for options and limits.

## Creation workspaces

`/workspaces` is a product-neutral creation surface over the AI foundation.
`workspaces` stores bounded owned aggregates with typed questions/decisions,
immutable artifact versions, dependency snapshots, approval history, quality
reviews and durable candidate manifests. `workspaceOperations` provides request
idempotency. Human workspace mutations check the workspace revision and write the account
access fence in a MongoDB transaction. Generated UI is validated data rendered
through shadcn primitives; no executable model-generated UI is accepted.

Versioned card and artifact registries pair strict shared schemas with explicit
renderers/editors. Model-controlled forms, galleries and summaries use validated,
allowlisted response actions; application-owned review cards use the existing
approval boundary. Legacy records remain readable. `workspaceEvents` records
messages and command/successful-execution evidence atomically with mutations and
settlement. Owned history reads use bounded keyset pagination. Recent messages
become frozen context for future jobs. Candidate image previews require owned,
settled, retained jobs and normalize bytes without creating a saved asset.

The development-only design system exercises these same card renderers using
deterministic examples from `creation/examples.ts`. Sample responses remain local
and pass through the shared response validators; galleries cannot fetch unowned
assets and sample review actions do not reach the approval store.

`executionProfiles` holds current administrator-managed definitions;
`executionProfileVersions` retains immutable revisions and
`executionProfileOperations` deduplicates publications. New selections write the
profile head inside the owned workspace transaction, serializing selection with
publication/disable changes. Per-candidate frozen requests can select different
configured bindings for the same capability contract. Public choices omit reusable
instruction bodies and configuration details. All bindings keep credentials in
server configuration. AI settlement records termination evidence; explicit new
attempts require verified failure/cancellation and retain their predecessor job.

Batch manifests freeze input, binding, price and source/decision versions. Admission
uses deterministic keys in the existing job queue and managed credit ledger;
partial admission is visible and resumable. Settled results are explicitly selected
and imported once. Source changes prevent stale replacement; artifact revisions
invalidate dependent approvals. Review findings are version-pinned and only the
human owner approves content. Uncertain jobs retain the existing administrator
recovery path. The worker supports asynchronous image validation before settlement.

`workspaceWorkflows` persists versioned step definitions, dependency graphs, pinned
sources, accepted pricing/binding fingerprints, human checkpoints and saved command
intents. The existing AI worker leases a run and saves each command before applying
it through the workspace store. Replaying a command uses the original idempotency
key. Workflow commands tolerate unrelated aggregate revisions while still checking
source versions, decisions, access and the run lease. Required predecessor answers
and checkpoint approvals are checked again transactionally at batch creation;
reopened cards retain replacement links. Human run controls use independent run
revisions and `workspaceWorkflowOperations`. Pause/cancel ends the scheduling lease;
late jobs from a cancelled run cannot dispatch. Admitted jobs still use existing
provider cancellation and settlement rules. Scheduling uses the AI worker's existing
heartbeat and requires AI execution to be enabled.

Reviews materialize deterministic, individually tracked quality findings, including
legacy reviews without destructive migration. Acceptance/reopening/resolution keeps
actor, reason, version and review evidence and invalidates current approval. Targeted
repair atomically records a bounded attempt with a new run; it produces a new version,
re-reviews it and waits for human approval. Resolution is explicit and requires a
newer version with a fresh review and no open blocking findings. There is no automatic
unbounded repair loop or additional credit ledger.

`workspaceAssets` stores immutable, owned metadata and either bounded inline bytes
or private S3-compatible object references. `workspaceAssetStages` records random
immutable keys before external writes; successful stages attach transactionally.
Unknown uploads remain cleanup candidates. Approved abandoned-object removals use
durable leases and retries on the existing payment/maintenance worker, with exact
version deletion and digest/size checks. Remote I/O stays outside MongoDB transactions.
Downloads require the owner session, verify object integrity and prohibit caching;
images are fully decoded and normalized. Immediate exports are JSON/text snapshots,
not product-specific PDF layouts. Workspace content has separate retention from
the terminal-job cleanup tool. [Creation workspaces](creation-workspaces.md) records
provider contracts, recovery semantics, extension points and enforced limits.

`workspaceExports` stores immutable export snapshots separately from workspace
aggregates. Admission and request fingerprints commit under the same account access
fence as other workspace mutations. The existing maintenance worker claims bounded
leases, renders outside transactions and stages results through private storage;
publication rechecks ownership, account access, cancellation and lease validity before
atomically attaching an asset. Local work can retry after crashes without AI dispatch
or credit charges. Archive and deletion exclude active/leased exports; deletion erases
their snapshots while retaining `workspaceExportOperations` fingerprints. The current
registered renderers produce ZIP archives and readable A4 PDF documents. PDFKit stays
external to the worker/Next bundles because it resolves module-relative resources;
standalone tracing includes that runtime dependency. Bundled OFL fonts avoid host-font
and network dependencies. Bidirectional ordering precedes shaping, and unsupported
glyphs fail explicitly instead of silently losing content. Product renderers can use
the same snapshot, owned image reader and publication pipeline.

Reference-image requests freeze up to four owned workspace asset IDs and, for an
edit, the target image asset and artifact version. The worker resolves these private
bytes into provider-local file descriptors through the existing owned upload store.
Successful uploads are reused only for the same owner, binding and content digest;
uncertain uploads require administrator recovery and are never automatically resent.
Preparation renews the unexpired worker lease before generation dispatch. Confirmed
file rejection or quota exhaustion releases the undispatched generation hold. The
generic public AI endpoint cannot submit workspace reference IDs, and stale edit
candidates cannot replace newer artifact versions. Provider-hosted copies retain
their separate provider lifecycle.
