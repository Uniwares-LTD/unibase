# Template changelog

Base is versioned as a template with [semantic versioning](https://semver.org/).
`template.json` holds the current version. Derived projects keep their own product
version in `package.json`; their `template.json` records the template release they
last merged.

- Major: derived projects must act during the update (data, configuration or
  extension changes). The upgrade notes say what to do.
- Minor: new reusable behavior that derived projects receive without action.
- Patch: fixes only.

Until 1.0.0 the extension contract may still change in minor releases; the upgrade
notes say when it does. Release tags are named `template-v<version>`.

Every version section has **Changes** and **Upgrade notes**. Write "None." when a
release needs no action. Keep unreleased work under `## Unreleased` until release.

## Unreleased

### Changes

- Local MongoDB data moves to `.cache/mongodb/<slug>`; the earlier
  `.cache/mongodb-data` is left untouched.
- `MCP_CONNECTION_NONBLOCKING` is a declared tooling variable, so agent hosts
  that set it no longer fail application environment validation.
- Run result images get WebP `thumb` and `preview` variants; the asset route
  serves `?size=`, verifies the session once, and caches privately for five
  minutes with digest ETags.
- `endpoint()` passes its verified session to request actions.

### Upgrade notes

- Optional: after the operational backup, `npm run db:migrate` applies
  `runs:0002-asset-variants` to pre-generate variants. Without it, variants are
  created on first request.

## 0.2.0 — 2026-11-02

### Changes

- Template versioning: `template.json`, this changelog and the recorded
  `templateVersion` in derived projects' `project.source.json`.
- Project extension registry: `src/project/extensions.ts` and
  `src/project/server.ts` contribute modules, links, administration sections,
  MCP tools, domain adapters and indexes without editing core files.
- Forward-only database migrations: `npm run db:migrate`, server extension
  `migrations`, and migrations during new-environment provisioning. Replaces
  `scripts/migrate-domain-references.ts` with `runs:0001-domain-references`.
- Removable samples: `samples.json`, `npm run samples`, `check:samples` and
  `samples:remove`. The notes sample is the reference project extension.
- Extension links name a Lucide icon (`icon`) instead of a component (`Icon`).
- History-preserving initializer: derived projects share template history with
  one initialization commit and an `upstream` remote; revisions whose history
  touched private paths are refused. `npm run template:update -- <version>`
  merges a release and prints its upgrade notes.

### Upgrade notes

- After the operational backup, run `npm run db:migrate` (or
  `prepare-host.py --apply --migrate`) once. It records
  `runs:0001-domain-references`, which is idempotent for databases that already
  ran the retired domain-reference script.

## 0.1.0 — 2026-11-02

### Changes

- First versioned baseline of the reusable services: accounts and administration,
  credits and payments, private files, notifications, rate limits, diagnostics,
  MCP and the sample Runs stack.

### Upgrade notes

None. Projects created before versioning should compare against this release.
