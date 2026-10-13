# Base foundation implementation plan

This plan builds Base as one Next.js application for the web and Android, with shadcn/ui, Firebase Authentication, MongoDB Atlas, and deployment to our VPS. It provides a reusable application foundation, optional AI execution and deployment tooling manageable by a small team.

Status: M1 and M2 implementation are complete and locally verified on 2026-10-03; the user also confirmed the local account journeys work. M3 diagnostics/PWA implementation is locally verified. Android project/workflow preparation exists, but package/hostname configuration and successful Android compilation remain pending. M4 deployment tooling is locally verified on 2026-10-04; live Firebase/Atlas/VPS activation and M5 integrated handoff remain pending. Update each checkbox only after its completion criteria have been verified, and record external acceptance checks separately.

## Agreed decisions

| Area           | Decision                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Destination    | Implement the current Base foundation; downstream product work remains separate.                                                             |
| Application    | Next.js App Router and TypeScript, with one unified frontend and backend.                                                                    |
| Android        | Package the shared web UI as a Trusted Web Activity using Bubblewrap; do not maintain an Expo application.                                   |
| UI             | Use existing shadcn/ui components and compose them into application screens; avoid competing custom primitives.                              |
| Themes         | Persisted light, dark, and system preferences using shadcn CSS variables and next-themes.                                                    |
| Authentication | Firebase Auth with Google and explicit email registration/login, verification, and password reset.                                           |
| Database       | MongoDB Atlas for application profiles and future application data; no Firestore.                                                            |
| Hosting        | Docker Compose on the VPS, GHCR images, and Cloudflare Tunnel/Access.                                                                        |
| Environments   | Isolated staging and production resources, with `_staging` and `_prod` release branches.                                                     |
| Quality policy | Quality checks report warnings; successful builds remain deployable. Build and operational failures stop release.                            |
| Deferred       | Product-specific AI orchestration, Apple sign-in, guest accounts, native-only features, offline data editing, and product-specific features. |

Ordinary web changes become available inside the installed Android application on navigation or reload without an app-store update. Changes to the Android wrapper, such as native configuration or package identity, still require a new Android release. Do not force reloads that discard a user's unsaved work.

## Milestone overview

| Checkpoint | Demonstrable result                                                                      | Depends on                                                  |
| ---------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| M1         | A responsive, themed application shell runs locally.                                     | None                                                        |
| M2         | Users can sign in and access their own MongoDB-backed profile.                           | M1                                                          |
| M3         | The same application works as a PWA and Android wrapper, with safe diagnostics.          | M2; domain and signing inputs for live Android verification |
| M4         | The application can be built, released to the VPS, checked, and rolled back.             | M1–M3 application code; deployment inputs                   |
| M5         | Integrated acceptance is documented and the repository is ready for feature development. | M1–M4                                                       |

Android project preparation can finish before VPS activation. Digital Asset Links and the complete installed-device journey must be verified after an HTTPS deployment is available. Foundation code completion and live activation are recorded separately.

## M1 Application foundation and development conventions

- [x] Create one npm project with a lockfile, a pinned supported Node LTS version, and compatible stable Next.js and React dependencies.
- [x] Separate routes, reusable UI, and server modules without introducing a separate backend framework, generic repository framework, or extra state-management library.
- [x] Use Server Components by default and Client Components only for interaction and browser APIs. Server Components call server modules directly; Server Actions handle web form mutations and Route Handlers expose explicit HTTP interfaces.
- [x] Install shadcn components through its CLI as needed: buttons, fields, cards, dialogs, menus, avatars, sheets, alerts, and loading states.
- [x] Build responsive home and account-navigation shells, light/dark/system themes, loading states, and recoverable error/not-found screens. Replace the base's demo routes and template branding.
- [x] Add separate public/server configuration validation, placeholder environment examples, and commands for installation, development, build, and validation. Server secrets must never enter browser bundles.
- [x] Establish the Base agent guidelines and import the reusable skills described below so later milestones follow the same conventions.

**Completion check:** A developer can install dependencies and run the app using documented commands. Desktop and mobile navigation work, keyboard focus remains usable, themes persist, and there are no hydration errors in the demonstrated flows. Configuration errors name missing settings without revealing their values.

**Verification:** Clean lockfile installation passed. All six advisory checks passed (configuration, skill integrity, TypeScript, lint, formatting, and four configuration tests). The final production build and server startup passed. Browser checks covered desktop/mobile navigation, keyboard and modal focus, persisted light/dark/system themes, system appearance changes, no hydration errors in exercised flows, 404 recovery, and server-error retry. A temporary failing Server Component recovered through Try again without a page reload; the fixture was removed before the final build. Nine skills and two supporting contracts pass integrity checks. At M1 completion, the production dependency audit was clean and nine development-tool advisories remained warnings. Authentication, database, Android, and VPS activation were outside M1; see later milestones for their current state.

## M2 Authentication and MongoDB profiles

- [x] Implement Google sign-in and separate email registration/login with Firebase's browser SDK. Failed login must never create an account.
- [x] Add verification email, resend, password reset, logout, and account switching. Require verified email for protected application features while keeping verification/account-recovery flows accessible.
- [x] Exchange a recently issued Firebase ID token for a five-day server session through Firebase Admin. Use an HttpOnly, production-Secure, SameSite=Lax cookie, origin validation, and CSRF protection for session mutations.
- [x] Clear temporary browser Firebase authentication state after session exchange. Do not persist application session tokens in local storage.
- [x] Configure Google redirect authentication on the application domain, including a narrowly scoped Firebase auth-helper proxy for the self-hosted flow.
- [x] Verify session validity and revocation inside server data-access functions and mutation handlers. UI redirects are not authorization boundaries.
- [x] Use the official MongoDB driver with a reused connection pool and Zod validation. Upsert profiles using a unique Firebase UID index and derive ownership from the verified session, never a submitted UID.
- [x] Deliver functional profile and preferences screens. Store neither passwords nor Firebase tokens in MongoDB.
- [x] Expose session creation/logout and authenticated current-profile HTTP interfaces. Use shared validation and safe response types with stable error code, user-safe message, and request ID.
- [x] Add a small same-origin fetch helper where browser HTTP is needed, including timeout, cancellation, and response validation. Do not automatically retry mutations or route server reads through the application's own HTTP API.
- [x] Provide Firebase Auth Emulator and isolated local MongoDB test setup, plus an explicit database-index setup command. Automated tests must never target production Atlas.

**Completion check:** Google and email account journeys work; profile persistence survives reload. Invalid/revoked sessions, cross-origin session mutations, and cross-user access are rejected. Logout/account switching cannot restore a previous user's profile through a delayed request. Email verification and password reset are demonstrated.

**Local verification (2026-10-03):** Production build, all six advisory checks (including 11 unit tests), the explicit index command, and the production-server integration suite passed. Integration exercised anonymous/invalid/revoked sessions, unverified-email denial, exact-origin/CSRF checks, oversized requests, ownership-field rejection, two-user isolation, persisted profiles, logout, cookie attributes, and safe request IDs against the Auth Emulator and a disposable MongoDB instance. Browser checks demonstrated registration, resend and verification, Google redirect with a synthetic provider account, password reset and subsequent login, saved profile/theme reload, browser Firebase-state cleanup, mobile layout, keyboard focus, and a clean application console. A delayed profile-save response could not restore the account after logout; a second tab returned to sign-in. The read-only review found no remaining in-scope defects after corrections. The implementation matches the planned application, security, and tooling boundaries; deployment and Android surfaces remain deferred.

**External checks and warnings:** Real Google OAuth, email delivery, the self-hosted helper proxy against the intended Firebase project, and Atlas connectivity require the environment inputs and live activation described below; emulator success is not evidence of those external checks. The M2-time production dependency audit reported six transitive/direct aggregate advisories (four high, two moderate), including unused Firestore dependencies bundled with the Firebase package. These remain advisory; no forced SDK downgrade was applied. Firebase's emulator reset link requires adding a newPassword query parameter, as described by its local response; real Firebase email actions use its hosted handler.

**Google redirect follow-up:** Initialization now selects session persistence before processing redirects, local browser helpers share the app hostname, and recent Google attempts can complete an SDK-restored user instead of silently signing it out. Interrupted callbacks show an error. Fourteen unit tests and the production build pass; repeated existing-account sign-ins also passed in a browser with third-party cookie restrictions enabled. These checks do not establish the exact cause of the originally reported browser-specific failure.

## M3 Diagnostics and Android delivery

- [x] Add structured server logs with request IDs, severity, and duration. Redact secrets and exclude cookies, tokens, passwords, request bodies, and unnecessary personal data.
- [x] Use Next.js route/global error boundaries, preserve framework error handling, and show user-safe, recoverable failures. Never expose server logs or stack traces because a client sends a debug header.
- [x] Add an opt-in browser diagnostics panel with a bounded in-memory buffer and redacted export. Disabling diagnostics stops collection and clears the buffer; errors do not re-enable it. Server logging remains independent.
- [x] Add a web manifest, install icons, mobile metadata, and a simple offline fallback. Cache only the explicit fallback and required assets; authenticated pages, API responses, and navigation remain network-first without persistent offline data caching.
- [ ] Generate and retain a minimal Bubblewrap TWA project targeting the production hostname. Serve Digital Asset Links using the Android package name and Play app-signing certificate fingerprint.
- [ ] Prepare a manually triggered Android workflow that builds/signs an AAB and uploads it as an artifact. Make Play publishing an explicit option, defaulting to the internal track; keep it independent of routine web deployment.

**Completion check:** Diagnostics do not reveal secrets and stop collecting when disabled. The PWA has an offline fallback and works on a mobile viewport. After M4 activation, verify Digital Asset Links, Google authentication round-trip, Android back navigation, and a real installed wrapper displaying a newly deployed web change after reload without reinstalling.

**Verification (2026-10-03):** The production build, six advisory checks, 19 unit tests and two emulator integration tests pass. Browser checks demonstrate the 100-event cap, redacted export after injected secret-bearing errors, disable/clear without automatic re-enabling, mobile layout without horizontal overflow, Cache Storage containing only `/offline.html`, offline account navigation and online recovery. API debug-header tests confirm no extra detail or caller-supplied request ID is reflected. Structured request logs show safe fields and timing. Existing M2 retry/global boundary recovery remains in place.

**Android preparation and remaining acceptance:** Bubblewrap 1.25.0 generation and actionlint 1.7.12 workflow validation pass. A minimal project, signing configuration, manual AAB/artifact workflow, optional Play publishing and runtime Digital Asset Links route are present. Wrapper identity now comes from ANDROID_HOST and ANDROID_PACKAGE_NAME in .env.local or process environment, with no hardcoded defaults; android/config.json retains version fields only. Isolated generation from an env-file fixture passed. Production values remain unset, and missing/placeholder identities are rejected by release generation. Local Android compilation failed before compiling: official Google Maven endpoints returned HTTP 404 for Android Gradle plugin 8.9.1. Therefore the two Android checklist items remain unchecked until identity configuration and a successful bundle build verify them. Real signing, public asset association and installed-device checks remain external acceptance, not inferred from browser tests. No deployment or publication occurred. See [M3 testing](m3-testing.md) and [Android delivery](android.md). Installing Bubblewrap adds development dependency advisories; the M3-time full audit reported 35 aggregate findings (8 moderate, 27 high), remaining advisory.

## M4 VPS deployment and advisory quality checks

**Implementation verification (2026-10-04):** Checkboxes below indicate implemented
tooling and local acceptance, not infrastructure activation. The standalone build
and credential-free Docker build pass. The read-only image runs as UID 1001,
excludes checked development/admin tools and env files, serves account/public
assets, and returns uncached liveness 200/readiness 503 with unavailable dependencies.
All 21 unit tests, 21 isolated deployment tests and three emulator/account HTTP
integration tests pass. Synthetic live-mode credential tests verify valid
availability, project/key rejection, missing-file recovery and bounded MongoDB
failure without contacting real Firebase. Local standalone startup also reads an
owned env-file canary correctly. Actionlint, Bash syntax, container-backed
ShellCheck, TypeScript, lint, formatting and skill integrity pass; dependency
advisories remain warnings. A separate read-only review corrected env-file startup
and found no remaining in-scope code defects. See [deployment](deployment.md) for
commands and acceptance boundaries.

Deployment tests execute the release/host scripts with mocked registry/build,
Access, SSH, health and Docker services inside a disposable Linux container. They
demonstrate that known quality warnings permit release, failed builds and stale
commits never contact the host, public packages and revision mismatches are
rejected, readiness/HTTPS failures restore the prior image and matching config,
rollback issues no data commands, staging cannot select production identities or
retained releases, and competing releases serialize under the host lock. These
tests establish orchestration behavior, not live provider or GitHub permissions.

**External activation remains pending:** Private GHCR publication/scoped pull,
protected environments/release branches, Access SSH and pinned host key, distinct
tunnels/public HTTPS, live Firebase/Atlas, and staging release/check/rollback must
be verified with the intended inputs before production activation. No commit,
push, publication, deployment or shared-infrastructure change occurred.

- [x] Build a multi-stage, non-root Next.js standalone image, excluding development dependencies, database administration tools, and secrets from the runtime image.
- [x] Implement publishing of commit-tagged private GHCR images and deployment of immutable digests. Accept scoped VPS pull credentials; never automatically make the package public. Live publication/pull remains external acceptance.
- [x] Use Docker Compose and Cloudflare to isolated Base staging/production projects, configuration directories, MongoDB databases/users, and Firebase projects.
- [x] Verify the selected release environment, branch, and current remote commit before building and before contacting the VPS. Use pinned SSH host verification through Cloudflare Access.
- [x] Configure app exposure through Cloudflare Tunnel while keeping application ports private. Do not put the operator Access login in front of the public production application. Live routing remains external acceptance.
- [x] Serialize release operations with workflow concurrency and a Base host lock. Limit all actions to Base resources so existing VPS applications remain unaffected.
- [x] Retain the previous image and matching configuration. Require readiness and an external HTTPS check after replacement; restore the prior release on failure. Database rollback is never automatic. Brief interruptions are acceptable for this initial single-instance setup.
- [x] Provide separate liveness and readiness endpoints. Liveness checks process availability; readiness checks required configuration, Firebase Admin credential availability, and a bounded MongoDB ping. Unavailable required dependencies return 503 without exposing internal details.
- [x] Add workflows for validation, deployment, deployment checking, manual rollback, and Android release. Publish sanitized outcome summaries with commit, target, and image identifiers where applicable. Android compilation/signing acceptance remains M3.
- [x] Provide an idempotent VPS setup command that previews by default and mutates only with explicit --apply. Reuse configured host access and create only Base-specific resources. Omit unrelated product storage, reset and recovery machinery.
- [x] Supply allowlisted Firebase browser configuration at runtime, keeping server credentials out of browser bundles and container layers.

### Quality policy

- [x] Run TypeScript checking, ESLint, focused tests, dependency auditing, workflow validation, and shell checks. Preserve their actual outcomes as warnings and downloadable reports.
- [x] Keep quality-check outcomes independent of deployment eligibility. They must not become required release checks or deployment job dependencies.
- [x] Run TypeScript checks separately and configure Next.js release builds to permit reported type errors. Compilation, bundling, and container-build failures still block release.
- [x] Fail release on missing credentials, target mismatch, invalid runtime configuration, or failed readiness. These are operational failures rather than advisory quality findings.
- [x] Clearly report “built successfully with quality warnings” when applicable; never label failed checks as passing.

**Completion check:** Demonstrate that a quality failure is visible but does not prevent a successful build from being deployed. A failed build never contacts the VPS. A failed candidate readiness check restores the previous application. Staging operations cannot target production or other hosted applications. Rollback does not modify application data.

## M5 Integrated verification and team handoff

- [ ] Run the integrated desktop/mobile account journey and installed Android checks from M2–M3, recording passed, failed, and pending external checks honestly.
- [ ] Verify a web-only deployment reaches an already installed Android wrapper after reload without a Play release.
- [ ] Verify application restart, environment isolation, release failure, and rollback behavior using staging before production activation.
- [x] Finalize concise setup, architecture, deployment, and troubleshooting documentation, including commands, environment inputs, credential handling, and recovery boundaries.
- [x] Verify all imported skill references, supporting files, licenses, hashes, and repository guidance. Remove inherited product names, identities, links, or configuration that do not apply to Base.
- [x] Reconcile milestone status with actual implementation and validation evidence. Quality warnings remain visible; this plan does not turn them into deployment gates.

**Completion check:** Another team member can start the application locally, understand its architecture, run checks, prepare an Android artifact, and operate the documented release/rollback workflows without relying on this chat. External activation checks remain explicitly pending until their environment and credentials are available.

**Handoff progress (2026-10-04):** A fresh headless Chromium check against local
emulators passed Google account creation/sign-in, profile save/reload persistence,
390px signed-in layout without horizontal overflow, diagnostics default-off,
enable/disable/clear controls, mobile navigation focus restoration, logout and
anonymous profile API rejection (401). Email registration/resend/verification and
password recovery also passed: the old password failed, the new password restored
the existing profile, and switching back to the existing Google account restored
its separate saved profile. All three production-server integration tests passed
against isolated local services. The signed-in offline test found only
`/offline.html` in the Base cache, showed the public fallback without the account
email, and recovered on reconnection. This is partial integrated acceptance;
installed-device checks are not claimed by this new run.
The browser reported a missing `/favicon.ico` request; no hydration failure was
observed in these exercised flows. The intentionally dispatched diagnostics error
is synthetic test input, not an application failure.

The skill audit verified all nine skill directories and two supporting contracts
against the recorded hashes, including bundled resources and provided notices.
All 25 relative Markdown links under `.agents` resolve. Repository-specific
guidance uses Base policy; upstream source/provenance links and generic examples
are retained intentionally. See [agent tooling](agent-tooling.md).

Account-free Android compilation is still incomplete. On this machine only SDK
platforms 29/30 are installed; the project requires 36. Rechecks of the official
Google plugin endpoints returned 404, and the alternate `maven.google.com` plugin
URL and official SDK repository metadata timed out. These are dependency-access
failures, not an online-account requirement or proof of a successful Android build.
The documentation-only handoff diff passed a separate read-only review and
`git diff --check`; all 55 relative file links across README, docs and agent
resources resolve. Web application/dependency inputs are unchanged from the M4 build
and advisory checks. Dependency audit warnings remain visible and advisory.
Android build verification remains unfinished; live staging and device acceptance
remain separate.

**Android compatibility correction:** Official compatibility tables revealed that
Bubblewrap's generated AGP 8.9.1 supports SDK 35 while its app targets SDK 36.
The generator and retained top-level build now use AGP 8.10.1, supporting SDK 36
with the existing Gradle 8.11.1 / Java 17 settings. Isolated regeneration, TypeScript
checking, lint and all 21 unit tests pass. The corrected official plugin URL still
returns 404, so no compiled/signed artifact is claimed. See [Android delivery](android.md).

## Agent skills and guidelines to import

Maintain these pinned reusable skills with their supporting resources, applicable licenses, provenance, and hashes:

- Framework and UI: next-best-practices, vercel-react-best-practices, web-design-guidelines, and playwright.
- Engineering workflow: work-on-task, review-change, compile-feature-spec, sync-docs-issues, and capture-project-learnings, including their implementation/reviewer contracts.

Create a concise AGENTS.md, adapt .agents/repository-adapter.md, and maintain skills-lock.json. Encode the chosen architecture, shadcn reuse rule, proportional testing, advisory CI policy, and documentation ownership. Adapt conflicting source instructions rather than copying them unchanged.

Exclude source-specific product rules, collaborator identities, Dify/PDF/AI-specific skills, machine-specific Codex configuration, and automatic publishing authority. Skills follow the user's current authorization and must not add mandatory project-management ceremony for small changes. Review guidance must not silently convert advisory quality checks into release gates.

## External inputs and activation boundaries

Implementation must accept these as explicit configuration rather than inventing or copying another application's live values:

- Base repository identity, VPS hostname, deployment SSH identity, and pinned host key.
- Cloudflare account/zone, application hostnames, tunnel configuration, and Access service credentials for deployment access.
- Scoped GHCR pull credentials and protected GitHub environment configuration.
- Staging/production Firebase project configuration, authorized domains, enabled providers, and server credentials.
- Staging/production Atlas connection details, scoped database users, and network access configuration.
- Android package name, signing material, Play app-signing fingerprint, and Play publishing credentials when publishing is selected.

The implementation produces the application and deployment tooling. Live infrastructure activation and Play publication are separate execution steps using the configured inputs. Do not infer authorization to change existing shared infrastructure or claim live success from local tests. Database backup/restore administration and provisioning new VPS or Atlas capacity are outside this foundation's automation scope.

## What complete implementation provides

Users will have a responsive Base website and an Android application showing the same interface. They can register or sign in with Google/email, verify and recover their accounts, access their own persisted profile, and choose a theme. The app provides clear failures and an explicit diagnostics option.

The team will have one application codebase and one shadcn component system. Most new features will reach web and installed Android users through a normal web deployment, without maintaining separate native screens or issuing a Play update. Android packaging remains available for initial distribution and wrapper changes.

Operators will have isolated staging/production releases on the VPS, immutable image deployment, health verification, rollback, private credentials, and visible advisory quality reports. Contributors and coding agents will have consistent setup commands and scoped, reusable repository guidance.

This delivers a reusable product foundation, without downstream product-specific workflows. The original M1-M5 scope excludes business features. Subsequent accepted extensions below implement administration, credits, Stripe and generic Dify execution with variable pricing. Subscriptions, Play billing, push notifications, offline editing and product-specific content remain deferred. A live public service and Play listing exist only after the external activation steps are completed.

## Product extension: admin and credits

The accepted follow-on plan is [Admin and credits](admin-credits-plan.md).
Its C1–C6 checkpoint state is tracked separately from the foundation milestones.
C1-C5 are implemented and locally verified; C6 Play billing is unimplemented. Live payments and Android acceptance require their
explicit provider/build inputs. Apple purchases and a new iOS app remain deferred.
C1 administrator authorization/user management, C2 transactional wallets and C3
wallet UI/admin adjustments/local purchase simulation and C4 dashboard/stored
reports are implemented and locally verified. C5 Stripe/worker implementation also
passes local verification; real provider acceptance remains separate and pending.
C6 Play billing remains unimplemented pending the account-binding wrapper decision
and successful Android dependency/build verification.

## Migration preparation checkpoint

Scope: prepare existing foundations before importing any content models or Dify
features. No persisted models, collection layouts, public APIs or environment names
change. The database configuration parser is independent of Firebase and keeps
the existing local defaults and validation rules.

- [x] Reconcile stale Stripe/client-boundary documentation and record
      [extension conventions](architecture.md#extension-conventions), including
      ownership and additive migration rules.
- [x] Split database configuration for the app, startup validator, index setup,
      admin bootstrap and payment worker without changing stored data.
- [x] Review all nine skill entrypoints and role contracts; align external-action,
      advisory-check and learning-capture guidance, correct RSC serialization,
      and retain resources/licenses with refreshed local integrity hashes.
- [x] Run the affected baseline checks and a separate read-only review.

Verified on 2026-10-05 against working-tree changes based on
`69bf95ed3871c47e6b403782e0ac6f9bb206f258`:

| Check                                                                             | Result                                                                                          |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Configuration, skill integrity, TypeScript, lint, formatting, workflow validation | Passed                                                                                          |
| Unit tests                                                                        | 32 passed, including database defaults, private errors and independence                         |
| Transactional account/credit tests                                                | 28 passed                                                                                       |
| Production build and bundled worker                                               | Passed                                                                                          |
| Production HTTP account/security tests                                            | 6 passed                                                                                        |
| Signed payment HTTP fixtures and bundled maintenance smoke                        | 3 passed; no Stripe calls                                                                       |
| Readiness/configuration failure and recovery suite                                | Passed with synthetic credentials/disposable database                                           |
| Local index setup                                                                 | Passed; existing local database retained                                                        |
| Isolated deployment tests and ShellCheck                                          | 21 tests passed; ShellCheck passed on access-enabled rerun                                      |
| Local Markdown links                                                              | 121 documentation/guidance files checked; no missing local targets                              |
| Dependency audit                                                                  | Retrieved with normal TLS verification; 8 moderate and 27 high advisories, retained as warnings |
| Separate read-only final review                                                   | No remaining actionable defects within this checkpoint                                          |

The initial `validate` report retains Docker/network sandbox warnings; targeted
access-enabled reruns verified deployment/shell checks and retrieved the audit.
The aggregate is advisory, not proof of a passing build or zero advisories.
Runtime/UI contracts and persistent accounting remain unchanged. Live identity,
Stripe, VPS, Android and Play acceptance retain their previous pending status.
No Dify assets, workflows, credentials or services have been imported or activated.

## Design-system checkpoint (before concept migration)

Scope: shared presentation for application users and operators, without content
models or generation functionality. See [the editable design system](design-system.md).

- [x] Central semantic theme tokens and shared header/notice/empty-state patterns.
- [x] Apply patterns to current Account, Preferences, Credits and Admin screens.
- [x] Add a development-only interactive showcase and labelled static creator preview.
- [x] Document change locations and a repeatable local/manual test loop.
- [x] Verify affected checks, responsive/theme/keyboard interactions and the
      production 404 guard; perform a separate read-only review.

Verified on 2026-10-05: production build/worker, TypeScript, lint and source
formatting passed; 32 unit tests and seven production HTTP integration tests passed.
The showcase guard is tested for GET and HEAD. Browser checks covered 1440px/390px
layouts on Account, Preferences, Credits, Admin, Users and Reports, sample form
validation/confirmation, dialog focus restoration, mobile menu focus containment,
skip-to-content, theme persistence/system switching and reduced-motion mode.
An enlarged layout was checked with 200% CSS zoom; native browser zoom and a full
assistive-technology audit remain in the manual checklist. Checked text pairs meet
4.5:1 in both themes and input/focus token pairs meet 3:1. Local test fixtures were
removed; existing data, authorization and credit accounting were preserved.
The final read-only review found no remaining actionable defects within this scope.

## Switchable appearance presets

User-approved extension of the design-system checkpoint: Classic and Glass styles
independent of light/dark/system mode. No content generation or later presets.

- [x] Separate shared tokens and preset CSS; keep the same shadcn controls/pages.
- [x] Provide immediate style selection in Preferences, Account and the showcase.
- [x] Resolve a validated appearance cookie in initial HTML; configure the
      application default with APP_STYLE. Save optional account preferences while
      keeping older profiles and API updates compatible.
- [x] Add opaque Glass fallbacks for reduced transparency and unsupported blur;
      retain readable menus, drawers, focus and feedback.
- [x] Document customization, persistence precedence and a repeatable test loop.
- [x] Verify affected checks and review the final diff.

Verified on 2026-10-05: 35 unit tests and eight production HTTP integration tests
passed, including runtime style defaults, invalid cookies, saved profile style and
older updates preserving it. TypeScript, lint, formatting and production build /
worker passed. Browser checks covered all four preset/color-mode combinations at
1440px/390px, active Glass blur, keyboard switching, reload persistence, account
save/restore, system mode, opaque fallbacks in both modes and mobile navigation.
Glass was also checked on Account, Preferences, Credits and all three admin pages.
Checked text token pairs exceed 4.5:1; control/focus pairs exceed 3:1. This is targeted
browser verification, not a complete assistive-technology audit. Owned account
fixtures were removed. The final read-only review found no actionable defects.

## Source references

Downstream product plans remain outside this Base repository. They do not
authorize copying external data, publishing workflows or deploying services.

- [Base source reviewed at 8678f9d0f60426bf09992e3d4b466bb7e8499d3a](https://github.com/karpishe-experiments/base/tree/8678f9d0f60426bf09992e3d4b466bb7e8499d3a).
- Imported skill source revisions and integrity records are retained in `skills-lock.json`.
- [Next.js authentication](https://nextjs.org/docs/app/guides/authentication), [self-hosting](https://nextjs.org/docs/app/guides/self-hosting), and [PWA guidance](https://nextjs.org/docs/app/guides/progressive-web-apps).
- [shadcn theming](https://ui.shadcn.com/docs/theming).
- [Firebase session cookies](https://firebase.google.com/docs/auth/admin/manage-cookies) and [redirect authentication](https://firebase.google.com/docs/auth/web/redirect-best-practices).
- [Android Trusted Web Activities](https://developer.android.com/develop/ui/views/layout/webapps/trusted-web-activities).

## Soft Blue and Glass page artwork

Accepted scope: add the reference-inspired Soft Blue preset and let Glass use
the loaded page's main image through standard og:image metadata. This is
appearance infrastructure; content models and Dify migration remain separate.

- [x] Add Soft Blue to shared schemas, selector and runtime APP_STYLE configuration.
- [x] Add light/dark cobalt and lavender palettes without changing shadcn controls.
- [x] Observe page cover metadata, validate/load URLs and clean up on changes.
- [x] Keep original Glass gradients for absent/failed covers and protect readability.
- [x] Document the metadata convention and add safe local showcase examples.
- [x] Verify affected checks, desktop/mobile browser flows and read-only review.

Verified on 2026-10-05: 36 unit tests and eight production HTTP integration tests
passed, including Soft Blue cookies/profile persistence and older updates preserving
the saved style. TypeScript, lint, formatting and production build/worker passed.
Browser checks covered Soft Blue light/dark at 1440px/390px, reload persistence,
keyboard switching, Glass covers in both modes, reduced transparency, client
navigation/back, missing/broken covers, streamed metadata, stale-load cancellation,
the ten-second image deadline and mobile navigation. Checked Soft Blue text pairs
exceed 4.5:1. No browser runtime/hydration errors occurred in those flows. The
separate read-only review found no actionable defects. This targeted verification
does not replace the manual accessibility checklist in the design-system guide.

## Richer Glass presentation

Accepted refinement: show more cover color through clearer Glass panels, add
luminous edges/reflections and preserve readability through local reading scrims
and denser forms/tables. Keep Classic/Soft Blue, cover metadata and persistence
behavior intact.

- [x] Reduce canvas wash and panel opacity; strengthen blur, saturation and highlights.
- [x] Protect headings/prose locally and keep forms/tables/fields readable.
- [x] Retain opaque fallbacks and remove blur for reduced transparency.
- [x] Verify desktop/mobile, both modes, cover extremes and the final read-only diff.

Verified on 2026-10-05: TypeScript, lint, formatting and production build/worker
passed. Browser checks covered Glass light/dark at 1440px/390px, real 24px blur,
clear nested appearance options, denser form/table surfaces, opaque reduced-
transparency mode, cover/fallback switching, mobile navigation and dialog/keyboard
behavior. Sixty-four modeled text/surface pairs over black/white cover extremes
had a minimum contrast of 4.55:1. Home, guest Preferences/Account/Credits and
not-found layouts had no horizontal overflow in either mode. No runtime/hydration
errors occurred in the showcase checks. The separate read-only review found no
actionable defects. Protected admin data/mutations were not re-exercised for this
presentation-only refinement; full assistive-technology verification remains manual.

## General AI foundation before content migration

Accepted on 2026-10-05: implement reusable Dify transport, durable owned execution,
credit integration and persistent usage/cost reporting as reusable Base capabilities. Product content schemas remain separate.

The scope, invariants and checkpoints are in [AI foundation](ai-foundation.md).
A1–A4 are implemented and locally verified. The foundation includes workflow/chat/
file adapters, owned durable jobs, managed credit holds, separate exact-cost usage
records, user/admin UI and worker deployment wiring. The linked evidence records
passing build, unit/account/HTTP/browser checks and the separate read-only review.
Live Dify acceptance, deployment and product-content migration remain separate.

## AI pricing extension

Accepted 2026-10-06: retain fixed defaults and add total/split token, provider-cost and hybrid pricing, configured per capability. Save pricing terms, reserve a disclosed maximum, settle actual whole credits atomically, release the remainder and retain uncertain billing for review. Implementation includes current-price consent, ledger boundaries and fake-provider fixtures. Configuration and manual acceptance are in [AI testing](ai-testing.md#configurable-credit-pricing). Live provider acceptance remains separate.

Pricing extension verification (2026-10-06): production build, typecheck, lint,
environment validation, 43 unit tests, 62 account/provider tests and eight deployment
configuration tests passed. Production HTTP checks passed for variable pricing,
legacy AI flows and Stripe fixtures. Browser checks passed at 1440px/390px for
pricing disclosure, keyboard submission, actual charge and detail rendering,
without runtime/hydration errors or horizontal overflow. A separate read-only
review of the pricing diff found no remaining actionable defects. The implemented
surfaces matched the planned configuration, job, settlement and UI scope; no new
provider calls or product schemas were added. Live Dify acceptance remains unverified.

## Base documentation and acceptance handoff

On 2026-10-06 the maintained guides were reconciled against implementation and
made product-neutral for Base. Setup, architecture, workers, managed holds and
pricing descriptions now agree. [The full test plan](test-plan.md) owns the local
acceptance sequence, all pricing cases and a results sheet. Source/product migration plans remain outside this repository; this documentation
pass does not rename code, create a repository or mark external acceptance passed.

Documentation verification checked local links, heading anchors, npm command
names, naming boundaries and imported-skill integrity. A separate read-only review
corrected stale scope and setup statements. Runtime tests were not rerun for this
documentation-only pass; earlier dated evidence remains historical. M5 and live
provider/deployment/Android checks keep their existing incomplete status until
those acceptance steps are performed.

## Review fixes and administrator operations

Accepted 2026-10-06: shared session invalidation across protected pages; managed
hold maintenance isolation; all supported APP_STYLE deployment presets; worker
heartbeats and release probes; paginated AI history, queue age and unresolved
counts; administrator-led AI/payment recovery; manual local-only cleanup with
preview, confirmation, bounded options and durable reports. Provider deletion,
automatic retention schedules and user-controlled deletion are outside this scope.

Implemented in the existing application, workers and admin pages. Cleanup preserves
billing, usage, audit and idempotency evidence, excludes uncertain work and rechecks
each preview target under an administrator transaction. Manual payment review uses
the existing verified Stripe reconciliation path. Current setup and procedures are
in [administrator operations](ai-testing.md#administrator-operations).

Verification on 2026-10-06: production build and worker bundles, TypeScript, lint,
formatting, 44 unit tests, 70 account/provider tests and 25 deployment tests passed.
Production HTTP checks passed for AI operations/legacy flows, variable pricing and
Stripe fixtures. Browser checks passed for a two-record preview/confirmed cleanup,
25+3 history pagination, cross-tab logout, switching between two emulator users,
browser Back after logout, simulated persisted-page restoration and no horizontal
overflow at 1440px/390px. Fixtures used disposable MongoDB and local Auth emulator;
no live provider or deployment was exercised. Separate read-only review covered
access fences, retry evidence, terminal cleanup eligibility, worker rollout and
current documentation. The selected scope and implemented surfaces match. Existing
live Dify/Stripe, VPS and Android acceptance remain separate pending checkpoints.

## Retired creation workspace extension

The former creation-workspace platform was superseded by the accepted Runs
replacement on 2026-10-10. Its routes, authoring, approvals, comparison, quality
scheduling, repair and PDF/ZIP export implementation/tests are removed. No legacy
compatibility, automatic data deletion or deployed-data migration is required.
Historical workspace acceptance counts do not describe the current tree.

## Accepted extension: reusable MCP tools

2026-10-08: Implemented optional `/api/mcp` for trusted service clients, using
stateless Streamable HTTP, per-client credentials/permissions, and code-registered
read-only examples. Includes tests and [maintenance/Dify guidance](mcp.md).
Private-user tools, writes, OAuth consent, catalog administration and deployment
remain outside this extension. Local verification passed: five MCP test groups
(official-client HTTP discovery/calls, permission isolation, rotation, protocol
compatibility, bounds, cancellation and log redaction), unit/account regressions,
typecheck, lint, formatting, configuration/skill checks and production build.
A built Next server also passed authenticated discovery/calls and safe logging
against isolated MongoDB. Separate read-only review corrected MCP error-outcome
logging and rechecked the affected surface. Live Dify callback acceptance remains
pending a reachable URL and external client setup; no deployment was performed.

## Clone-readiness audit — 2026-10-10

The base is ready for a derived project's **local implementation**, subject to
including this reviewed working-tree diff in a commit before cloning. Evidence
below covers `e4731d5` plus the readiness changes; it is not a deployment or
live-provider acceptance claim. Existing milestone/external limits still apply.

The audit reviewed pages, navigation, account/preferences separation, public
configuration, session/ownership boundaries, workers, packaging, PWA behavior,
setup and canonical documentation. Corrections include all worker entry points
in Docker's context, PDFKit's CommonJS dependency closure in standalone output,
runtime application branding in metadata/install manifest, a generated favicon,
generic offline copy and a discoverable admin execution-profile link. The
[derived-project checklist](../README.md#start-a-derived-project) inventories
retained internal identifiers and explains data/credential/resource isolation.

| Verification                 | Recorded result                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh tracked-source fixture | Fresh `npm ci --offline`, environment/skill checks, production build and typecheck passed without copying local env, database data or existing node_modules. The offline install does not establish registry audit status.                                                                                                                                                               |
| Source/build quality         | Production web/worker build, typecheck, lint and formatting passed; 51 unit tests and 136 account/provider/workspace/MCP tests passed.                                                                                                                                                                                                                                                   |
| HTTP/worker regressions      | Account/session 9 passed, payment simulation 3 passed, AI/workspace/export 6 passed with 1 mode skip, pricing 4 passed with 3 mode skips. Health tests passed unavailable-dependency, credential/project mismatch and recovery boundaries. Final packaging changes were followed by build/typecheck and AI/export regression.                                                            |
| Deployment tooling           | 26 deployment tests, shell checks and actionlint passed. Docker built from the allowlisted context; an unmodified non-root runtime passed PDF/font rendering, worker presence, development-tool/env exclusion, liveness 200, readiness 503 for deliberately unavailable dependencies, and public-route checks.                                                                           |
| Browser/PWA                  | Twelve public/member/admin routes exercised at desktop and 390px; avatar/mobile navigation, keyboard focus/Escape, styles/themes, diagnostics and anonymous action visibility passed without normal-navigation console errors or horizontal overflow. Offline cache contained only the public fallback; offline account navigation exposed no profile data and reconnected successfully. |
| Dependency advisory          | Registry audit reported 35 aggregate advisories: 27 high, 8 moderate, 0 critical. These include development tooling and transitive provider dependencies; no forced major downgrade or audit suppression was applied. Review affected dependency paths before staging/release.                                                                                                           |

The separate final read-only review passed after checking the complete diff,
compatibility, documentation and current evidence; no further actionable defect
was identified in this change. Scope comparison is matched for local clone
setup, reusable pages/features, runtime packaging and documentation; live services
remain deliberately unverified. Local artifacts are ignored under `output/` and
are not part of a clone. No commit, publication or deployment was performed.

Before production acceptance, use new owned resources to verify Firebase/Atlas,
Stripe sandbox, Dify/image execution and optional S3 storage; exercise actual VPS
deployment/rollback and Android signing, Digital Asset Links, device installation
and publishing. A derived product's new schemas, prompts, integrations and renamed
infrastructure require their own tests. This audit does not complete those checks
or the pending milestone acceptance.

## Accepted replacement: Dify orchestrator Runs - 2026-10-10

The user authorized complete replacement with self-hosted Dify 1.17.1 Workflow
orchestrators. One logical owned Run has ordered attempts. Administrators select
available orchestrators, manage sanitized DSL and configure revisioned runtime
settings/credits. Users start, reopen, answer validated generated UI, inspect
progress/results and restart or recover compatible stages. The existing durable
AI queue, credit ledger, MCP and private-media adapters are reused.

Implementation surfaces: Base settings and orchestrator administration; pinned
Service/Console API adapters; saved attempts/events/decision intents; registered
Runs cards and owned media; three Runs pages; recovery/diagnostic entry points;
obsolete source/dependency removal; worker/index/package and setup documentation.
The detailed contracts and operational boundaries are in [Runs](runs.md) and
[AI testing](ai-testing.md). Repository templates live in `dify/`.

Local implementation and read-only review completed on 2026-10-11. Verified:

- 51 pure unit tests and 82 account/provider/worker tests passed. The full account
  suite was rerun with two test processes after concurrent Mongo fixtures exceeded
  their startup deadlines under build load.
- Runs HTTP acceptance passed using real bundled workers and disposable databases,
  including concurrent decisions, lost-response reconciliation, recovery, immutable
  pricing, ownership and admin settings revisions.
- Account/session HTTP: 9 passed. Payment HTTP: 3 passed. Health/readiness checks and
  25 isolated deployment-tool tests passed.
- Production web/worker builds, typecheck, lint, formatting, environment and pinned
  skill integrity checks passed. Obsolete routes, worker/export packaging, indexes,
  environment bindings, tests, fonts and dependencies were removed.
- Docker built from the allowlisted context. Non-root runtime smoke verified worker
  presence, development-tool/environment exclusion, image normalization, liveness,
  unavailable-dependency readiness and public assets. DSL download packaging was
  subsequently removed with graph setup tools.
- Playwright verified desktop/mobile navigation, generated decisions, continuation,
  reload, stage recovery, attempt history, administration, keyboard/Escape handling
  and layout. No browser console errors or horizontal overflow were observed.

Read-only review comparison: matched for administration, durable Runs, private
results, decision/recovery boundaries, credit policies, removals and documentation.
Pinned API fixtures and example DSL do not prove a deployment's plugin bindings.
Live Dify acceptance remains pending: no disposable configured 1.17.1 instance was
supplied. Real management, MCP, child-question and image/checkpoint flows must be
exercised there before claiming live-provider acceptance. See [AI testing](ai-testing.md).
No local database was deleted. No commit, publication, deployment or production
service mutation was performed.

Local startup follow-up (2026-10-11): the retained development settings record
predated the upload quota fields. Those fields now default to the original limits
when absent, preserving saved prices and policies without rewriting the record.
Eight targeted Runs/settings tests, worker bundling and TypeScript checks passed;
the read-only review found no further defect in this correction. Local MongoDB,
Firebase Auth/UI, web and AI/payment workers were started; readiness returned 200
and both current worker heartbeats reported `ok`. Dify remains the configured remote
connection; orchestrator registration/availability still requires Administration.

Orchestrator simplification (2026-10-11): Administration offers Create orchestrator
and Register an existing published Workflow. Create imports/publishes a new minimal
MCP/Human Input/Code starter and registers it; existing graphs stay authored in Dify.
Unibase checks the publication, API key, supported inputs, Human Input WebApp
configuration and referenced MCP tools, then enables it. Registration never edits
nodes/inputs, imports or publishes. The previous setup/publish/adapter services,
manual-save contract and DSL routes were deleted. Native outputs normalize on the
Unibase server. Local Run attempts map to provider task/Run IDs; zero-input and
inline-prompt execution is supported. Users retain owned status, node-event tracing
and Generative UI submission/reconnection. Connected MCP providers can expose
permission-checked read/write tools; the included Unibase catalog stays read-only
until a specific save operation and ownership model are defined. Existing records,
accepted snapshots, billing and runtime history remain compatible.
The new starter's live MCP/Human Input execution and a local owned Unibase HTTP Run
passed. Broader provider/plugin acceptance remains pending. The starter and a separate
MCP provider were created with session authorization; no commit or deployment occurred.

Cleanup verification: production web/worker builds, typecheck, lint and 52 pure
contract tests passed. The 101 account/provider checks cover authorization,
encryption, read-only registration, Human Input/MCP metadata, native outputs and
existing durable billing/history. Owned HTTP execution verifies zero graph updates
and publications, zero-input Runs, native provider IDs and saved node tracing.
The broader Runs HTTP regression passed. Browser checks verified Create navigation,
formless registration/reload, native output, tracing/timing, desktop/mobile and
keyboard navigation without console/page errors. Separate read-only review found
no remaining actionable defect in that cleanup. The subsequent Create correction
adds a ready-to-run starter, durable import intent, draft-change protection and
retry deduplication. It adds no user-data MCP save operation. The starter sends
no initial prompt/Run/attempt/recovery fields, fetches synthetic MCP JSON, requests
Brief/Detailed via Generative UI and returns the selected summary. Reconnect now
consumes resumed node events after historical pauses. Create requires import and
publish permissions; Register retains read-only workflow checks.

Starter verification: 52 pure and 113 account/provider tests passed, along with
production web/worker builds, typecheck/lint and owned HTTP Create/Register/Run
acceptance. Browser checks verified formless creation, Ready after reload,
desktop/mobile layouts, focus and the live result. The real starter completed
through Unibase with Generative UI, MCP document content, every node in tracing
and one-credit billing. Complete terminal tracing reads bounded Console node
metadata when event snapshots omit history. The authorized temporary MCP-only
tunnel must stay running for local Dify callbacks. Read-only review found no
remaining actionable defect; broader live plugin/recovery acceptance is pending.

Orchestrator lifecycle correction (2026-10-12): Admin retains missing Dify apps
as Unavailable with Delete registration. Disable blocks new Runs; Enable rechecks
registration; Unregister removes the registration from Run choices while retaining
accepted configurations, credentials, results and history. Provider catalogs are
complete before reconciliation, and stale snapshots cannot invalidate newer
registrations. Provider outages preserve saved entries for administration. Fresh
admission checks Dify before credits; a transaction guard and registration fencing
prevent concurrent disable/unregister from being undone. No Dify apps/keys are
deleted or recreated by these actions. The actual deleted starter was reconciled
as unavailable. Production web/worker builds, typecheck/lint, 52 pure and 119
account/provider tests passed. Desktop/mobile browser checks passed for Register,
Disable, Enable, Unregister, Delete registration, reload and focus. Owned HTTP
lifecycle acceptance passed without losing history or reserving new credits for
unavailable registrations. A separate read-only review found no remaining
actionable defect. Broader live provider acceptance remains as previously scoped.

Creation/publication correction (2026-10-12): Create immediately displays the
confirmed starter and refreshes the Dify app catalog automatically. New starters
disable the public Dify Web App while retaining Service API access and the Human
Input node's WebApp delivery method for form tokens. Register validates the saved
draft and publishes it when new or changed, superseding the earlier read-only
registration contract. Unchanged publications are reused; concurrent draft changes
and publication failures prevent enablement. Registration does not edit nodes or
inputs. Account/provider verification covers these boundaries (121 tests); owned
HTTP acceptance completes the starter's human interaction with its public site off.
Production web/worker builds, typecheck and lint passed. Browser checks verified
automatic appearance after Create, reload, mobile layout and keyboard focus.
The broader Runs HTTP regression passed. A separate read-only review found no
remaining actionable defect; no live Dify apps were changed by these checks.

Deleted Create retry correction (2026-10-12): Saved creation attempts now check
their confirmed app before updating settings. Dify's app-not-found response clears
the browser retry key and requests a fresh explicit Create, while temporary and
unknown failures retain retry protection. Read-only live checks confirmed the
reported retry referenced a deleted app. Targeted account/Console tests, build,
typecheck/lint and browser retry/reload checks passed. No live app was recreated.

Authentication usability correction (2026-10-12): The shared recent-sign-in
window is 30 minutes instead of five for session exchange and administrative
changes. The five-day session lifetime, current role/access checks, CSRF and
future-timestamp checks remain unchanged. Admin help text and test instructions
match the new window. All 52 pure and 122 account/provider tests, production
web/worker build, typecheck and lint passed. Separate read-only review found no
actionable defect.

Template catalog correction (2026-10-12): Admin Create is a shadcn dropdown for
Document summary, Catalog picker and Quote approval. Server-only JSON DSL files
live under `src/lib/server/runs/templates`; only metadata reaches the client.
Each journal binds its template ID and each browser template retains a separate
retry key. Legacy creation requests/journals default to Document summary. Required
MCP tools are checked before import; selected workflows keep automatic publication,
API keys, site disabling and catalog refresh. The original code template was removed.
New bounded synthetic catalog and quote MCP methods require explicit `demo:read`;
no orders, payments or user records are written. Local Dify client permissions and
its dedicated starter tool catalog were refreshed; both new local MCP calls passed.
All 52 pure and 124 account/provider tests, production web/worker build, typecheck,
lint, owned HTTP template creation and broader Runs regression passed. Embedded
Python passed both choices in each scenario with real tool output and Unibase's
answer-object format. Desktop/mobile browser checks covered all three creations,
reload, keyboard/menu focus and corrected mobile action wrapping. Separate read-only
review found no remaining actionable defect. Full new-template Runs on live Dify
remain installation-specific acceptance; its reachable MCP and code sandbox are required.

## Accepted extension: personas, Run-scoped MCP and persistent artifacts - 2026-10-12

The accepted plan adds administrator-owned personas, a User/persona Start choice,
noninteractive Dify responders on the existing worker, combined managed credit
admission/settlement, private callback capabilities, durable product references and
a generic saved-artifact sample. Booklet models, story prompts and long-term user
memory remain downstream scope. Existing Runs default to User and existing public
MCP tools retain their grants/contracts.

Local implementation and a separate read-only review completed on 2026-10-12.
The final diff includes persona administration/selection, immutable responder
snapshots, durable automatic decisions/takeover, combined billing with separately
attributed fees, private MCP capabilities and artifact saves/approvals, retained
MongoDB/S3 assets, result-application retries, sample templates and owned pages.
Existing Runs remain compatible; no separate application or worker was introduced.

Verified locally:

- Production Next.js and all worker bundles build successfully. Typecheck, lint,
  environment and pinned-skill checks pass; 52 pure tests and all 136
  account/provider tests pass. The latest fee/usage and deletion-boundary changes
  were included in the final complete account/provider run.
  The final dispatch and fallback-message corrections were followed by all 33
  affected worker/Run/persona tests, typecheck and another production build.
- Runs HTTP acceptance passes with the bundled worker and disposable database,
  including decisions, history, recovery, settings and exactly-once billing.
  Readiness fails safely after the test database stops while liveness remains up.
- New integration coverage exercises automatic answers without a browser,
  takeover, invalid/file/limit fallback, known pre-dispatch configuration failure,
  uncertain dispatch and missing usage, audited child waiver, capability scope,
  duplicate/conflicting writes, revision/human-source approval checks, application
  retries and asset retention. A loopback S3-compatible fixture verifies private
  object retention through history cleanup and exact final deletion.
  Additive index setup passed against a disposable replica set. Anonymous artifact
  pages returned Next.js streamed redirects to Account without server errors.
- Playwright against isolated accounts demonstrates persona creation/editing,
  archival, Start selection/maxima, automatic charge/source history, human takeover
  and continuation, artifact draft approval/image/reload/deletion, settled-fee
  displays, anonymous redirect, keyboard controls and desktop/mobile layouts.
  Final exercised navigation has no console/hydration errors or page overflow.
- The separate read-only review found and corrected retry-identity, responder
  acceptance/usage, terminal callback and asset-deletion lifecycle boundaries.
  Responder dispatch now fences the parent's active reservation, execution and
  still-pending decision in the same transaction, preventing new paid work after
  reversal, takeover or an already submitted answer.
  Re-review of those corrections found no further actionable defect.

Advisory limits: formatting reports the unchanged
`src/components/admin-user-controls.tsx`. Docker/deployment and ShellCheck checks
could not access the local Docker daemon; actionlint was unavailable; the registry
audit endpoint was unreachable. These are reported warnings, not build failures.
Live Dify model/plugin/private-MCP binding, real S3 and VPS/Android acceptance
remain installation-specific. No live provider mutation, commit, publication or
deployment was performed. Run additive index setup and configure the new provider
permissions/settings as documented in README before using them in a derived app.

### Persona administration follow-up - 2026-10-12

- [x] Show persona cards with state/responder summaries and Add/Edit dialogs.
- [x] Make change reasons optional across admin settings, personas, accounts,
  credit adjustments, cleanup, payment review and AI reconciliation; preserve
  authorization, revisions, confirmation, length bounds and atomic audits.

Verification: 53 pure tests and 136 account tests passed, as did type checking,
lint, formatting and the production web/worker build. Playwright on a disposable
emulator account/database verified cancellation, blank-reason creation/editing,
persistence after reload, dialog focus restoration and 390px mobile layouts with
no console/hydration errors. The separate read-only review found no further
actionable defect after correcting empty Add-form initialization. Existing
deployment/tooling and registry-audit availability warnings remain advisory.

### Saved-artifact live compatibility and diagnostics - 2026-10-12

- [x] Return `draftText` from the private artifact read tool instead of Dify's
  reserved top-level `text` output; refresh the existing Dify MCP tool catalog.
- [x] Persist fixed, safe provider failure summaries and show explicit fallbacks
  for historical failures; terminal Runs no longer display a waiting trace message.
- [x] Normalize omitted persona summary/issue acknowledgements to null while
  retaining validation for supplied values, choices, fields and offered actions.
- [x] Rebuild and restart the local worker so persona execution and product image
  application use the current implementation.
- [ ] Complete live persona approval and takeover acceptance through a healthy
  MCP connection. The existing temporary tunnel repeatedly disconnected over
  QUIC and subsequently reported that its tunnel no longer exists. The user
  authorized replacement with an MCP-only HTTP/2 tunnel. Global and US-region
  attempts failed Cloudflare's TCP connectivity checks: outbound tunnel access
  on port 7844 is blocked or unreachable. Dify's URL remains unchanged until a
  healthy connection exists; live acceptance awaits network access or an existing
  reachable MCP endpoint.

Verification: 53 pure tests, 139 account/provider tests (with test concurrency
bounded to two) and the Runs HTTP regression pass. Typecheck, lint, configuration,
pinned-skill integrity and production web/worker builds pass. An unconstrained
account run during a concurrent build hit local Mongo fixture startup deadlines;
the bounded-concurrency rerun passed all tests. HTTP acceptance verifies retained
diagnostics, historical fallback and partial-result compatibility.

Live human approval, decline, cancellation, correct credits and saved image
application passed using isolated local emulator accounts. The live persona model
returns an answer accepted by the corrected summary contract. Browser checks
verify the approved revision/image after reload, desktop/mobile layouts, keyboard
focus, no overflow/errors, and the terminal empty-trace display. Full live persona
and takeover flows remain unverified because of the external MCP tunnel failure;
the new diagnostics identify that failure and failed attempts charge zero.
The separate read-only source review found no further actionable code defect.
No application commit, publication or deployment was performed.

Tool-service diagnostic follow-up: the fixed-message classifier recognizes Dify
tool-service HTTP 502/503/504 errors without exposing raw provider text. All 13
affected Dify tests, typecheck, lint and production web/worker build pass. Local
web/proxy discovery returned 200 while the configured expired tunnel still
reported Tunnel not found; remote MCP connectivity remains unresolved.
