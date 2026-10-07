# Reusable creation workspaces

`/workspaces` combines persisted generated questions, human decisions, immutable
artifacts, approvals, private assets and candidate batches. It is a product-neutral
implementation inspired by the Unitale POC at commit
`1abecb627c1a0aa8fed54ba3752f8fced6bb70fb`; no booklet graph, product identity,
provider credentials or agent runtime was copied.

## Local use

Use the normal local Firebase Auth emulator and MongoDB replica set setup. Run
`npm run db:indexes`. Set `DIFY_MODE=fake`, build the application/worker with
`npm run build`, then run web and `npm run worker:ai`. Give the test account
credits through the existing local credit simulator or administrator adjustment.
Each workspace capability defaults to one credit per successful candidate;
`AI_PRICING_JSON` can configure the existing fixed/token/cost/hybrid policies.

Create a workspace, generate a question (use “question” in the fake prompt), select
it, and save an answer. Generate one to three draft candidates, compare them and
select one. Revise drafts manually or generate a revision targeting an artifact.
Run a review against that artifact, select the review, inspect its findings, then
approve the current version. A blocking finding requires an explicit acceptance
note of at least ten characters, or a new repaired version. A new review clears
existing approval. AI never approves its own work.

Use image generation or upload a PNG/JPEG/WebP to create an image artifact. Download
owned assets or export an exact artifact version as JSON/text. Without AI enabled,
manual drafts, version history, approvals, uploads and exports remain available.

## Contracts and extension points

- `src/lib/contracts/workspace.ts` owns versioned application contracts: text,
  single-choice and multiple-choice questions; draft and review outputs; commands;
  explicit public DTOs. The renderer accepts data, never generated JSX/HTML/scripts,
  navigation destinations or arbitrary tool names. React escapes the text.
- `src/lib/server/workspaces/store.ts` owns transactions, idempotency, version
  checks, dependencies, approvals, durable batch manifests and result import.
  `service.ts` derives the actor from the verified session. API mutations reuse the
  exact-origin/CSRF boundary and expected-account check. Transactions write the
  account access record, fencing concurrent suspension.
- `src/lib/server/ai/capabilities.ts` registers three optional workflow bindings:
  `workspace-compose`, `workspace-review`, `workspace-image`. Each accepts
  `prompt` and `context` strings. Context contains saved decisions and explicitly
  selected artifact snapshots, including a revision target when present.
  Register product contracts here and extend the command/renderer schemas together;
  do not accept arbitrary client-specified schemas, prices or actions.
- `src/lib/server/workspaces/assets.ts` defines `PrivateAssetStore`. The initial
  implementation stores immutable bytes and owned metadata together in MongoDB,
  atomically with workspace references. An object-storage implementation needs
  staged immutable writes, authorization, orphan cleanup and an explicit retention
  policy; it must not perform remote writes inside MongoDB transaction callbacks.
- Export commands produce immutable, version-pinned JSON/text assets. JSON includes
  source references and the current approval if it still applies to that version.
  Image references remain private IDs, not public URLs or embedded image bytes.
  Add PDF/ZIP or product layout exporters behind this same owned asset boundary;
  no booklet-specific PDF layout or external storage provider is bundled.

### Live Dify workflow outputs

Configure the existing `DIFY_BINDINGS_JSON` and server-only `DIFY_KEY_*` variables
for whichever of the three names are enabled. Workflows must return these output
objects, not a JSON-encoded string under a `text` key:

```json
{"type":"question","question":{"kind":"single","title":"Which tone?","explanation":"Choose a direction.","options":[{"id":"formal","label":"Formal"},{"id":"friendly","label":"Friendly"}]}}
```

```json
{"type":"draft","draft":{"title":"Draft title","body":"Draft content"}}
```

```json
{"summary":"Review summary","issues":[{"severity":"blocking","message":"Verify this claim."}]}
```

```json
{"title":"Image title","png":"BASE64_ENCODED_IMAGE_BYTES"}
```

Compose returns either question or draft. Review returns summary/issues. Image
returns inline bytes; arbitrary provider URLs are not fetched. This deliberately
bounded adapter avoids introducing an SSRF/download subsystem. Image inputs are
prompt/context only; reference-image editing is not implemented. The existing
2 MiB SSE frame limit applies. Live workflow schemas and provider behavior still
need acceptance in the target environment.

## Persistence and recovery

`workspaces` stores a bounded owned aggregate: cards, decisions, artifact versions,
dependency snapshots, approval history, quality reviews, assets and batch manifests.
`workspaceOperations` stores request fingerprints separately. Exact retries return
current state without applying a mutation twice; reusing a key for different input
conflicts. Revision mismatches require refresh and human review. Server reads call
modules directly. Clients use the shared session-aware API, including cancellation
on logout/account switching.

Each batch freezes capability version, provider binding fingerprint, pricing terms,
inputs, source versions and decision fingerprint before admission. Child jobs use
deterministic keys in the existing `aiJobs` queue and managed credit ledger. The
existing separate worker is the only provider dispatcher. No web-process runner
or second credit ledger is introduced.

Admission is intentionally per candidate: insufficient credits, the existing
five-active-job limit or interruption can leave some candidates pending. “Retry
pending admission” reuses saved terms/keys, so already admitted jobs/holds are not
duplicated. All successful candidates are charged, including unselected ones.
Selecting one candidate is final for that batch; other candidates remain readable.
Only settled, retained successful results can be imported. Failed/uncertain work
does not become an artifact. Uncertain provider jobs use `/admin/ai` recovery.

Pause prevents new admission intents, including retry admission. An intent accepted
before pause can finish admission afterward; already admitted jobs continue. Resume
and explicitly retry pending work. Cancellation of admitted jobs uses the existing
AI execution page. A batch with changed source versions or saved decisions cannot
be admitted or selected: create a new batch using current context. Retrying an
ambiguous provider call is never used as recovery.

Artifact edits append versions and clear approval transitively through dependent
artifacts. AI revisions retain their target's dependencies and pin them to current
source versions. Changed decisions clear approval on generated artifacts and their
dependents; those generated versions need revision before approval. Dependency
cycles are rejected. Approval requires the latest version
and current, approved direct sources. Historical versions, decisions, review
evidence and approval records remain; old approval does not authorize a new version.
Selected reviews are pinned to their exact artifact version. Repair creates a new
version, which needs fresh human approval and can receive a fresh review.

## Bounds and retention

The template permits 50 workspaces/account; each workspace supports 30 artifacts,
30 versions/artifact, 100 cards, 100 reviews, 200 approvals, 50 batches and 50 assets.
The aggregate is limited to 2 MiB. Batches contain one to three candidates. Context
is at most 40,000 characters and total AI input at most 64 KiB. These explicit
bounds keep reads, transaction retries and UI history predictable. Higher-volume
products should split histories into paginated collections before increasing them.

Images are limited to 1 MiB before and after normalization and 16 million decoded
pixels. Sharp performs a complete decode, rejects unsupported/multiframe inputs,
strips metadata and writes PNG. The worker validates generated image bytes before
settling credits; import validates again before private storage. Asset GETs require
the owner session and use no-store/nosniff and restrictive content headers. Nothing
is written under `public/`. Sharp is a production dependency shared with the bundled
AI worker; the standalone deployment includes its native runtime.

The administrator AI cleanup tool does not delete authored workspaces, saved
decisions, artifact history or assets. It can clear old unselected terminal AI job
outputs; such outputs can no longer be imported. Batch manifests retain their
original input snapshots for retry evidence, so this is not a content-erasure
feature. There is no new automatic expiry, provider deletion, or workspace-delete
UI. Choose an explicit product retention policy before adding those operations.

## Verification

`npm run test:accounts` includes workspace concurrency/replay, owned reads,
suspension, invalid choices, stale sources/decisions, partial admission, pause,
approval invalidation/cycles, review acceptance, image validation and owned exports.
`npm run test:ai` adds production HTTP/CSRF/ownership and bundled-worker checks.
Tests use disposable MongoDB and local Auth emulator; no live AI/storage calls.

Manual browser acceptance: question → answer → reload → reopen; compare and select
draft candidates; revise → review → approve → change upstream source; image upload
and generation; JSON/text downloads; desktop/mobile keyboard and theme checks.
