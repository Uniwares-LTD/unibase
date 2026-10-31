---
name: capture-project-learnings
description: "Records verified, reusable knowledge in canonical docs or proposes a skill change, without creating work logs. Use when a task revealed a reusable lesson, a guidance gap, or a conflict between guidance and practice."
---

Use the task's existing Handbook path and full revision. Only if no baseline is
recorded, run `npm run handbook:check` (or `node scripts/handbook.mjs check`).
Read `docs/bootstrap.md`, `docs/work-policy.md` and
`.agents/skills/capture-project-learnings/SKILL.md` with `git -C PATH show REVISION:FILE`.
Read this project's guidance, source map and preferences declared in `handbook.json`.
Resolve all shared references at that same revision; use `resources --revision SHA`
through the launcher for filesystem assets. Never substitute the mutable checkout.
Retain path/revision in handoffs and resume summaries. If lost, recover from context
first; otherwise establish a new baseline and report the discontinuity.
If unavailable, continue under local guidance and pause only dependent decisions.
<!-- handbook-managed:822482035df7fb604471df6901c80965e9b658b6a9ee2c4902c1e80d6e72b2eb -->
