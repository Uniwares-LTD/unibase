# Agentic developer documentation implementation plan

Planning draft for [Unibase issue #7](https://github.com/Uniwares-LTD/unibase/issues/7),
2026-10-28. Implementation and acceptance remain outstanding. This file records
the first planning deliverable, not completion of the issue.

## Contract and authority

Build a private English developer/maintainer documentation system in
`Uniwares-LTD/unibase-docs`. Verify the pipeline with fixtures before generating
real documentation. Initial generation and release-driven maintenance share the
same analysis, authoring, independent review and validation stages. Humans review
proposals and accept completion. No public site, domain, DNS or application
deployment changes are included.

The session authorizes a local `task/7-agentic-developer-docs` branch and this plan.
The user selected the existing Codex CLI login instead of a separately billed API.
Repository creation/access settings, pushes, PR publication and live agent runs
need their respective authorization. Do not copy CLI authentication into GitHub
Actions. The issue currently has no assignee; a human must identify the accountable
member before board ownership/status maintenance. Do not infer that member from
the GitHub token.

Planning source: clean Unibase commit
`636407a5b9bef8ba728a669403399a4e9a612176`. Reconfirm the source commit before initial
generation. Handbook baseline: `C:/Ilia/Karpishe/handbook`, revision
`a780e3dab0be06b2a49f3bfb5593ab211d5be024` (usable cached guidance).

## Source audit and ownership

| Source | Verified responsibility | Documentation treatment |
| --- | --- | --- |
| `README.md`, `package.json`, `.node-version` | Setup, actual scripts, pinned toolchain | Canonical setup stays here; tutorial teaches a bounded local journey and links to pinned setup |
| `scripts/create-project.ts`, `scripts/project-initializer.ts`, `tests/initializer.test.ts` | Derived-project creation, exclusions, manifest validation | How-to documents supported CLI and isolation; examples use disposable destinations |
| `project.config.json`, `src/lib/project.ts` | Public manifest instance, strict schema, dependency and locale rules | Reference derives allowed fields and constraints from schema, not just the example JSON |
| `docs/architecture.md`, `docs/services.md`, `src/lib/server`, `src/lib/config` | Application behavior, ownership and server boundaries | Explanation cites selected source modules and canonical contracts |
| `scripts/deploy/environment-catalog.json`, `scripts/environment-docs.mjs` | Generated environment inventory | Link to generated inventory; never hand-maintain another exhaustive catalog |
| `docs/implementation-plan.md` | Accepted milestone state and limits | Link; never infer live acceptance from code or historical tests |
| `docs/deployment.md`, `.github/workflows/deploy.yml` | Application operations and current release trigger | Restricted source, excluded from initial model bundle; no deployment workflow edits |
| `docs/history/` | Historical evidence | Excluded from default authoring inputs; never used as current instructions |
| Handbook and Infrastructure | Shared procedure and host ownership | References only; no implicit permission to ingest private inventories or operational details |

Current deploy workflow runs on `_staging`/`_prod` pushes and manual dispatch; it
is not a docs notification interface. Maintenance receives simulated local event
files first. The docs repository owns pipeline code, instructions, skills, style,
source/topic mappings, frontend, evidence and generated pages. Unibase retains
application code, setup, contracts, milestone state and generated inventories.
Corrections to those sources require a separate reviewed source change; a generated
page cannot silently supersede them. This audit does not certify every source claim.

## Frontend decision

Select Starlight for the proposed implementation. Both candidates build static
documentation with Markdown, navigation, customization and local preview.

| Criterion | Starlight | Material for MkDocs |
| --- | --- | --- |
| Contributor toolchain | Node/npm, matching Unibase tooling | Adds Python packaging or Docker |
| Content and branding | Markdown with validated frontmatter; Astro/CSS customization | Markdown, YAML configuration and theme customization |
| Search | Built-in Pagefind static full-text search | Integrated search configuration |
| Private local delivery | Build static output and serve on loopback | Build static output and serve on loopback |
| Decision | Lower toolchain overhead for this team | Viable alternative if team prefers Python |

Sources: [Starlight authoring](https://starlight.astro.build/guides/authoring-content/),
[Starlight search](https://starlight.astro.build/guides/site-search/),
[Material setup/build](https://github.com/squidfunk/mkdocs-material/blob/master/docs/creating-your-site.md).
Record exact installed Astro/Starlight versions and lockfile during implementation;
this plan does not invent future dependency versions. Verify search against a
production build, not only the development server. Branding starts with text
identity, local assets and semantic colors; no external fonts, analytics or crawlers.
Use Markdown only for model-authored content: reject executable MDX and raw HTML.

## Repository layout and content architecture

Proposed repository settings for approval: private `Uniwares-LTD/unibase-docs`,
default branch `main`, no template/import, no initial remote README, no extra team
grants or permission changes, Pages and automatic deployment unconfigured. Inspect
an existing repository before creating; a read failure is not proof of absence.
Organization-inherited access must be reported, not overridden.

```text
AGENTS.md                         authority, sources, stage order and review rules
STYLE_GUIDE.md                    English, Diataxis, commands, uncertainty, citations
doc-map.json                     topics, source selectors, ownership, dependencies
source-policy.json               reviewed repositories, paths and content limits
runtime.config.json              provider/model policy and execution limits; no secrets
.agents/skills/{analyze,author,review,validate}/SKILL.md
schemas/                         events, stage outputs, evidence and state
scripts/                         Node orchestrator, source loader, adapters, publisher
tests/fixtures/                  synthetic sources, outputs and failure scenarios
src/content/docs/                generated tutorials/how-to/reference/explanation
src/styles/                      branding
evidence/                        sanitized reviewed claims and acceptance evidence
output/                          ignored runs, preview packages, local state
```

The initial four topics are `tutorials/local-development`,
`how-to/create-derived-project`, `reference/project-config` and
`explanation/application-responsibilities`. Each has audience, goal, prerequisites,
explicit source paths, dependent topics and a canonical-source policy in the map.
Add pipeline setup, operation, costs, recovery and reusable Uniwares guidance through
the same workflow using reviewed pipeline sources after fixture verification.
Scaffold labels and fixture pages are not the initial documentation deliverable.

Every technical claim has an evidence ID resolving to repository, full commit,
path, line range and blob hash. Generated pages show reviewed source revision and
link to readable pinned sources. Evidence distinguishes code-supported claims,
locally tested behavior and externally unverified operations. Do not present source
inspection as a successful command execution. Conflicts block the affected claim
and produce an uncertainty report for human resolution.

## Runtime, skills and model policy

Use a Node.js orchestrator with deterministic source loading, schema validation,
state and file writes. A fixture adapter and a Codex CLI adapter implement the same
stage interface. No additional backend, queue service, application database or
agent framework is required. Roles run sequentially in fresh sessions; review never
reuses author conversation state. This is role separation, not independent human
acceptance or proof that the reviewer model cannot share author biases.

The CLI adapter uses saved local login and a required explicit model ID captured
from the operator's approved available configuration at preflight. Record CLI
version, model ID, reasoning setting, skill/prompt hashes and source hashes per run;
never use an undocumented automatic model upgrade. Use the same approved model for
all roles initially; model changes invalidate fixture/model acceptance evidence.
Live generation is disabled until the model and limits preview is approved.

Installed CLI inspected during planning: `0.164.0-alpha.11.1`; its help supports
`exec`, stdin prompts, `--json`, `--output-schema`, `--ephemeral`,
`--ignore-user-config` and `--sandbox read-only`. It emitted a sandbox home-directory
warning; authentication and live execution are **not verified**. Preflight must
resolve this without copying authentication files or bypassing sandbox restrictions.
See [official non-interactive documentation](https://learn.chatgpt.com/docs/non-interactive-mode)
and [CLI reference](https://learn.chatgpt.com/docs/developer-commands).

Stage processes receive only an isolated sanitized input workspace. Require a
verified isolation boundary that denies reads outside that workspace and disables
shell tools, MCP, plugins, hooks and arbitrary network tools; a read-only sandbox
alone does not guarantee private-file read isolation. Allow only provider traffic.
Preflight and adversarial fixtures must demonstrate this on the installed runtime;
if it cannot be enforced, stop live execution and propose an isolated runner rather
than weaken the boundary. Pass credentials through the existing CLI authentication
mechanism only. Do not read or log authentication contents. Do not inherit the
application environment. Return structured output to the orchestrator; the model
does not receive GitHub write credentials or execute publishing commands.

| Stage/skill | Input | Required output |
| --- | --- | --- |
| Analyze | Pinned sanitized source bundle, topic map, optional diff/event | Relevant/irrelevant/uncertain classification, selected topics, evidence and reasons |
| Author | Selected topic contract, source evidence, style guide, prior page when updating | Proposed Markdown and claim-to-source mapping; unresolved questions |
| Review | Candidate, original source evidence, topic acceptance and style guide | Findings by claim/location, contradictions, omissions, disclosure checks and disposition |
| Validate | Candidate plus evidence/review | Schema/link/build/browser results, sanitized preview and human-review manifest |

The orchestrator loads each committed skill explicitly and records its hash. A
skill is an execution contract, not just a directory added to the repository.
Schema-valid JSON is necessary but cannot establish factual correctness.

## Entry points and event contract

Proposed local commands in the docs repository (not existing Unibase commands):

```text
node scripts/docs.mjs initial --topic TOPIC --revision FULL_SHA --dry-run
node scripts/docs.mjs maintenance --event EVENT_JSON --dry-run
node scripts/docs.mjs run --plan REVIEWED_PLAN_JSON --provider fixture
node scripts/docs.mjs run --plan REVIEWED_PLAN_JSON --provider codex
node scripts/docs.mjs resume --run RUN_ID
node scripts/docs.mjs package --run RUN_ID
node scripts/docs.mjs propose-pr --run RUN_ID --dry-run
```

Both entry points create the same run plan. Initial mode selects one mapped topic
and pinned commit. Maintenance accepts schema version, event ID, source repository,
before/after full commits, event kind, environment label and bounded commit metadata.
Metadata is untrusted data, never instructions. Verify repository identity and both
commits, then calculate the real Git diff rather than trusting supplied filenames.
Renames/deletions and dependency changes select affected topics. Unmapped developer
contract changes produce triage uncertainty; they are not automatically irrelevant.
An irrelevant change records a reason and ends without invoking authoring or a PR.

Cross-repository access uses a separately authenticated deterministic source loader
with read permission only to Unibase. Agents see selected blob bytes, never the
whole private clone. Start with a reviewed local Git object source; separately
verify authenticated fetch of the same pinned blobs before claiming cross-repo
acceptance. No application deployment webhook or token is installed in this issue.

## Input protection and limits

Default-deny repositories and paths. Start with the four topic source sets above;
expand exact paths through review as analysis needs them. Exclude environment files,
private deployment bindings, inventories, logs, dumps, account data, build output,
browser state, Git metadata and auth stores even if accidentally tracked. Reject
symlinks, submodules, path traversal, unsupported binaries and oversized files.
Secret detection is an additional check, not a replacement for path/content review.
Scan inputs before invocation and outputs before logs, evidence or packaging. Stop
and report redacted source locations on detection. A secret removed in the new
revision must not leak through the old-revision diff. Treat all source prose and
commit messages as untrusted evidence, never executable instructions.

Proposed per-run defaults: one topic; one concurrent run; at most six model calls
(analysis, author, review, one author correction, second review, one reserved retry);
180-second call timeout; 20-minute run timeout; 256 KiB source text; 128 KiB per
structured response; 10 MiB local run artifacts. Stop at each boundary. Retry only
clearly failed transient operations, once, within the same budget. Persist budget
consumption across restart; no automatic fallback provider or model.

Record reported token usage when available. Subscription usage is not a guaranteed
zero cost or unlimited entitlement. Call/time/byte caps bound local execution but
do not guarantee a hard provider token or monetary cap during an in-flight call.
If a hard monetary cap is required, this login-based adapter cannot claim it; stop
for a different approved provider arrangement. Fixtures incur no model usage.

## State, recovery and duplicate prevention

Persist atomic versioned checkpoints under ignored `output/runs/<run-id>` with
exclusive locks. Identity hashes include repository, revision(s), topic set, map,
policy, skill hashes, model/runtime configuration and content hashes. Repeated
events with equivalent inputs reuse completed evidence; event-ID reuse with
different payload is rejected. Same-topic concurrent work is serialized.

States: planned, sources-ready, analyzed, drafted, reviewed, validated,
packaged, awaiting-approval, publication-intent, published, failed or uncertain.
Each checkpoint records stage inputs/outputs, hashes, remaining budget and redacted
failure category. Resume verifies hashes and reuses only completed matching stages.
Partial files never count as completed. A crash after a provider request may have
consumed usage: mark uncertain and require reconciliation before another request.
Failed builds preserve drafts; no PR is prepared as validated until build recovery.

PR publication is a separate deterministic adapter, off by default. Dry run emits
exact destination, branch, file diff, title/body, preview location and permissions.
After explicit authorization, persist intent before writing and query the exact
branch/PR marker before creation or retry. An unknown response requires remote
readback; never blindly resend. Use a unique run marker and `Related to
Uniwares-LTD/unibase#7`, never automatic closing keywords. A local manifest is not
a published PR. Keep In review until human acceptance.

## Delivery sequence and evidence

| Phase | Deliverable | Acceptance evidence |
| --- | --- | --- |
| 1 Planning | This audit, architecture, interfaces, limits, source/permission preview | Human review of material choices and remaining authorization |
| 2 System | Private repo, guidance/skills, map/style, orchestrator/adapters, branded Starlight scaffold | Repository identity/privacy readback; local fixture-only build; dependency lockfile |
| 3 Fixture verification | Full shared workflow on synthetic inputs, failure/resume tests | Passing cases below before real-source authoring |
| 4 Initial generation | Four English developer pages, generated separately through approved runtime | Pinned source/skill/model evidence; fresh review invocation per page; real validation |
| 5 Maintenance | Simulated notification, relevance analysis, targeted regeneration and PR proposal | Authenticated pinned-source access; repeated-event test; authorized real PR or explicit outstanding acceptance |
| 6 Packaging/handoff | Loopback publishing rehearsal and generated operator/reuse guides | Build/package/serve checks, recovery replay, final read-only review and human acceptance |

Meaningful tests must include relevant configuration and server-contract changes;
irrelevant cosmetic/non-topic changes; unknown source mapping; removed/renamed sources;
missing/conflicting evidence; source prompt injection; planted secrets in either
revision; forbidden-path and symlink access; malformed model output; timeouts and
uncertain usage; persistent budget exhaustion; repeated/concurrent events; build
failure; interrupted checkpoint writes; and ambiguous PR creation readback. Fixture
adapters verify stage ordering and contracts without provider calls. A separately
approved live smoke run verifies actual CLI schema handling and role separation;
fixture success alone does not certify the live adapter.

Frontend verification serves the built package on loopback, tests all four routes,
internal links, locally served assets, Pagefind search, keyboard navigation/focus,
mobile menu at 390px and desktop layout. Use a named Playwright session and ignored
captures. Archive a hash manifest and sanitized evidence, unpack into a disposable
directory and serve again. This is the selected local publishing path; no
`gh-pages` push, Pages activation, public URL or domain is needed. Private PR preview
is a reproducible downloadable/locally generated package with loopback instructions;
localhost alone is not a remotely accessible reviewer preview.

A final separate read-only pass compares exact output hashes to issue acceptance,
source ownership, disclosure policy and verification. Record actual failures and
unrun checks. Keep implementation, repository publication, PR publication, local
publishing simulation and human acceptance as distinct states.

## Next authorization and remaining decisions

Review this plan and approve the proposed private repository creation settings before
creation. A sibling checkout `C:/Ilia/Karpishe/unibase-docs` also needs filesystem
permission because it lies outside the current workspace. Keep this planning bridge
in Unibase until the docs repository exists; then transfer the canonical pipeline
plan there and replace this file with a link rather than maintain competing plans.

Before live generation, present the exact model, selected source bytes/paths and
limits for approval after isolation and fixture checks pass. Before pushing or
opening a PR, present its concrete diff and preview. No actual external site
publication is requested. Accountable member selection and final acceptance remain
human decisions. Issue #7 remains incomplete until all agreed criteria are met.
