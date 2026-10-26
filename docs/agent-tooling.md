# Base agent tooling

Uniwares handbook owns six shared workflow skills. Unibase keeps four local domain
skills: next-best-practices, vercel-react-best-practices, web-design-guidelines and
playwright. System-owned skills remain outside this repository.

## Setup and daily use

Run `npm run handbook:setup` once. It clones the private handbook as a sibling if
missing and initializes its cache. Existing unrelated directories are never overwritten.
Use `-- --path PATH` or `UNIWARES_HANDBOOK_PATH` for an explicit local location.
Do not commit personal absolute paths. Node and Git suffice; no npm install is needed.

At task start run `npm run handbook:check`. It returns a path/revision and checks
remote main only when four hours have elapsed. A failed attempt also gets a four-hour
cooldown. `npm run handbook:check -- --force` bypasses it. No scheduler, persistent
credential, or revision-upgrade PR is involved. Keep the returned baseline for the
task; different members may use different recent revisions without blocking work.

Read files using `git -C <path> show <revision>:docs/work-policy.md`, substituting
the command's returned values. Read relevant skills and their relative resources from
that same revision, not dirty working files. The launcher executes the tracked helper,
not a locally modified helper. It can upgrade the original bootstrap helper once from
a clean main checkout. Cached guidance is usable; no routine revision-reporting is needed.

## Troubleshooting

`npm run handbook:doctor` is read-only: it reports path/origin, branch/dirty state,
cache age, refresh attempts and entrypoint compatibility. Description differences are
advisory; wrappers never rewrite themselves during normal checks.

- Missing checkout: run setup with ordinary Git access to Uniwares-LTD/handbook.
- Offline/fetch failure: continue with the last synchronized baseline; retry later or force.
- Dirty, diverged or non-main checkout: preserve it and use the cache. Finish local work
  manually or choose a separate clean clone; never auto-reset, stash or switch branches.
- No baseline: explain once, continue under local guidance, and pause only decisions
  that need missing shared policy. Setup retries immediately when no baseline exists.
- Wrong origin: choose the correct checkout; the launcher does not rewrite its remote.
- Interrupted refresh lock: doctor reports it. Check the recorded PID in Git metadata;
  only after confirming no refresh is running, remove that lock and force a refresh.
- Skill missing in Codex: open a new session from the repository root and inspect its
  available skills. Run doctor before changing any entrypoints.

## Clients and lightweight acceptance

| Client | Integration | Verification |
| --- | --- | --- |
| Codex VS Code extension | Repository AGENTS.md and `.agents/skills` entrypoints | Fresh-session acceptance pending |
| Codex desktop app | Same repository files and launcher | Fresh-session acceptance pending |

In a fresh session in each client: ask which guidance/skills are available; use a
small authorized task to confirm the selected shared skill and local adapter are read;
ask an unrelated question to check unnecessary activation; inspect cached operation;
ask for an issue proposal to confirm it does not create/close issues without authority.
Use mocks or read-only tasks, not disposable live issues. Static checks and helper tests
do not prove these client behaviors. Record observed results without claiming coverage
for unavailable clients. No other clients or cloud-agent setup are included.

## Local contracts and provenance

The repository adapter retains runtime, deployment, locale/CSP and verification rules.
New substantial work follows handbook issue policy. Already accepted implementation-plan
milestones remain authorized without retroactive issues; small standalone changes remain
lightweight. Derived-project creation copies public guidance but performs no handbook
clone, credentials setup, project enrollment or backlog migration. Maintainers review
adoption and initialize guidance separately.

`skills-lock.json` distinguishes handbook entrypoints from pinned local imports and
retains replaced import/role hashes as provenance. `npm run check:skills` validates
local resources only, with no fetch or comparison against moving remote main.
After reviewed local edits, `node scripts/check-skills.mjs --write` refreshes hashes
without changing source identities. Shared role/resource references resolve in handbook.

Framework examples are versioned guidance, not unconditional API truth. Consult installed
Next.js documentation for version-sensitive behavior. Use npm.cmd/npx.cmd on Windows;
do not change execution policy. Browser state belongs in ignored output directories.

The following audits describe the previous import layout and remain historical evidence.

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
