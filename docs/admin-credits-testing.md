# Local admin and credits testing

Use local emulators, never production accounts or Atlas for these checks. The
checkpoint state is in [the plan](admin-credits-plan.md); [README](../README.md)
owns setup. Real Stripe/Play payments remain separate acceptance.

For the complete current regression, including AI spending and pricing, use
[the full test plan](test-plan.md). No default admin username/password is shipped;
use credentials you create in the emulator, then appoint that exact Firebase UID.

## Start and appoint an admin

1. Copy `.env.example` to `.env.local` if you have not configured local development.
   Keep `APP_ENV=local`, `AUTH_MODE=emulator`, the demo Firebase project and local
   MongoDB settings. Leave `PAYMENTS_MODE` unset for local fixture simulation.
2. Run `npm run emulators:auth`, `npm run emulators:mongo` and `npm run dev` in
   separate terminals. Reuse running services. MongoDB must be the replica-set
   runner; stop an old standalone runner before restarting it. Preserve its data.
3. Run `npm run db:indexes`. It installs indexes without changing balances.
4. Register and verify two test accounts at `http://localhost:3000/account`.
   Google emulator accounts can also be used. Obtain the intended admin's exact
   UID from the Auth Emulator UI at `http://127.0.0.1:4000`.
5. Run `npm run admin:bootstrap -- FIREBASE_UID` once. Existing admins appoint
   further admins through user management. Sign in as the admin to see its link.

## User management and adjustments

1. Sign in as a member. `/admin` must be inaccessible and `/api/admin/users` must
   return 403. An anonymous request returns 401.
2. Sign in as admin, open `/admin/users`, search the member by exact email or UID
   and open its account. Profile/access changes require a reason and confirmation.
3. In Credit adjustment, enter 25, choose Grant promotional credits, keep the
   default 90 days and enter a non-secret reason. Open Review, then Cancel: the
   balance/history must remain unchanged. Repeat and confirm: reload to see the
   grant, reason and upcoming expiry. Reasons are visible to the account owner.
4. Deduct 10 with a new reason. Confirm and reload: only available credits may be
   deducted. A deduction larger than available balance must fail without changes.
5. Try a grant with No expiry, then one with a future Specific date in UTC. Verify
   that only expiring available grants appear in Upcoming expiry. A past date is
   rejected. Choose a time several minutes ahead for a manual expiry check.
6. After 30 minutes, adjustments require signing in again. Removing your own
   admin access is rejected. Suspend the member: its existing session is denied.
   Reactivate it: it must sign in again; old cookies cannot revive the session.
7. Sign in as the member and open Credits: only its own grants/deductions appear.
   At 390px, check layout, keyboard controls and dialog focus. Sign out in another
   tab: the protected wallet/admin tab must return to the account page.

## Purchase simulation

1. Open `/credits` as a verified member. New wallets start at zero. Local purchase
   simulation is clearly labelled and charges no money.
2. Create a 100-credit simulated purchase. Keep pending: no credit grant. Choose
   Success: exactly 100 credits are granted, without expiry.
3. Replay success repeatedly and reload: the balance and ledger must not gain a
   second grant. Refund all: the purchased credits are reversed once. Replay the
   old success again: refunded credits must not return.
4. Create separate purchases with Failure and Cancel outcomes: neither grants
   credits. Closed outcomes cannot subsequently become successful.
5. Repeat with the 500 and 1000 fixture packs. Verify pack quantities are selected
   on the server, history survives reload and debt is covered before new credits
   become available.
6. Set `PAYMENTS_MODE=disabled` in `.env.local` and restart the app: simulation
   disappears. Simulation configuration is rejected outside local emulator mode.
   Do not enable real billing as part of these checks.

There is no arbitrary public grant/spend endpoint. The implemented `/runs/new` page
spends server-priced credits; use [AI acceptance](ai-testing.md)
to test consumption and refund-after-spend debt manually. Ordinary holds have a
15-minute timeout; managed AI holds await settlement or audited resolution.
Concurrency, expiry and failure rollback also have automated coverage.

## Dashboard and reports

1. As admin, open `/admin`. Counts distinguish application profiles from Firebase
   identities, and label errors/audit changes as the last 24 hours.
2. Open `/admin/reports`. Runtime events include successful and failed application
   operations. Filter by event, severity, request ID and UTC dates. With more than
   25 matches, Older records advances and Latest records returns to the beginning.
3. Perform a successful grant and an excessive deduction from user management.
   Runtime reports show a success and a warning. Admin audit shows only the
   successful adjustment, its reason and before/after balances. Filter audit by
   the target UID, actor UID or event. Reasons must not appear in runtime logs.
4. Open `/admin/reports?from=invalid`: the page shows a safe filter error. Clear
   filters to recover. Check keyboard selectors and 390px layout without viewport
   overflow. Member and anonymous `/api/admin/reports` requests return 403/401.
5. Runtime records expire after 30 days; audit and ledger remain permanent.
   The automated tests verify retention/index rules and bounded logging failures
   without stopping your development services.

## Automated checks

Stripe's signed fixture tests and real-provider acceptance are described in
[payments](payments.md). `npm run test:payments` needs the local Auth Emulator and
starts an owned production server/database; it never contacts Stripe. It also
verifies the bundled maintenance entry with provider delivery disabled.

```sh
npm test
npm run test:accounts
npm run typecheck
npm run lint
npm run check:env
npm run build
npm run test:integration
```

The account/credit tests own disposable replica sets and test concurrent holds,
duplicate requests, expiry, debt, rollback and ledger/projection reconciliation.
Integration needs the local Auth Emulator and starts its own disposable database
and production server. It verifies session/ownership/HTTP boundaries. Neither
suite uses live payment providers. `npm run validate` collects advisory results;
compilation and operational failures remain failures. Preserve real outcomes when
recording acceptance, and distinguish fixture coverage from live provider/device
checks.
