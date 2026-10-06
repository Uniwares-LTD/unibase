# Credit payments and maintenance

C5 implementation is locally verified. Stripe remains opt-in; no provider account,
Price, webhook endpoint or deployment has been created. Google Play billing and
signed-device acceptance remain C6. See [checkpoint status](admin-credits-plan.md).

## Configuration and startup

Keep `PAYMENTS_MODE=disabled` for non-billing environments. Local emulator mode
defaults to labelled simulation when the setting is absent. For an explicitly
configured Stripe environment, put these values in its env file:

```dotenv
PAYMENTS_MODE=stripe
STRIPE_SECRET_KEY=YOUR_STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET=YOUR_ENDPOINT_SIGNING_SECRET
CREDIT_PACKS_JSON=[{"id":"your-pack","label":"Your pack","credits":100,"stripePriceId":"price_YOURID","amountMinor":500,"currency":"usd"}]
```

The catalog above is an illustrative shape, not a created product or price. Use
your own one-time Price, credits, positive minor-unit amount and lowercase ISO
currency. `npm run check:env` validates required settings without printing values.
Checkout verifies that the current active Price matches the order's saved amount
and currency. Catalog/provider mappings and secrets never enter browser props.

Run `npm run db:indexes` against the intended database before enabling payments.
MongoDB must support transactions. For local development, start the documented
replica-set emulator. Build and start the maintenance process separately:

```sh
npm run build
npm run worker
```

`npm run worker -- --once` performs one maintenance cycle and exits with a failure
code when that cycle fails. It uses the configured database: do not use this
command with production configuration as a local test. `npm run worker:build`
rebuilds both worker bundles without a Next.js rebuild. The Docker image contains this same worker;
Compose starts it without exposed ports using the application's env file.
The runtime image excludes administration scripts, development packages and env
files. Release/rollback replaces the app, payment worker and separate AI worker from the matching image.
No Redis, second application framework or public maintenance endpoint is used.

## Delivery and accounting

`/credits` provides one-time Stripe Checkout. The Server Action checks exact
origin, current session and the expected actor. The explicit
`POST /api/payments/stripe/checkout` contract additionally uses the existing CSRF
token/header; its strict JSON accepts only `packId` and `key`. Orders belong to
the verified session UID and snapshot pack quantity, Price, amount, currency and
return origin. A retry key keeps its original terms even after catalog changes.
Repeated requests use the same provider idempotency key. An unknown creation
request older than 23 hours is not recreated; a notification can recover its
session. Returning from Checkout does not grant credits.

`POST /api/payments/stripe/webhook` verifies the unmodified body and timestamped
signature before storing a notification. This follows Stripe's
[signature guidance](https://docs.stripe.com/webhooks/signature).
It rejects oversized bodies, wrong test/live mode and Connect-account events.
Only the event ID/type and provider object ID enter the durable inbox; full
payloads, billing details and signatures are not retained. Unsupported events
are acknowledged without accounting. The response succeeds only after required
inbox persistence.

Configure the endpoint for these snapshot event types:

- `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `checkout.session.expired`.
- `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`.
- `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`,
  `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`.

The worker leases inbox jobs and orders for two minutes with unique fence tokens.
Failures back off up to one hour and remain retryable; expired leases recover
after restart. Notifications trigger current provider reads, rather than replaying
old financial snapshots. The adapter verifies saved order/Price/quantity/amount/
currency, succeeded PaymentIntent, captured charge, successful refunds and current
disputes. More than 100 refund or dispute objects fails safely for operator review.
This is a bounded small-team implementation, not silent truncated accounting.

Credits are granted once using a permanent purchase reference. Grant/reversal
accounting and its order projection share a transaction. Cumulative successful
refunds reverse `floor(originalCredits × refundedMinor / originalPaidMinor)` using
integer arithmetic; full refunds reverse all credits. Pending/failed refunds do
not reverse credits. An open/lost dispute reverses the entire grant; a won,
prevented or closed inquiry leaves successful refunds reversed and restores only
the remaining entitlement. Reversals recover unused lots, cancel affected holds,
then record debt. Provider consoles initiate refunds; there is no public reversal
or arbitrary credit endpoint.

The worker polls overdue pending orders after 15 minutes and paid/refunded/disputed
orders after a day to recover missed notifications. It also settles due hold
timeouts and promotional expiry, including when billing is disabled. Managed AI
holds are excluded from ordinary timeout maintenance; the AI worker settles them. Idle cycles
do not generate stored success noise. Work and failures emit allowlisted runtime
events with stdout fallback. Inbox/order/idempotency records have no automatic TTL.

Web checkout is hidden in a detected Play app context, including unavailable Play
billing. The per-tab routing marker is not authentication or financial authority.
Actual Play packaging, account binding and billing remain separately unverified.

## Tests and external acceptance

```sh
npm test
npm run test:accounts
npm run test:payments
npm run test:integration
```

Build first and keep the local Auth Emulator running for `test:payments` and
`test:integration`; run them sequentially because they share port 3101.

Payment tests use signed synthetic notifications and owned disposable replica
sets/emulator users. They never call Stripe. The actual bundled maintenance entry
runs against the owned database with provider delivery disabled. Accounting tests
inject a fake provider to cover current-state reconciliation, duplicate delivery,
refund rounding, holds/debt, dispute restoration, lease recovery and rollback.
Browser checks cover hydration, keyboard focus, desktop/390px layout and persistent
Play routing. These checks do not establish live provider acceptance.

With your own Stripe sandbox settings, verify Checkout success, cancellation,
delayed outcomes, duplicate deliveries, partial/full refunds, disputes and worker
restart/recovery before activation. Stripe's
[fulfillment guide](https://docs.stripe.com/checkout/fulfillment) documents why the
return page alone is insufficient. Preserve warning-only quality checks; missing
configuration, failed builds and unavailable required services remain failures.

## Play prerequisite

At the recorded C6 prerequisite review on 2026-10-04, the official Android Browser Helper source parsed SKU/upgrade fields
without passing an obfuscated account ID into BillingFlowParams. Its
[account-binding request](https://github.com/GoogleChrome/android-browser-helper/issues/583)
was open. Recheck upstream when starting C6; this is historical evidence, not a
new upstream status check. Base must not claim secure Firebase-account ownership from a purchase
token alone. C6 needs either supported upstream account binding or an explicitly
chosen custom Android billing bridge, plus supported resolved Billing dependencies,
a successful signed build and internal-track testing. Play remains disabled while
this decision and the existing Android dependency-download blocker are unresolved.
