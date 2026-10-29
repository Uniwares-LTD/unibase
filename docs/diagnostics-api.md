# Diagnostics API

`POST /api/diagnostics` gives an administrator temporary, read-only access to
investigate any application module, including other accounts' records. Access is
granted from **Administration → Base settings → Diagnostic access**. It is opt-in,
needs Redis, and is never available in production.

It is separate from [MCP](mcp.md): an MCP token represents a service integration,
while a diagnostic grant represents an authenticated operator.

## Enablement

```dotenv
DIAGNOSTICS_ENABLED=true
REDIS_URL=redis://default:GENERATED_BASE64URL_PASSWORD@redis:6379
```

- Allowed only when `APP_ENV` is `local` or `staging`. Both `npm run check:env` and
  runtime code reject `DIAGNOSTICS_ENABLED=true` in production; an invalid value
  leaves the endpoint disabled.
- When disabled, both the endpoint and grant management return 404, and the card
  says diagnostics is disabled.
- Redis is required, including locally. Without `REDIS_URL` the card shows an
  unavailable state and the endpoint returns `DIAGNOSTICS_REDIS_UNAVAILABLE` (503).
  Other local flows keep working without Redis.
- Run `npm run db:indexes` once to create the `diagnosticAccess` 30-day retention index.

## Grants

An administrator with a sign-in less than 30 minutes old creates a grant. The card
sends:

- a **phrase** of 24–256 UTF-8 bytes; **Generate** creates 32 random bytes;
- an **expiry** of 15 minutes, 1 hour (default), 4 hours or 24 hours;
- an explicit **capability allowlist**. Metadata capabilities are preselected;
  content capabilities (`run.content`, `artifact.content`) must be selected.

The server hashes the phrase with scrypt (N=2^15, r=8, p=1, 32-byte key, unique
16-byte salt). It stores the salt, the hash, the issuer UID, the Firebase
`auth_time`, the issuer's access revision, the capabilities, a cursor-signing key
and the timestamps in Redis. Key details:

- Keys are namespaced `<project>:<APP_ENV>:diagnostics:*` and expire with the grant.
  Reading a grant never extends it.
- One Lua script creates the grant and maintains the issuer's index, so concurrent
  requests cannot exceed 20 active grants per administrator.
- Redis is authoritative. If a grant expires, is revoked or is evicted, access ends.
  There is no other store.
- `auditEvents` records `diagnostic-grant-requested` before activation, then
  `-activated` or `-failed`. A grant whose activation record cannot be written is
  revoked (`DIAGNOSTIC_GRANT_UNCERTAIN`) if Redis confirms the removal; otherwise
  the API returns `DIAGNOSTIC_GRANT_OUTCOME_UNKNOWN`. If Redis fails during creation and removal
  cannot be confirmed, the `-failed` record is marked `outcome-uncertain`, the API
  returns `DIAGNOSTIC_GRANT_OUTCOME_UNKNOWN`, and the card asks you to check active
  grants. Revocation takes effect first; its
  `-revoked` record follows.
- Phrases and hashes never appear in settings, settings history, audit records,
  browser storage or logs. The card clears the phrase after creation.

The grant management API is `/api/admin/diagnostics/grants`:

- `GET` lists your active grants.
- `POST` with `{ phrase, duration, capabilities }` creates a grant.
- `DELETE` with `{ id }` revokes one of your grants.

All three use the session, same-origin/CSRF checks and request limits.

## Requests

```http
POST /api/diagnostics
Authorization: Bearer <grant ID>.<base64url(phrase)>
Content-Type: application/json

{ "capability": "run.diagnose", "payload": { "id": "<logical Run or attempt ID>" } }
```

The base64url encoding is formatting, not encryption; send it only over HTTPS. The
helper builds the header after reading the phrase from a hidden prompt or a protected
file. It never prints or saves the phrase:

```sh
npm run diagnostics -- --origin https://staging.example --grant GRANT_ID --capability capabilities.list
npm run diagnostics -- --grant GRANT_ID --capability run.diagnose --payload '{"id":"RUN_ID"}' --phrase-file ./diagnostic-phrase
```

On POSIX systems a phrase file must not be readable by group or others.

Checks run cheapest first:

1. A shared pre-authentication limit (120 attempts per minute).
2. Grant lookup.
3. A per-grant limit (30 requests per minute).
4. Constant-time scrypt verification.
5. Firebase account checks: the account still exists, is enabled and has a verified
   email, and its tokens were not revoked after the grant was issued.
6. Application access checks: the issuer is still an active administrator, its
   `notBefore` is respected, and its access revision is unchanged.
7. The grant's capability allowlist.

Because any access change bumps the revision, demoting and then re-promoting an
administrator does not revive their old grants. Random grant IDs only touch the one
shared limiter key. Anyone can exhaust that shared limit for a minute, which is
accepted for staging.

**Limits.** Requests are capped at 16 KiB, read as they arrive (chunked bodies
included), with a strict `{ capability, payload }` schema and a strict payload per
capability. Search pages hold 25 records. Responses are capped at 512 KiB
(`DIAGNOSTICS_RESPONSE_TOO_LARGE`, 422). The overall deadline is 10 seconds
(`DIAGNOSTICS_TIMEOUT`, 504), measured from request entry and covering
authentication, the body read, capability work and the access record. Capability
work stops 1.5 seconds early so the record can still be written, and its database
operations use driver timeouts.

**Pagination.** Cursors are HMAC-signed with the grant's key. Each cursor is bound
to its grant, capability, normalized criteria and an expiry of at most one hour.

**Responses.** Every response is JSON with `requestId` plus either `data` or a stable
`error.code`. All responses carry `Cache-Control: no-store`. Methods other than POST
return 405, and no CORS headers are sent.

**Access records.** Before any data is returned, a sanitized record is written to
`diagnosticAccess`: operator, grant, capability, outcome, status and affected
account/resource. Records are kept for 30 days. If that write fails, the request
returns `DIAGNOSTICS_AUDIT_UNAVAILABLE` (503) without data. Records never contain
the credential, the request body or returned content.

## Capabilities

Call `capabilities.list` for the inputs each capability accepts.

| Area | Capabilities |
| --- | --- |
| Runtime | `runtime.status`, `workers.status` |
| Configuration | `configuration.check` |
| Reports | `reports.search`, `reports.get` (runtime, audit, diagnostic-access) |
| Runs | `run.search`, `run.get`, `run.diagnose`, `run.content`* |
| Accounts | `account.search`, `account.get` |
| Credits | `credits.get`, `credits.ledger`, `credits.holds` |
| Payments | `payments.search`, `payments.get` |
| Files | `file.search`, `file.get` |
| Artifacts | `artifact.search`, `artifact.get`, `artifact.revisions`, `artifact.content`* |
| Notifications | `notifications.search`, `notifications.get` |
| AI administration | `orchestrator.search`, `orchestrator.get`, `persona.search`, `persona.get`, `settings.get` |

\* Content capability: requires explicit selection and an exact ID.

Readers live in `src/lib/server/diagnostics` and use dedicated projections. They do
not call helpers that write as a side effect: `readSettings` seeds defaults, credit
reads expire lots, admin reports write the access-control fence, and
`capabilityForRun` creates capabilities. Expired lots are reported as
`expiredPendingSettlement`; missing settings are reported as unstored defaults.

Stored text is returned as inert JSON data and is never rendered or executed.
Responses never include:

- credentials, Run capability tokens, ciphertext or key fingerprints;
- server-injected private context or decision tokens (`run.content` also replaces
  any echo of the Run's capability token, matched by its stored hash);
- checkout URLs, raw webhook bodies, file bytes or signed URLs;
- environment dumps.

A key-name deny-list in `shape.ts` backs up the explicit projections.

## Private-context failures

The public failure code stays `private-context-unavailable`. New failed attempts
also store `failureDetail.reason`:

- `mcp-configuration-invalid`
- `mcp-disabled`
- `mcp-client-missing`
- `private-tools-missing`
- `mcp-permissions-missing`
- `encryption-key-missing`
- `encryption-key-invalid`
- `decryption-failed`

`run.diagnose` returns three kinds of evidence, each labelled with its source and
observation time:

- **Recorded:** the reason stored on the attempt.
- **Stored capability:** whether the saved Run context still decrypts, checked in
  memory; only the outcome is returned.
- **Current checks:** checks run now by this web process, plus the latest checks the
  AI worker reported with its heartbeats.

It reports whether the key comes from `DIFY_CREDENTIAL_ENCRYPTION_KEY` or the
`DIFY_MANAGEMENT_KEY` fallback. `APP_ORIGIN` is part of key derivation, so changing
the origin or the key breaks decryption of saved context. Older attempts without a
recorded reason are reported as `unrecorded`. Current checks are never presented as
proof of a historical cause.

## Staging activation

The feature flag is public configuration in `deploy/environments/*.json`, with
staging enabled and local/production disabled. The release image carries only the
allowlisted application flags and preloads them for its selected environment.
Flag changes use normal staging releases with the existing v1 controller; no
privileged controller update is needed for this activation.

1. **Owner:** the authorized application release operator under the
   [shared operations guide](https://github.com/Uniwares-LTD/infrastructure/blob/main/docs/operations.md).
2. **Install:** use the existing release workflow. Only the diagnostics flag is
   loaded from the image; private runtime settings stay on the host. Staging already
   uses private Redis, and no new secret or controller installation is required.
3. **Order:** install the additive diagnostics indexes, then release the revision
   with `runtime.DIAGNOSTICS_ENABLED` set to `"true"` in
   `deploy/environments/staging.json`. The image snapshots that value and the release recreates
   the web process. The three staging diagnostic indexes were installed and verified
   on 2026-10-29, with the collection empty before creation.
4. **Verify:** the card shows the grant form. Create a 15-minute metadata grant and
   call `capabilities.list`. Confirm a `diagnostic-grant-activated` audit record and a
   `diagnosticAccess` record, then revoke the grant and confirm a 401.
5. **Rotation and revocation:** grants expire by themselves, and administrators
   revoke them in the card. To remove all access, release `"false"` for the flag or delete the
   Redis keys matching `<project slug>:staging:diagnostics:grant:*`.
6. **Failure and resume:** release `"false"` in the tracked staging JSON or restore
   the previous image/configuration snapshot. Requests retain v1 compatibility;
   the earlier v2 controller package is superseded. Inspect the same release result
   before retrying; do not repeat completed index operations.

Redis eviction is owned by Infrastructure. Under a `volatile-*` or `allkeys-*`
policy, grants can be evicted under memory pressure. Access then fails closed, but
operators may see a grant vanish early.

## Verification

`tests/accounts/diagnostics.test.ts` covers:

- grant creation, audit order, the 20-grant cap, expiry, eviction, outages and
  revocation;
- role and Firebase revocation, and both rate limits;
- transport limits, cursor tampering, timeouts, oversized responses and audit
  failures;
- every capability against fixtures seeded with credential-like values, with
  before/after snapshots of business collections, including a wallet with expired
  lots and absent settings;
- each private-context reason, and decryption failure after an origin change.

The Lua store test runs only when `DIAGNOSTICS_TEST_REDIS_URL` points at a
disposable Redis, for example the Docker fixture used by `npm run test:limits`.
