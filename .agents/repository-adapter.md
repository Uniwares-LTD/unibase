# Base repository adapter

## Repository and task contract

- Project: Base. Resolve the actual repository identity from `git remote -v`; do not assume the extracted repository already exists. Default development branch: main.
- Accepted implementation contract: docs/implementation-plan.md plus the user's current request.
- Already accepted milestones in that plan, including the accepted handbook onboarding plan, need no retroactive issue or approval. New substantial work uses issues under handbook policy; small standalone changes may use the user's request directly. Clarify only material unresolved scope or architecture decisions.
- Preserve the current branch and existing changes. Publication and branch creation follow explicit session authorization, not imported skill defaults.

## Canonical documentation

- Setup and commands: README.md.
- Current architecture: docs/architecture.md.
- Milestones and remaining acceptance: docs/implementation-plan.md.
- Application deployment/acceptance: docs/deployment.md; shared host/access/progress:
  Infrastructure's docs/operations.md (linked from the deployment guide).
- Historical trials: docs/history/. Preserve dated evidence and existing anchor links;
  never treat an archived command or a past test result as current readiness.
- Skill provenance and local guidance: docs/agent-tooling.md and skills-lock.json.
- Add durable lessons to the nearest relevant document; do not create an incident diary or a competing source of truth.

## Validation and review

- Use npm run typecheck, npm run lint, npm test, npm run check:env, and npm run check:skills as relevant. npm run validate runs all advisory checks and reports each exit code without failing on quality warnings.
- Build-sensitive work also runs npm run build. Desktop/mobile UI work uses Playwright against the local app; generated browser artifacts stay under output/playwright/ or .playwright-cli/ and out of Git.
- Revalidate when source, dependency/configuration inputs, or relevant environment assumptions change.
- A separate read-only review pass checks the exact final working tree against the task contract. Findings must identify actionable behavior defects. Report unverified scope honestly.
- Imported wording that treats missing checks, type/test/lint warnings, or review results as automatic publication/deployment gates does not apply. Preserve the advisory quality policy while fixing in-scope defects and reporting evidence.

## Publication and external actions

For assigned issue work, handbook policy authorizes enrollment of its existing issue,
nonterminal status/blocker maintenance and concise evidence comments. Confirm the acting
member from the assignment; credentials alone do not establish ownership. Human approval
is required for new issues/sub-issues; humans close/reopen issues and mark Done.
Commits, pushes, PR publication, merges, deployment, releases, permission changes and
other project configuration changes retain explicit session authorization.

## Skill adaptations

Four local domain skills remain pinned. Six shared workflow skills resolve from the
handbook baseline returned at task start, without per-consumer version pins. Retain
accepted milestone authority, proportional checks, no arbitrary retry limit, and no
quality-warning release gates. Local application contracts remain authoritative;
resolve actual conflicts without silently weakening authority.

For feature planning, resolve module selection, owned domain/file references, notifications,
locale/RTL behavior and accepted-history compatibility through the service contracts.
For reuse review, check initializer isolation/secret exclusions, module admission versus
visibility, accepted adapters, scoped pagination, quota/reference transactions and outbox
replay. For UI, check navigation, dictionaries, RTL and document nonces.
Documentation synchronization reconciles generated environment/translation inventories
with canonical sources and distinguishes current JSON templates from historical YAML.
Preserve dated evidence; add useful lessons to existing canonical docs first.

Playwright's Bash examples are portable examples. On Windows use npx.cmd with the same CLI, a workspace-local npm cache, and headless operation unless an interactive window is requested. This local browser verification needs no cloud credentials or permission ceremony.


## Reusable runtime contracts

Read [service contracts](../docs/services.md), [locale architecture](../docs/architecture.md#locale-and-direction)
and the current JSON [template catalog](../src/lib/server/runs/templates/README.md)
for affected work. Project identity/modules/examples are setup decisions in
`project.config.json`; credentials remain private runtime configuration. Retain
accepted adapter versions, owner-bound cursors, reference fences, permanent
accounting/idempotency evidence and notification transaction coupling.

Use `npm.cmd` / `npx.cmd` on Windows when PowerShell wrappers are blocked; do not
change machine execution policy. Read complete check output: the advisory build
configuration does not run type checking. Use `npm run typecheck` separately.
Check translated client navigation and English/Arabic 390px layouts after UI work.
CSP tests must inject into a served document; privileged Playwright evaluation is
not evidence that document CSP permits an injected script. Keep auth/browser state
under ignored output directories and stop only fixtures started by the task.

After relevant edits, run `npm run check:docs`, `npm run check:i18n` and
`npm run check:skills`. Refresh generated catalogs/assets or skill hashes only
for reviewed changes. Historical verification stays separate from current setup.
Initializer tests may create synthetic Git objects inside disposable fixtures;
they must never mutate the working repository's index, refs or history.
