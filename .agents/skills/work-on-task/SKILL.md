---
name: work-on-task
description: "Implements and verifies bounded repository work on a work branch, then runs a separate read-only review and hands off evidence. Use when asked to implement, fix, build or change something for an issue or task, or to work on an issue number."
---

Use the task's existing Handbook path and full revision. Only if no baseline is
recorded, run `npm run handbook:check` (or `node scripts/handbook.mjs check`).
Read `docs/bootstrap.md`, `docs/work-policy.md` and
`.agents/skills/work-on-task/SKILL.md` with `git -C PATH show REVISION:FILE`.
Read this project's guidance, source map and preferences declared in `handbook.json`.
Resolve all shared references at that same revision; use `resources --revision SHA`
through the launcher for filesystem assets. Never substitute the mutable checkout.
Retain path/revision in handoffs and resume summaries. If lost, recover from context
first; otherwise establish a new baseline and report the discontinuity.
If unavailable, continue under local guidance and pause only dependent decisions.
<!-- handbook-managed:3f31b59ce668ca9f3d055196fc264b936cab52c017063de3430349b5aebfa947 -->
