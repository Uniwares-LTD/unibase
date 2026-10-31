---
name: sync-docs-issues
description: "Updates canonical documentation, the source map and issue evidence to match verified work. Use after a change is implemented and reviewed, or when docs, links or issue evidence are out of date."
---

Use the task's existing Handbook path and full revision. Only if no baseline is
recorded, run `npm run handbook:check` (or `node scripts/handbook.mjs check`).
Read `docs/bootstrap.md`, `docs/work-policy.md` and
`.agents/skills/sync-docs-issues/SKILL.md` with `git -C PATH show REVISION:FILE`.
Read this project's guidance, source map and preferences declared in `handbook.json`.
Resolve all shared references at that same revision; use `resources --revision SHA`
through the launcher for filesystem assets. Never substitute the mutable checkout.
Retain path/revision in handoffs and resume summaries. If lost, recover from context
first; otherwise establish a new baseline and report the discontinuity.
If unavailable, continue under local guidance and pause only dependent decisions.
<!-- handbook-managed:3a76d005a59945280aa44af4866eab0ad82b47268ad4785f7bd7e930a5799f3e -->
