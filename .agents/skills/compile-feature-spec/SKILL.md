---
name: compile-feature-spec
description: "Turns an unclear feature, documentation or integration request into a bounded, implementation-ready specification without changing code. Use when a request is vague, before building a feature, or when asked to scope, spec or plan work."
---

Use the task's existing Handbook path and full revision. Only if no baseline is
recorded, run `npm run handbook:check` (or `node scripts/handbook.mjs check`).
Read `docs/bootstrap.md`, `docs/work-policy.md` and
`.agents/skills/compile-feature-spec/SKILL.md` with `git -C PATH show REVISION:FILE`.
Read this project's guidance, source map and preferences declared in `handbook.json`.
Resolve all shared references at that same revision; use `resources --revision SHA`
through the launcher for filesystem assets. Never substitute the mutable checkout.
Retain path/revision in handoffs and resume summaries. If lost, recover from context
first; otherwise establish a new baseline and report the discontinuity.
If unavailable, continue under local guidance and pause only dependent decisions.
<!-- handbook-managed:d4f8678437e25a32f276141750b4e8358647259cbcc1fe385492b4330a502878 -->
