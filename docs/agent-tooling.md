# Base agent tooling

Handbook owns eight workflow and four selected technology/UI skills. Canonical local
.agents/skills entrypoints read shared procedures at the task revision. Claude's thin
.claude/skills references route to them; CLAUDE.md imports @AGENTS.md. Project facts and
adaptations remain in the [adapter](../.agents/repository-adapter.md) and
[source map](source-map.md), declared by [handbook.json](../handbook.json).
The [repository preferences](../.agents/repository.md) record user-confirmed language
and durable branches; [tracking](../.agents/tracking.json) records this repository's
project selection when configured. An unconfigured selection grants no tracking
destination or authority. Local configuration does not verify live access or workflows.

## Setup and daily use

Run `npm run handbook:setup` once with Node, Git and read access to the private Handbook.
No application dependency installation is needed. It uses a sibling checkout unless
`-- --path PATH` or UNIWARES_HANDBOOK_PATH supplies a local override. Never commit machine paths.
At task start run `npm run handbook:check` and retain the full path/revision in conversation
context through later skills and handoff/resume. Read shared text with git show at that
revision, including docs/bootstrap.md, policy and relevant skills. A later refresh or
`--force` does not replace the active task revision. Recover lost context first; explicitly
establish a new baseline and report discontinuity only when recovery fails.

The launcher runs committed helper content. Required guidance/helper compatibility is
checked before promotion; cached/offline guidance stays usable. Follow-main refresh has
a four-hour success/failure cooldown, explicit force and no scheduler. No persistent
task records or per-consumer revision pins are added.

## Explicit integration updates

Review Handbook's merged onboarding instructions at the task revision before reconciling
launcher/offline-tool copies. Preserve local scope, accepted milestones and advisory checks.
Materialize filesystem resources with `node scripts/handbook.mjs resources --path PATH --revision SHA`,
using the actual retained path/SHA. Run `npm run handbook:sync -- --source SNAPSHOT` with its
returned resourcePath, then `npm run handbook:entrypoints -- --source SNAPSHOT`.
This explicitly updates managed Codex references and thin Claude wrappers. Without
--source, sync maintains Claude references from local canonical skill metadata.
Customized/unmanaged content is preserved and reported for manual reconciliation.
Normal refresh never rewrites entrypoints. Read assets from the same committed snapshot;
run project commands from this consumer, not the snapshot directory.

Sync also merges the shared command gate list, retires specified obsolete gates, and
generates Claude ask/deny rules while preserving other settings. Gates do not grant
authority: Base still requires explicit commit and publication authorization. No local
reviewer subagent is installed. Codex gate configuration and Claude runtime enforcement
are not verified by these offline checks.

Use `npm run handbook:templates -- --source SNAPSHOT` to preview templates and add
`--write` to copy missing files. Existing copies are project-owned; replace only named
files with `--update PATH`. Issue/PR starters live in .github; document starters live
in docs/templates. Existing guidance, source map and preferences are preserved.

Run `npm run handbook:ready` offline after updates. Missing files, invalid references and
incomplete source-map structure produce warnings without readiness exit-code gates.
It needs no clone, credentials or network and does not certify prose/ownership accuracy.
Run `npm run check:skills` and `npm run check:docs`; after reviewing intentional edits,
`node scripts/check-skills.mjs --write` updates local integrity hashes. Update the map when
navigation, commands, generated boundaries or ownership changes.

## Troubleshooting

The [GitHub access policy](../.agents/repository-adapter.md#github-access) applies to
Handbook setup/check/doctor/resources and Git-based tests because they spawn Git.
Readiness, entrypoint drift and other purely offline checks can run normally.

`npm run handbook:doctor` is read-only. It reports origin, cached revision, checkout state,
attempts and local entrypoint warnings. `npm run handbook:check -- --force` bypasses cooldown.
Preserve dirty/non-main/ahead/diverged checkouts. Never reset/stash/switch to force refresh.
Wrong-origin directories are rejected, not repaired. With no baseline, run setup/repair
and continue unrelated work under local guidance; pause only Handbook-dependent decisions.
Ancient helpers without refresh/diagnose exports need explicit bootstrap reconciliation.
After an interrupted lock, inspect its PID and remove it only after confirming no active refresh.

## Clients and lightweight acceptance

Codex discovery uses .agents/skills. Claude uses CLAUDE.md imports and .claude/skills.
Markdown references install no hooks, permissions, subagents or dependencies.
Fresh-session Codex discovery/activation, local reads, refresh and handoff/resume acceptance
remain pending. Normal-permission Node child-process Git execution previously encountered
spawnSync git EPERM; elevated terminal success is not native-client acceptance.
Claude runtime checks are explicitly deferred. Verify relevant activation and local map/adapter
reads in each actual client without creating issues or live demonstration projects.

## Local contracts and provenance

The adapter retains runtime, deployment, Windows browser, locale/CSP, DTO and performance
adaptations. Accepted implementation-plan milestones need no retroactive issues. Warnings
remain advisory; build/runtime failures are real failures. Derived creation copies reviewed
guidance, references, metadata and offline tooling, but never clones Handbook, copies its
cache, sets credentials, enrolls projects or migrates backlogs. It excludes this repo's
tracking selection and preferences, replacing them with explicit unconfigured
placeholders at the same paths so guidance links remain valid. Readiness reports the
missing choices until maintainers confirm them during adoption. Maintainers reconcile the
inherited source map and ownership before adoption.

skills-lock.json records local entrypoint hashes. Historical imports, original upstream
identities and resource hashes are preserved in provenance/handbook-migration.json.
Duplicated technology procedures/resources moved to Handbook with licenses/notices and
provenance; Playwright LICENSE.txt and NOTICE.txt also remain locally. Shared snapshots
retain relative resources. System-owned skills are unchanged.

## Integration reconciliation — 2026-10-28

Reconciled against Handbook main at
`a780e3dab0be06b2a49f3bfb5593ab211d5be024`, fetched and verified against GitHub.
This is provenance, not a consumer version pin. Launcher and offline tool match that
committed source. All twelve entrypoints were synchronized; the four selected technology
skills remain unchanged in scope. Starter copies preserve local documents; the PR
starter adds Base's operator intervention reporting.

Fourteen Handbook fixtures and the derived-project isolation fixture passed. Offline
readiness, entrypoint drift, skill integrity, documentation/environment inventories
and translation checks passed. Doctor reported no warnings. Git subprocess checks
needed elevated access in this environment; this does not certify native-client runtime
acceptance. Live project workflows/access and Claude runtime remain unverified here.
Typechecking passed with native-cache access. The separate read-only review was a
same-agent cold-review fallback and found no actionable defects. No application build
or live service acceptance was run for this integration/initializer-only change.
Handbook's own operations record still lists disabling project Auto-add as outstanding;
this update makes no remote project or permission changes.

## Shared-guidance adoption verification — 2026-10-27

Adopted after [Handbook PR #3](https://github.com/Uniwares-LTD/handbook/pull/3)
merged. The reviewed committed source is recorded in migration provenance; routine
consumer checks continue to follow main without pinning it.

Passed: all twelve launcher/integration fixture tests, the derived-project isolation
fixture, local skill/Claude integrity, documentation links/commands, environment docs,
translation checks, offline readiness and drift checks against the committed snapshot.
Readiness and drift reported no warnings. Elevated check/doctor access verified
the merged baseline and zero doctor warnings. The copied test fixture initially assumed
a Handbook source checkout; it now uses synthetic offline source metadata and passes.
Finalization corrected an integrity-check gap: deleted Claude references now fail
the supporting-file inventory comparison, with a regression fixture covering removal.
All 100 removed resources exist in the retained Handbook revision; launcher/offline
tool copies match that revision, and historical provenance matches the previous lock.
The final review is a separate read-only pass by the same agent, not independent review.

Normal-permission check and doctor still fail with spawnSync git EPERM in this environment;
the Node test runner also requires elevated subprocess access here. The twelve fixture
tests passed with that access; read-only elevated doctor reported zero warnings.
That is not a passing native-client check. Claude runtime and fresh-session Codex
acceptance remain deferred. Application build/full service suites were not rerun for
this guidance/bootstrap-only change. No runtime deployment or operator intervention
is required. Changes remain local pending consumer publication.

The following audits describe earlier layouts and remain dated historical evidence.

## Onboarding validation — 2026-10-26

Passed: five launcher fixture tests, the derived-project initializer fixture, local
documentation links/commands, and integrity checks for six entrypoints/four local skills.
Handbook's twelve tests cover lazy timing, offline cooldown, concurrent refresh and
existing enrollment behavior. An end-to-end local Git fixture verified setup, cache
reuse, zero doctor warnings, shared role/template reads and dirty-helper protection.
No live issues, credentials, application services or deployments were used.
Fresh-session acceptance in both Codex clients remains pending as shown above.

## Handoff audit

On 2026-10-04, `npm run check:skills` verified all nine imports and both supporting
contracts against the lockfile, including the bundled reference and notice files.
All 25 relative Markdown links under `.agents` resolved to local files. The imported
Playwright license and notice are retained; source references remain provenance,
not Base provider configuration. The root instructions and repository adapter
keep milestone scope, external writes and advisory validation under Base policy.
Re-run integrity and review changed references whenever imports are updated.

Documentation naming was generalized for Base on 2026-10-06. The five affected
skill Markdown resources changed only project terminology; source identities,
licenses and upstream hashes remain unchanged. Local hashes were refreshed after
review and all nine skills plus two supporting contracts passed integrity checks.


## Reuse-contract reconciliation (2026-10-13)

All nine repository-owned skill entrypoints and their bundled resource/link
inventories were reviewed against the adapter. Eight entrypoints received focused
runtime-contract, locale/CSP or Windows workflow guidance; learning capture and the
bundled framework examples remained applicable. Licenses, source revisions,
upstream records and explicit publication authority are preserved. Local hashes
were refreshed only after reviewing the intentional edits. System-owned skills
were not changed. The link checker covers local skill references as well as docs;
framework examples remain examples rather than repository command requirements.

The adapter links current service and JSON template contracts. Use `npm.cmd` and
`npx.cmd` on Windows instead of changing execution policy. Next.js compilation and
worker bundling are distinct from `npm run typecheck`; inspect both results.
Browser state and cache directories are local ignored fixtures. Historical test
passes are dated evidence, not instructions or acceptance of a new clone.
