# Base repository adapter

## Repository and task contract

- Project: Base. Resolve the actual repository identity from `git remote -v`; do not assume the extracted repository already exists. Default development branch: main.
- Accepted implementation contract: docs/implementation-plan.md plus the user's current request.
- A milestone in that plan does not need another issue or approval. Localized fixes may use the user's request directly. Clarify only material unresolved scope or architecture decisions.
- Preserve the current branch and existing changes. Publication and branch creation follow explicit session authorization, not imported skill defaults.

## Canonical documentation

- Setup and commands: README.md.
- Current architecture: docs/architecture.md.
- Milestones and acceptance: docs/implementation-plan.md.
- Skill provenance and local guidance: docs/agent-tooling.md and skills-lock.json.
- Add durable lessons to the nearest relevant document; do not create an incident diary or a competing source of truth.

## Validation and review

- Use npm run typecheck, npm run lint, npm test, npm run check:env, and npm run check:skills as relevant. npm run validate runs all advisory checks and reports each exit code without failing on quality warnings.
- Build-sensitive work also runs npm run build. Desktop/mobile UI work uses Playwright against the local app; generated browser artifacts stay under output/playwright/ or .playwright-cli/ and out of Git.
- Revalidate when source, dependency/configuration inputs, or relevant environment assumptions change.
- A separate read-only review pass checks the exact final working tree against the task contract. Findings must identify actionable behavior defects. Report unverified scope honestly.
- Imported wording that treats missing checks, type/test/lint warnings, or review results as automatic publication/deployment gates does not apply. Preserve the advisory quality policy while fixing in-scope defects and reporting evidence.

## Publication and external actions

Skills do not authorize commits, pushes, pull requests, issue comments, merges, deployment, releases, or project metadata changes. Perform these only within the user's explicit session authorization. Documentation synchronization is local by default.

## Skill adaptations

Imported skills remain pinned to the reviewed source. This adapter overrides their generic workflow defaults: no mandatory issue for accepted work, no automatic publication or issue evidence comments, no mandatory stop after a fixed number of correction cycles, and no quality-warning release gates. Continue safely within the authorized scope.

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
