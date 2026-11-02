# Template readiness requirements

## Outcome and users

Base becomes a reusable template. Maintainers of derived products add project
schemas, endpoints, MCP tools and administration without editing core files,
remove the samples they do not need, and receive later template fixes by merging
a versioned template release.

## Scope and flows

Included:

- Template versioning with upgrade notes.
- A project extension registry read by core code.
- A forward-only database migration runner.
- A removable reference feature that exercises every extension point.
- Packaging the durable Runs stack (AI jobs, Dify orchestrators, personas,
  artifacts and Unitale templates) as removable samples.
- A history-preserving initializer and a template update command.

Excluded: configurable first-admin email, the "Base settings" label, staging
placeholder configuration and the documentation split. Creating or pushing
GitHub repositories, deployment and releases keep separate authorization.

Compatibility: persisted handler IDs/versions, accounting records, collection
names and `unibase_context` remain compatibility contracts. Removing a sample
never rewrites credit, ledger, payment or notification history.

## Requirements and acceptance

- R1 Versioning: `template.json` holds a semver version; `CHANGELOG.md` records
  each version with upgrade notes; derived projects record the template version
  they started from; the initializer validates that version. A check reports a version without a changelog entry.
- R2 Registry: one `src/project` definition contributes modules, navigation,
  administration sections, MCP tools, domain adapters, indexes, notification
  templates/categories, workers and migrations. Contributed entries receive the
  same permission, module and ownership checks as core entries.
- R3 Migrations: a planned `db:migrate` command applies namespaced migrations in order,
  records them with checksums, serializes concurrent runs, refuses changed
  applied migrations and is safe to rerun after failure.
- R4 Reference feature: a minimal owned "notes" feature uses contract, store,
  service, route, MCP tool, admin page, navigation, both locales, a migration and
  tests, and is listed as a sample.
- R5 Samples: `samples.json` lists every path each sample owns;
  a planned `samples:remove <name>` command removes it. With all samples removed the
  application builds, core tests pass and existing financial records stay readable.
- R6 Initializer and updates: a derived project keeps template history in one
  initialization commit, has an `upstream` remote, records removed samples, and
  a planned `template:update <tag>` command merges a template release, resolves changes to
  removed samples and prints the upgrade notes.

## Decisions and sources

- Derived projects use the history-preserving initializer instead of GitHub
  same-organization forks: independent visibility, access and PR targets.
- All durable Runs functionality is sample code (user decision, 2026-11-02).
- Migrations are forward-only; the operational backup is the rollback.
- Verified: closed registries in `src/lib/project.ts`, `src/lib/server/mcp/tools.ts`,
  `src/lib/server/domains.ts`, `src/app/admin/sections.ts`,
  `src/components/app-shell.tsx`, `scripts/db-indexes.ts` and
  `src/lib/contracts/notifications.ts`; 24 core files import Runs code.

## Dependencies and constraints

Deployment provisioning runs `db:indexes` (`scripts/deploy/provision.py`); adding
migrations there needs an operator-impact note. Commits need explicit session
authorization in this repository.

## Open decisions and readiness

No open decisions block planning. Ready for implementation.
