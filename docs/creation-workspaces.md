# Reusable creation workspaces

`/workspaces` combines persisted messages, generated cards, human decisions,
immutable artifacts, approvals, private assets and candidate batches. It is a product-neutral
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

- `src/lib/contracts/workspace.ts` composes versioned application contracts: legacy
  questions/drafts, registered cards/artifacts, review outputs and commands;
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
  Register product content through the shared creation registries and matching renderers;
  do not accept arbitrary client-specified schemas, prices or actions.
- `src/lib/server/workspaces/asset-storage.ts` stores immutable owned assets in
  MongoDB by default, or stages asset bytes in a configured private S3-compatible
  store. Metadata and workspace references attach transactionally; remote writes
  never run inside a retried MongoDB transaction. `object-store.ts` implements
  conditional writes, bounded verified reads and exact-version deletion.
- Export commands produce immutable, version-pinned JSON/text assets. JSON includes
  source references and the current approval if it still applies to that version.
  Image references remain private IDs, not public URLs or embedded image bytes.
  The export panel additionally queues ZIP archives and readable PDF documents through
  the maintenance worker. Versioned server renderers use the same private asset
  boundary. No booklet-specific PDF layout is bundled.

### Durable PDF and ZIP exports

Select up to 20 artifact versions in the export panel, choose Artifact archive or
Readable document and
queue the export. Selection order is preserved, and each selected version can be
changed independently before admission. Content, approval evidence and image
digests are captured when queued; subsequent edits do not change that export.
The ZIP contains `manifest.json`, JSON/text files under artifact-ID/version paths
and normalized PNG assets under asset-ID paths. Titles and uploaded filenames
never determine ZIP paths. Downloads require the owner's session and are not cached.

PDF uses a generic A4 layout with selected titles, versions, approval evidence,
plain text/checklists, normalized images and page numbers. It wraps long identifiers
and supports mixed-direction text. The bundled Noto fonts cover Latin, Greek,
Cyrillic and Arabic/Persian; characters outside that coverage (including CJK and
emoji) cause an explicit terminal failure. ZIP preserves those characters, or a
downstream renderer can supply additional fonts. Font provenance and licenses are
in `public/export-fonts/`. The renderer limits output to 200 pages and two minutes,
in addition to the shared storage limits. It never interprets text as HTML or fetches
remote fonts, images or templates.

Keep `npm run worker` running for exports, including when AI and payments are
disabled. Export rendering uses no AI credits. Jobs expose progress, cancellation
and a private download when complete; closing the page does not cancel them. There
are at most three active exports per account and 20 retained jobs per workspace.
Image input bytes total at most 64 MiB; output files follow the private asset limit
(8 MiB with MongoDB, 64 MiB with S3). Existing 50-asset workspace limits also apply.

The worker recovers expired leases and retries interrupted local rendering up to
three attempts. A terminal failure requires an explicit new export. Exact admission
retries preserve one job; a changed request cannot reuse its key. Cancellation fences
publication even if rendering or object staging is already in flight. Wait for the
worker to acknowledge cancellation or its lease to expire before archiving. Archived
workspace cleanup excludes queued/leased exports and removes terminal export
snapshots/results while keeping request fingerprints. Unattached object stages follow
the abandoned-upload cleanup policy.

`export-jobs.ts` owns admission, leases and publication; `export-snapshot.ts` captures
content inside the owned transaction. Add trusted, versioned renderers to
`export-renderers.ts`. The renderer receives a snapshot, a restricted image reader,
cancellation signal, size limit and progress callback. Preserve old renderer versions
for saved jobs; never register code from requests or model output. API boundaries are
`/api/workspaces/[id]/exports` and `/exports/[jobId]/cancel` under the same workspace.

### Generative UI examples

Run `npm run dev` and open `/design-system` for interactive examples of all seven
registered cards: question, form, summary, gallery, progress, issue and review.
The examples use the real `RegisteredCard` components and registry response validation.
Try a single-choice decision, a form with text/numeric/multiple-choice/toggle fields,
acknowledgements and a revision request. Responses stay in page memory; reopening,
resetting and reloading let you repeat the interactions. They do not mutate workspaces
or approve actual artifacts, and the page remains unavailable in production.

`src/lib/creation/examples.ts` exports deterministic sample data for downstream
development tools. Gallery samples deliberately have no authorized assets and cannot
fetch private images. In a real workspace, replace the example IDs with owned assets
and supply the same authorized IDs to the renderer; client allowlisting never replaces
server ownership checks. Progress and review are application-issued cards, so examples
must not be copied into model output contracts for those types. Production persistence,
access checks and version-bound approvals belong to workspace commands.

### Private object storage

`ASSET_STORE=mongo` needs no additional credentials and allows images up to 8 MiB
before and after normalization. To use private S3-compatible storage, set
`ASSET_STORE=s3` and the `ASSET_S3_*` variables in `.env.example`: endpoint, region,
bucket, prefix and explicit access/secret keys. Path-style addressing defaults to
true. The endpoint must be an HTTPS origin; loopback HTTP is allowed only with
`APP_ENV=local`. Configure the same store for web and both workers, then run
`npm run db:indexes` and restart them. Configuration errors suppress supplied values.

Use an application-owned private bucket/prefix with read, conditional-write and
delete access, including version operations if the bucket is versioned. Public
URLs and browser storage credentials are never issued. Store identity includes
endpoint, region, bucket and prefix; credential rotation does not change identity.
Changing the store identity requires migrating retained objects; old object
references are not silently redirected to a different bucket. Existing inline
MongoDB assets remain readable when S3 is enabled. JSON/text exports remain inline.

The object adapter supports assets up to 64 MiB; current image uploads are limited
to 20 MiB before/after normalization and 16 million pixels. Uploads use the owned,
CSRF-protected multipart route `/api/workspaces/[id]/uploads`. Generated provider
images retain their separate 1 MiB contract. Downloads pass through the owned API
and verify object size and SHA-256 before serving bytes.

`workspaceAssetStages` records an immutable random object key before upload. A
confirmed write becomes ready, then attaches in the workspace transaction. Unknown
writes and failed attachments retain their records for cleanup; retries never
overwrite an earlier object. Attachment expires after 24 hours, and at most 20
unclaimed/removal-pending stages are allowed per account. Use the admin cleanup
scope **Abandoned private uploads** for old uploading/ready stages. Preview and
confirmation select exact IDs; attached stages are excluded and attachment races
are rechecked transactionally.

Confirmation queues removal; it does not claim the bytes have already disappeared.
The existing payment/maintenance worker processes approved removals even with AI
disabled. It checks object identity, deletes the recorded version when supplied,
and retains the cleanup record. Lost leases resume; failures retry with delay up
to one hour. Reports distinguish pending, failed/retrying and completed storage
removals. Refresh `/admin/operations` for current counts; investigate repeated
failures through worker health and private-store configuration/permissions. No
provider-hosted AI files or financial/audit/retry records are deleted by this scope.

### Live Dify workflow outputs

Configure the existing `DIFY_BINDINGS_JSON` and server-only `DIFY_KEY_*` variables
for whichever of the three names are enabled. Workflows must return these output
objects, not a JSON-encoded string under a `text` key:

```json
{
  "type": "question",
  "question": {
    "kind": "single",
    "title": "Which tone?",
    "explanation": "Choose a direction.",
    "options": [
      { "id": "formal", "label": "Formal" },
      { "id": "friendly", "label": "Friendly" }
    ]
  }
}
```

```json
{
  "type": "draft",
  "draft": { "title": "Draft title", "body": "Draft content" }
}
```

```json
{
  "summary": "Review summary",
  "issues": [{ "severity": "blocking", "message": "Verify this claim." }]
}
```

```json
{ "title": "Image title", "png": "BASE64_ENCODED_IMAGE_BYTES" }
```

Compose also accepts registered `card` and `artifact` envelopes described below.
Review returns summary/issues. Image
returns inline bytes; arbitrary provider URLs are not fetched. This deliberately
bounded adapter avoids introducing an SSRF/download subsystem. Image requests without
input images retain the original prompt/context contract. The existing
2 MiB SSE frame limit applies. Live workflow schemas and provider behavior still
need acceptance in the target environment.

### Owned reference images and image edits

The image composer accepts up to four private PNG references from the current
workspace. Selecting an existing image artifact as the target also supplies its
current image as the edit base. Admission validates every asset's ownership and
workspace, freezes asset IDs and the target version, and rejects stale candidate
selection. Source artifacts supply textual context; selecting a reference supplies
actual image bytes. The generic AI submission endpoint cannot bypass this boundary.

For requests with image inputs, configure the image workflow to consume
`prompt`, `context`, `image_operation` (`generate` or `edit`), `reference_images`
(a file list of up to four images) and `edit_image` (an empty or single-image file
list). The worker uploads owned bytes and sends Dify local-file descriptors with
`type: "image"`, `transfer_method: "local_file"` and `upload_file_id`. File inputs
contain these descriptors, not storage URLs or application asset IDs; the upload
retry scope stays server-side. Text context can still identify owned assets. The workflow
must connect these inputs to its chosen image backend and return the existing
title/PNG output contract; configuring input names alone does not implement editing
inside the provider workflow.

Successful uploads are reusable for the same account, binding and content digest.
An uncertain upload pauses generation for administrator review without automatically
resending the file. After administrator resolution, an explicit new candidate attempt
uses a new upload scope. Confirmed upload rejection, unavailable references and
exhausted local file quotas release the generation hold without dispatching generation.
The existing allowance is 100 retained AI files and 100 MiB per account. Provider
upload limits may be lower than private asset limits. Provider-hosted file copies are
outside local cleanup; local deletion does not promise their remote deletion.

### Registered generative UI

`src/lib/creation/cards.ts` defines versioned, validated question, form, summary,
gallery, progress, issue and review cards. `artifacts.ts` defines document, image
and checklist artifacts. Matching renderers/editors live in
`src/components/workspaces/registered-card.tsx` and `registered-artifact.tsx`.
Model output contains typed data only. Progress and review controls are created
by the application, not accepted from model output. Actions are allowlisted and
validated again on the server; responding to a review uses the same stale-version,
dependency and approval rules as the artifact panel. A revision request records
feedback and clears approval. The quality panel can start a bounded targeted
repair/re-review workflow for selected findings, described below.

Example compose output:

```json
{
  "type": "card",
  "card": {
    "type": "form",
    "version": 1,
    "data": {
      "title": "Preferences",
      "explanation": "Choose the audience.",
      "fields": [
        {
          "id": "audience",
          "label": "Audience",
          "kind": "text",
          "multiline": false,
          "required": true,
          "maxLength": 500
        }
      ]
    }
  }
}
```

Form fields support text, bounded numbers, toggles and single/multiple choices.
Unknown fields/actions and invalid values are rejected. Saved responses survive
reload; reopening preserves the answered card and creates a new active instance.
The fake compose provider recognizes `form` and `checklist` in instructions.
To add an artifact type, register a versioned schema and projection plus its
renderer/editor. To add a card, register its schema, allowed response actions and
renderer. Unknown versions fail safely. Existing question/draft outputs and saved
document/image versions remain readable; no data migration is required.

### Conversation and previews

Messages and command/result events are recorded in `workspaceEvents`. Workspace
reads include the latest 25 events; an owned history endpoint supports keyset
pagination. The timeline has a message composer and links to saved content and
execution history. Saving a message does not dispatch AI. The latest 12 messages,
bounded to 8,000 characters, enter the frozen context of future generations.
Old workspaces do not receive fabricated historical events.

Successful image candidates can be previewed before selection through an owned,
uncached endpoint. It checks workspace membership, job ownership, successful
settlement and retained output, then fully decodes and normalizes the bytes. It
does not persist an asset until selection. Generated gallery/image references
must belong to the same workspace; settlement validates ownership before charging.

### Execution profiles

Administrators publish reusable profiles at `/admin/execution-profiles`. A profile
contains instructions, an optional named server-configured provider binding, context
inclusion settings, a source-artifact requirement and eligibility for all active
accounts or administrators. Publication requires a recent administrator sign-in,
uses optimistic revision checks and an idempotency key, and writes an audit event.
Every publication creates an immutable revision. The editor exposes paginated
revision history. A profile's task cannot change; create another profile for another
task. The template supports up to 100 profile identities.

In the workspace composer, choose a profile independently for each of one to three
candidates. Task defaults remain available when their default binding is configured.
A task can also run through an eligible profile when only its alternative binding
is configured. Alternative bindings may point to different workflow/model settings,
but must return the selected task's output contract. Credentials stay in the existing
server environment configuration, never in profiles. Simulated mode accepts binding
names without live credentials.

Profile instructions are prepended to user instructions, with a combined limit of
10,000 characters. The profile's ID, revision and name are included in frozen context.
Profile revision, input, provider binding fingerprint and capability pricing are
saved before admission. All candidates use their task's existing credit policy;
profiles do not introduce a second pricing system. Changing or disabling a profile
affects new batches and new attempts, not previously accepted batch admission or
existing jobs. A stale selection requires reload. Context exclusion omits messages
or saved decisions from that candidate's input; source/version safety checks still
apply to the entire batch.

**New attempts:** confirmed failed/cancelled candidates expose an explicit action
with the credit reservation maximum. It creates a new one-candidate batch and job,
retains the previous evidence, and permits only one direct successor per candidate.
Repeating the same request cannot reserve twice. Saved profile and binding revisions,
source/decision versions and current pricing must still match; otherwise create a
new batch with current settings. Provider rejection, terminal failure/stopping, and
cancellation before dispatch provide retry evidence. An administrator credit waiver
alone does not prove cancellation and cannot authorize this action. Older jobs need
retained terminal provider evidence; a status label alone is insufficient.

## Persistence and recovery

### Durable workflows and targeted repair

The **Workflows** panel offers draft/review/approval, three-candidate comparison,
and parallel drafts followed by approved-source synthesis. It previews step order,
automatic imports versus human choices, per-step execution profiles and the total
maximum credits before starting. Reservations happen per admitted candidate;
insufficient balance or pending admission blocks the step with recovery guidance.
An explicit new attempt has its own credit consent and is outside the original
planned maximum. Independent roots can be admitted before either finishes; provider
execution concurrency depends on the number of running AI workers.

The existing AI worker must be running with AI enabled. Closing the browser does not
stop a run. `workspaceWorkflows` keeps the definition, source pins and each command
before application; replay after a crash finds the original batch/import. Run
controls use owned `/api/workspaces/[id]/workflows` and `/workflows/[runId]` routes,
separate run revisions and stable request keys. Server Components read these modules
directly. Worker commands retain source/decision checks but tolerate unrelated
workspace messages and parallel branches. Reopened decisions and revoked checkpoint
approvals are rechecked inside the batch transaction before new work is admitted.

Pause prevents future scheduling; admitted jobs can finish. Resume rechecks account
access and retries blocked saved commands. Cancel fences scheduling and requests
cancellation of unfinished child jobs, including late admission; uncertain provider
acceptance still requires `/admin/ai`. Pending batch admission is resumed explicitly
in the candidate list. Confirmed failure retries retain predecessor evidence and can
continue the workflow; multiple selected retry results are rejected as ambiguous.
Changed source versions, disabled/changed profile revisions or changed binding/price
terms require a new workflow. A checkpoint requires current approved source versions
when configured and an explicit owner confirmation. AI does not approve content.

Register a validated definition in `src/lib/creation/workflows.ts` to expose a reusable
template. Definitions contain bounded data: task/checkpoint steps, dependencies,
capability/profile references, selection policy and targets. They contain no code.
`workflowDefinitionSchema` rejects cycles, unknown dependencies and ambiguous automatic
selection. The form-then-draft fixture in `tests/accounts/workflows.test.ts` demonstrates
a generated form whose saved response gates dependent generation. Product prompts
and graphs belong in the downstream project. Definitions are snapshotted per run;
register new versions without modifying the meaning of persisted runs.

Selected quality reviews create stable findings with severity, originating artifact
version and review, status, repair attempts and action history. Old reviews remain
readable and gain deterministic finding identities; prior explicit blocking-acceptance
notes are preserved. The artifact panel can accept a current finding, reopen it or
mark an older finding resolved after a newer version has a fresh review with no open
blocking findings. Each action needs a reason of at least ten characters and invalidates
approval. Approving with a blocking-acceptance note also records acceptance on each
open blocking finding for that version.

Select up to five open findings to start **targeted repair**. The server constructs a
repair → re-review → human-approval run, pins the current target, and records the
attempt atomically with run creation. Only one active/paused repair run per artifact
is allowed; each finding has at most three repair runs and 30 history entries.
Cancelled runs retain their attempt records. Repair does not automatically resolve
findings; inspect the new content and re-review before recording resolution. The
repair route is `/api/workspaces/[id]/repairs`. Document/structured-content repairs
use the compose contract. Image edits use the image task and its owned reference-input
contract; the targeted-repair template currently uses compose for its repair step.

### Workspace mutations and candidate recovery

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
30 versions/artifact, 100 legacy question cards, 200 registered cards, 100 reviews,
200 approvals, 50 batches, 50 assets and 20 workflow runs. Runs have up to 12 steps.
The aggregate is limited to 2 MiB. Batches contain one to three candidates. Context
is at most 40,000 characters and total AI input at most 64 KiB. These explicit
bounds keep reads, transaction retries and UI history predictable. Higher-volume
products should split histories into paginated collections before increasing them.

Uploaded images use the configured 8/20 MiB limits above; generated images remain
limited to 1 MiB before and after normalization. All images allow 16 million decoded
pixels. Sharp performs a complete decode, rejects unsupported/multiframe inputs,
strips metadata and writes PNG. The worker validates generated image bytes before
settling credits; import validates again before private storage. Asset GETs require
the owner session and use no-store/nosniff and restrictive content headers. Nothing
is written under `public/`. Sharp is a production dependency shared with the bundled
AI worker; the standalone deployment includes its native runtime.

### Archive and confirmed workspace deletion

Owners can **Archive workspace** after finishing or cancelling active/paused workflow
runs. Archiving prevents content mutations and new admission, and marks the workspace
read-only in the editor/list. Existing downloads remain available; already admitted
AI jobs may finish. **Restore workspace** permits editing again but leaves admission
paused until the owner explicitly resumes. Both actions use the existing revision,
ownership, access and exact-retry boundaries.

Administrators can choose **Archived workspaces and content** in `/admin/operations`.
The age applies to the archive timestamp. A preview scans the oldest 100 archived
candidates and includes at most 10 eligible workspaces (or the smaller requested
limit), with exact IDs, saved-asset counts and conversation-event counts. A workspace
with active/paused workflows, uploading objects, leased/nonterminal jobs, uncertain
admin waivers or accepted admission intents without job records is excluded. Resolve
uncertain executions through the existing admin page. For an interrupted admission,
restore/resume and retry its saved pending admission, then finish/cancel the jobs
before archiving again. Old unknown staged uploads use the separate abandoned-upload
cleanup scope first.

Confirmation rechecks authorization, revision, archive age and execution/upload
eligibility. Restored or changed targets are skipped. Deletion removes snapshots,
artifact/approval history, decisions, reviews, conversation events, saved workflow
content and inline asset bytes. Related terminal job inputs/results/source references
are cleared; job IDs, pricing, usage, ledger, global audit and request fingerprints
remain. `workspaceTombstones` retains owner, ID, revision and deletion timestamp,
preventing a creation retry from resurrecting the deleted workspace. Command and
workflow-operation fingerprints remain, without their content-bearing definitions.

Private object references are revoked in the same transaction; their staged metadata
queues exact-object removal on the maintenance worker. Reports distinguish logical
deletion from pending/failed/completed physical removal. This cannot be undone in the
application. There is no automatic retention schedule or AI-provider file deletion.
The narrower completed-AI-content cleanup scope still clears only terminal job
payloads and retains authored workspace snapshots; use the archived-workspace scope
when those snapshots must also be erased.

## Verification

`npm run test:accounts` includes workspace concurrency/replay, owned reads,
suspension, invalid choices, stale sources/decisions, partial admission, pause,
approval invalidation/cycles, review acceptance, image validation and owned exports.
Workflow tests also cover restart replay, pause/cancellation fences, late admission,
independent branches, generated decision gates, rechecked checkpoint approval,
multi-candidate recovery, targeted repair limits and explicit resolution evidence.
`npm run test:ai` adds production HTTP/CSRF/ownership and bundled-worker checks.
Tests use disposable MongoDB and local Auth emulator; no live AI/storage calls.
Storage tests also exercise the actual S3 SDK against a local HTTP fixture,
ownership before writes, attachment/cleanup races, unknown PUT recovery,
exact-version removal, digest/size bounds and failed-removal retry reports.
Lifecycle tests cover archive/restore, rejected edits/uploads, changed previews,
uncertain/leased/incomplete-admission exclusion, content erasure, preserved financial
and retry evidence, queued object removal and deleted-key resurrection prevention.

Manual browser acceptance: question → answer → reload → reopen; compare and select
draft candidates; revise → review → approve → change upstream source; image upload
and generation; JSON/text downloads; desktop/mobile keyboard and theme checks.
