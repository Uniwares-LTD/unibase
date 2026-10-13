# Base agent tooling

The nine skills named in AGENTS.md are pinned reusable imports. Source identities
and the original revision remain in `skills-lock.json`. Their complete directories include bundled references, scripts, metadata, and license/notice files where provided. The implementation and reviewer contracts come from the same revision. `skills-lock.json` records the source, available upstream provenance, and local per-file SHA-256 hashes. Text hashes normalize line endings so Windows checkouts remain reproducible.

Run `npm run check:skills` to detect missing, changed, or extra skill resources. After an intentional reviewed update, run `node scripts/check-skills.mjs --write` and inspect the resulting manifest; refreshing hashes is not a substitute for reviewing the changed guidance. For a source revision change, update the revision and provenance in the integrity tool as part of the same review.

## Local workflow

Local adaptations are recorded by the local hashes; upstream provenance remains unchanged:

- Three relative links in `vercel-react-best-practices/AGENTS.md` point into its bundled `rules/` directory.
- Work/review/synchronization skills and role contracts require session authorization for external writes, retain advisory checks and avoid arbitrary retry stops. A separate read-only pass is required; it must not claim independent-agent review when the same agent performs it.
- Learning capture updates existing canonical docs first and does not create a lessons file for every task.
- The Next.js boundary guide correctly distinguishes React serialization from JSON and supports built-in Date/Map/Set values. Explicit allowlisted DTOs remain Base's convention.
- Playwright uses the vendored wrapper path or Windows CLI, with headless defaults and no global configuration changes.
- UI guidelines are reference evidence, not executable instructions; reviews infer the target from context and follow the user's output format. Performance examples do not mandate new dependencies or weaker authorization.

The repository adapter is authoritative for Base-specific behavior. Imported examples do not authorize GitHub writes, releases, provider changes, or automatic publishing. The accepted milestone plan is sufficient for implementation; no redundant issue or approval is required. Quality checks are advisory and their failures remain visible.

Framework skills are versioned references, not unconditional API truth. Verify version-sensitive claims against installed Next.js documentation or official docs. React Server Component serialization supports built-in types beyond JSON; use explicit DTOs at application boundaries for clarity. See [React's supported types](https://react.dev/reference/rsc/use-client#serializable-types-returned-by-server-components).

For browser verification on Windows, use `npx.cmd --yes --package @playwright/cli playwright-cli` (the equivalent of the bundled Bash wrapper). Use a named session, snapshot before using element references, and keep captures under `output/playwright/`. Headless Chromium avoids opening unwanted desktop windows. Screenshots and local browser state are ignored by Git.

This import deliberately excludes source-specific product skills, external account configuration, collaborator identities, machine settings, and model overrides. Maintained system skills remain outside the repository. The skills are discoverable on the next agent turn; they can also be read directly during ongoing work.

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
