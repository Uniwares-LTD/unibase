# Reusable services

`project.config.json` selects modules at project creation. Accounts, administration,
preferences, diagnostics and persistence remain core. Navigation and admission
checks use the typed descriptors in `src/lib/project.ts`; their configuration
requirements also select the setup validator checks. Hiding a link never
replaces service ownership checks. Runtime configuration separately controls live
provider admission. Existing accepted work and financial evidence remain readable.

## Private files

`/files` and `/api/files` provide owned upload/list/download/deletion and usage.
Metadata/deletion use `/api/files/[id]`; bytes use its `/content` endpoint. Requests
authenticate before multipart reads, enforce origin/CSRF and shared limits, and
bound body consumption to the configured file size plus 1 MiB overhead and 30
seconds. Readers are cancelled on overflow, disconnect or timeout.

New accounts default to 20 MiB per file, 100 files and 100 MiB total; saved limits
are preserved. The existing image/document/audio/video allowlist applies. Images
are normalized; other files download as attachments with safe filenames and
nosniff. Local files use GridFS; configured private S3 storage retains digest and
version checks. Provider-only legacy uploads are not listed as downloadable files.

Quota is reserved transactionally before finalization. The account/upload retry
key deduplicates retries and rejects changed content. Maintenance reclaims stages
after 24 hours and retries fenced deletions. Quota is released only after confirmed
storage deletion. `409 FILE_IN_USE` protects retained product references and active
or uncertain Runs; eligible terminal-history cleanup releases its references.
Run inputs can reuse managed files with cached provider uploads per file/binding.

## Notifications

The owned `/notifications` inbox and `/api/notifications` support paged reads,
unread summaries and read/read-all. Category preferences cover Runs, credits and
account changes, defaulting on. Human decisions, final parent Run outcomes,
confirmed purchase/reversal changes and administrative access changes enqueue a
notification intent in the originating MongoDB transaction.

The maintenance worker uses a fenced idempotent outbox consumer. Inbox retention
is 90 days; minimal event tombstones prevent replay after inbox expiration. Stored
template keys and bounded parameters render in the current locale. Links are
allowlisted internal destinations with ownership rechecked on opening. The visible
tab refreshes unread state every 30 seconds; session boundaries abort and clear
private client state after account changes.

## Security and deployment

The canonical environment catalog is `scripts/deploy/environment-catalog.json`.
Application validation, deployment validation and generated setup documentation
share accepted names. Deployment keeps staging and production credentials,
databases, origins and ingress networks separate; errors suppress secret values.

Redis also stores [diagnostic grants](diagnostics-api.md), the only grant store; eviction or loss ends access. Diagnostic readers are read-only by construction and must not reuse service methods that seed settings, expire credit lots, refresh access fences or create Run capabilities.

Redis uses atomic counters with 60-second expiry, scoped to project/environment
and verified account or MCP client. Defaults per minute are 120 reads, 30 ordinary
mutations, 10 uploads, 10 Run admissions and 120 MCP calls. Policies are validated
server configuration. Limit failures return 429/Retry-After; dependency failures
return safe 503 responses. Local development may omit Redis. Deployment uses
private authenticated Redis and Nginx as the only application ingress.

Documents use nonce CSP passed to Next.js, next-themes and Radix styles, with
framing, content-type, referrer and permissions protections. Firebase helper and
public offline routes have explicit policies. Production excludes script
unsafe-eval. See [deployment](deployment.md) and [MCP](mcp.md) for operational setup.

## Domain extensions and migration

Register trusted adapters in `src/lib/server/domains.ts`, with a stable ID/version,
reference kind, ownership validation, target-picker metadata and transactional
result application. Register orchestrators against allowlisted adapters. Browser
and provider output cannot select handlers or owners. Preserve registered versions
for accepted attempts; the artifact adapter reads legacy records.

An optional adapter `prepare` hook may stage private, idempotent data before the
publish transaction. It must not publish references, charge credits or bypass the
current ownership/target checks in `apply`. Artifact preparation copies ready Run
images within MongoDB; unreferenced copies stay inaccessible through product reads.
Application failures retain an allowlisted code, phase and timestamp rather than
raw exception text. Failed saves still require the owner's explicit retry.

After reviewing the target database and taking the normal operational backup,
`node --conditions=react-server --import tsx scripts/migrate-domain-references.ts`
adds reference metadata idempotently. It does not rename or rewrite accounting
collections. `npm run db:indexes` adds the new collection indexes. These commands
operate on the explicitly configured database; local tests use disposable stores.

See [locale architecture](architecture.md#locale-and-direction) and the
[acceptance checklist](test-plan.md#reuse-and-service-hardening-acceptance).
