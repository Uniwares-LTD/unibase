# Admin and credits implementation

Accepted contract: the six-checkpoint plan agreed on 2026-10-04. Preserve the
single Next.js application, Firebase identities, MongoDB and shadcn primitives.
The original milestone excluded provider activation, publication, deployment and
iOS work; later session authorization and the current implementation plan govern new work.

Current status: C1-C5 are implemented and locally verified; C6 is unimplemented.
AI consumption and variable pricing are part of [orchestrator Runs](runs.md).
Historical checkpoint evidence below does not replace a new [full regression](test-plan.md).

## Checkpoints

- [x] C1: Server-owned member/admin roles and active/suspended state; immediate
      authorization checks; first-admin operator command; Firebase user listing and
      exact email/UID search; profile edit, access and role controls; recent login,
      confirmation and reason; self/last-active-admin safeguards; atomic immutable audit.
- [x] C2: Zero-default integer wallets, lots, immutable ledger and idempotent
      reserve/commit/release. Transactions use replica sets locally and in tests.
      Purchased credits never expire; promotional grants default to 90 days and can
      explicitly override expiry. Spend earliest-expiring lots first, then oldest
      perpetual lots. Ordinary holds last 15 minutes and honor eligibility at reservation time;
      released/timed-out expired credits cannot return to available balance. Only
      purchase reversals create debt; debt blocks new spending.
- [x] C3: User balance/holds/debt/expiry/history; admin grants and deductions with
      reasons; configured pack catalog; clearly labelled 100/500/1000 local fixture
      packs; local-only simulated success/pending/failure/cancellation/refund/replay.
      No arbitrary client spending endpoint or invented paid product action.
- [x] C4: Admin dashboard and runtime/audit reports with pagination and filters.
      Store all structured application successes/failures using allowlisted fields,
      never raw bodies/messages/stacks/tokens/query strings. Runtime retention 30 days;
      ledger/admin audit do not expire. Operational logging is bounded best-effort
      with stdout fallback; accounting and administrative audit are transactional.
- [x] C5 implementation/local verification: Configured Stripe one-time Checkout packs; UID-bound orders with terms
      snapshots; raw-body signature verification and durable notification inbox;
      exactly-once accounting; proportional cumulative refunds rounded down to whole
      credits; disputes reverse the grant and wins restore only outstanding entitlement.
      Recover unused credits then record debt; cancel affected holds. Same-image
      maintenance worker with MongoDB jobs and no Redis. Live billing disabled by default.
- [ ] C6: Google Play consumables via Android TWA Digital Goods/Payment Request;
      server package/product/state/account verification; unique purchase-token ownership;
      durable grant before consume/acknowledge; retries and reversal notifications;
      no Stripe fallback inside Play wrapper; supported resolved Billing SDK and actual
      signed-build/internal-track acceptance. Existing Android dependency-download
      blocker remains a prerequisite, not a successful device check.

## Verified checkpoint evidence

C1 passed local acceptance on 2026-10-04: final production build, TypeScript and
lint pass; all 21 existing unit tests, the transactional access test and all four
production-server HTTP integration tests pass. The access test covers competing
admin removals, stale actor permissions, suspension/reactivation cutoff and rollback
when required audit insertion fails. HTTP tests use real emulator sessions to prove
member/anonymous denial, immediate demotion and rejection of old cookies/ID tokens
after reactivation. The explicit bootstrap command passed with a verified synthetic
UID. Browser checks passed exact search, cancel/confirm behavior, profile/role reload
persistence, dialog focus and 390px layouts. Only the pre-existing favicon 404 was
observed; no hydration failure appeared in these flows. Owned browser fixtures were
removed and all six pre-existing local profiles retained. A separate read-only review
corrected the admin-read suspension recheck and found no remaining C1 defects.

C2 passed local acceptance on 2026-10-04. The production build, TypeScript and
lint pass; all 21 existing unit tests, 13 account/credit test cases and four HTTP
integration tests pass. Credit tests use an owned replica set and prove zero
defaults, whole-number validation, parallel duplicate grants, request-key
conflicts, competing holds, cross-user isolation, one-time commit, expiry ordering,
15-minute timeout, commit after lot expiry, no resurrection on release, 90-day
defaults, reversal debt, debt repayment/restoration, authorization cutoffs,
deduction limits, numeric overflow and full rollback of failed required ledger
or admin audit writes. Ledger totals and lot projections reconcile in each case.
The index command passed against the configured local database without changing
existing balances. A separate read-only accounting review found no remaining C2
defects. No wallet UI or public spending action is part of C2.

C3 passed local acceptance on 2026-10-04. The production build, TypeScript and
lint pass. All 23 unit tests, 19 account/credit test cases and five production
HTTP integration tests pass. New cases prove local-only configuration, owned
orders, snapshotted quantities, competing success/cancellation outcomes,
mandatory order-state rollback, one-time grants/refunds/replay and stable history
pagination. HTTP reads reject anonymous/unverified/suspended sessions and cannot
select another wallet using a supplied UID. Browser checks passed all fixture
pack sizes, pending/failure/cancellation, success/refund/replay, admin cancel/
confirm and initial cancel focus, default/custom UTC/perpetual grants, deduction
and reload persistence, active holds, refund debt and debt repayment, desktop and
390px layouts without viewport overflow, and cross-tab logout clearing the wallet.
Four mandatory adjustment audits were verified. Owned test accounts and financial
fixtures were removed; all six pre-existing profiles remain. The only browser
error observed was the pre-existing favicon 404. A separate read-only review found
no remaining in-scope defects. See [local testing](admin-credits-testing.md).

C4 passed local acceptance on 2026-10-04. Production build, TypeScript and lint
pass; 26 unit cases, 20 account/credit cases and six production HTTP integration
tests pass. Tests prove allowlisted storage, bounded queue/deadlines, 30-day runtime
retention, permanent audit, stable pagination at equal timestamps, UTC date and
event/severity/request/actor/target filters, safe invalid filters and immediate
demotion. HTTP tests verify post-response persistence without query/body/identity
leaks. Browser checks passed 25/15-row pagination, keyboard focus, 390px layout,
successful adjustment audit, failed adjustment without audit, sanitized runtime
events and safe malformed-filter recovery. No hydration error was observed; the
existing favicon 404 remains. A separate read-only review found no remaining
in-scope defects. Owned fixtures were removed and all six existing profiles remain.

C5 implementation passed local verification on 2026-10-04: production and final
Docker builds, TypeScript, lint, formatting and environment checks pass. All 29
unit cases, 28 account/credit cases, six existing HTTP integration tests, three
payment HTTP tests and 21 isolated deployment tests pass. Checkout fixture tests
verify snapshotted terms and stable provider idempotency. Accounting cases cover
duplicate delivery, cumulative refund rounding, pending-refund exclusion, dispute
restoration, cancelled holds/debt, lease fencing/recovery and mandatory projection
rollback. Signed HTTP fixtures verify raw-body signatures, stale/tampered/wrong-mode
notifications, payload limits, allowlisted durable inbox, anonymous/CSRF denial and
the verified-member purchase page without private configuration. The actual bundled
worker runs against an owned disposable database. The final network-isolated image
smoke check verifies non-root execution, absence of admin tooling/env files and safe
failure when MongoDB is unavailable. Browser acceptance covers desktop/390px,
keyboard focus, hydration and persistent Play routing without Stripe fallback;
only the existing favicon 404 remained after correcting the test server's static
asset preparation. Owned synthetic identities/processes were removed. A separate
read-only payment review found no remaining in-scope defects. See [payments](payments.md).

**External acceptance is still pending:** Stripe sandbox/live Checkout and
configured notification/worker operation have not been exercised with real provider
resources. The C5 checkbox records implemented and locally verified code, not live
billing activation. C6 remains unimplemented. Fixture tests do not establish live
provider or signed-device acceptance.

The 2026-10-04 C6 prerequisite review found that the then-current official Android Browser Helper
MethodData/PlayBillingWrapper source does not pass an obfuscated account identifier.
Its upstream account-binding request was open at that review; recheck before C6. A decision is pending between
waiting for upstream support and maintaining a custom Android billing bridge.
Play is disabled; purchase-token possession alone must not authorize user ownership.
The renewed official Billing/AGP endpoint probes failed TLS handshakes on this
machine, so supported resolved dependencies and a signed build remain unverified.
See [the prerequisite](payments.md#play-prerequisite).

## Boundaries and acceptance

Server Components read server modules directly; web admin mutations are Server
Actions with fresh authorization/origin protection. HTTP contracts cover own-wallet
reads, checkout and authenticated Stripe notifications. Play verification remains
a planned C6 contract, not an implemented route.
Secrets and catalog mappings are validated server configuration. The initial
UID-appointment-only rule was superseded by the verified one-time first-admin
initializer. Current [administrator access](architecture.md#administrator-access)
allows verified `admin@uniwares.co.uk` only while no admin/marker exists; explicit
UID bootstrap remains available. No password or automatic credits are shipped.

Existing users start active/member with zero credits. No transfers, cash withdrawal,
subscriptions, automatic signup grant, hard account deletion or impersonation.
Provider consoles initiate refunds initially. Apple/iOS is a future plan; the
shared wallet preserves source identifiers and non-expiring paid credits.

Verify anonymous/member/admin boundaries, instant demotion/suspension, last-admin
races, cross-user isolation, rollback, idempotency collisions, concurrent holds,
expiry, debt, proportional refunds/dispute restoration, webhook reordering and
crash recovery. UI verification covers desktop/mobile, keyboard and hydration.
Provider fixtures and local simulation are separate from live provider/device
acceptance. Quality remains advisory; build/operational failures remain failures.

Update README setup, architecture and implementation-plan state after verified
checkpoints. Use a separate read-only review. Do not claim completion from fixture
tests when the corresponding live acceptance remains unverified.

## Intended result after all checkpoints

This section includes the unimplemented C6 outcome; it is not current acceptance evidence.

Administrators have a small dashboard, user/profile/access management and
paginated runtime/audit reports. Users have a shared web/Android credit wallet,
expiry and hold visibility, and immutable transaction history. Operators can grant
or deduct credits with reasons and permanent audits. Verified Stripe web payments
and Google Play Android consumables fund the same wallet, with duplicate-safe
delivery, refunds, dispute restoration, debt and retry recovery. A MongoDB-backed
worker performs maintenance in the existing deployment image. Real provider and
signed-device acceptance still require configured identities, credentials and
explicit external activation; local simulation does not establish them.
