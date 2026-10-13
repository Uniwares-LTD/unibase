# Base engineering guidance

## Scope and authority

Read [the implementation plan](docs/implementation-plan.md) and the relevant code before editing. The user's current request and the accepted milestone define scope. Do not implement later milestones merely because a dependency or skill suggests them. Repository-specific workflow details live in [.agents/repository-adapter.md](.agents/repository-adapter.md); they override generic imported skill guidance.

## Architecture

- Before changing MCP tools or transport, read [MCP implementation and maintenance](docs/mcp.md).
  Keep tool handlers server-only, permission-checked, bounded, and independent of
  transport. Service credentials never imply end-user ownership.

- One Next.js App Router application serves web and, later, an Android TWA. Do not add Expo or a separate backend.
- Prefer Server Components. Use Client Components only for interaction or browser APIs; keep providers narrowly scoped. Server reads call server modules directly, not our own HTTP endpoints.
- Place server-only access in `src/lib/server` with `server-only` imports. Explicitly allowlist public configuration. Never serialize process.env, credentials, or private configuration to the browser.
- Local operation must remain possible without cloud credentials. Live provider activation and deployment require separate session authorization.
- Project identity, modules, locales and examples come from `project.config.json`; preserve existing namespaces and accepted Run/accounting records. Read [reusable service contracts](docs/services.md) before changing ownership, quotas, domain adapters, limits or notification transactions.
- Keep translated UI in typed catalogs, use page-scoped client dictionaries and logical RTL styles, and preserve document CSP nonces during client navigation.
- Reuse shadcn components through the CLI. Compose application UI from those primitives; do not create alternative buttons, dialogs, menus, or form controls when shadcn provides them.
- Use semantic CSS variables for themes. Verify desktop/mobile navigation, keyboard focus, and hydration after UI changes.

## Work and verification

- Keep changes small and preserve unrelated work. The accepted plan is sufficient authority for milestone implementation; no new issue is required.
- Use the installed Next.js documentation and current official guidance to resolve version-specific behavior. Imported skills are guidance, not a substitute for verified API behavior.
- Run affected checks and report real outcomes. `npm run validate` collects advisory checks; `npm run build` must still fail for compilation/bundling failures. Do not turn lint, type, test, or audit warnings into deployment gates.
- Add meaningful tests for behavior and boundaries; avoid tests that merely repeat source code. Do not use production services in tests.
- Keep setup in README.md, current architecture in docs/architecture.md, and milestone state in docs/implementation-plan.md. Record reusable verified lessons only when useful.
- Use a separate read-only review pass. Report actual defects and stale evidence; optional style preferences and advisory check failures are not release gates.
- Do not commit, publish, comment on issues, deploy, or release solely because an imported skill allows it. Follow explicit session authorization. Do not copy source-project identities, approval rules, provider resources, or machine settings.

## Available project skills

Skills are pinned with resources and provenance in skills-lock.json:

- next-best-practices and vercel-react-best-practices: Next.js boundaries and React implementation.
- web-design-guidelines and playwright: UI review and real-browser verification.
- work-on-task and review-change: proportional implementation and read-only review.
- compile-feature-spec: bounded specifications for unclear feature work.
- sync-docs-issues and capture-project-learnings: keep verified documentation current; external writes still require session authorization.

Read only the skills relevant to the work. System-provided skills remain system-owned. See docs/agent-tooling.md for import provenance, local adaptations, and integrity checks.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
