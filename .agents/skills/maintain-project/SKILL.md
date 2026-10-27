---
name: maintain-project
description: "Initialize or reconcile a project's Handbook integration, local guidance, source map and selected shared skills; use for adoption or project maintenance."
---

Use the task's existing Handbook path and full revision. Only if no baseline is
recorded, run `npm run handbook:check` (or `node scripts/handbook.mjs check`).
Read `docs/bootstrap.md`, `docs/work-policy.md` and
`.agents/skills/maintain-project/SKILL.md` with `git -C PATH show REVISION:FILE`.
Read this project's guidance and source map declared in `handbook.json`.
Resolve all shared references at that same revision; use `resources --revision SHA`
through the launcher for filesystem assets. Never substitute the mutable checkout.
Retain path/revision in handoffs and resume summaries. If lost, recover from context
first; otherwise establish a new baseline and report the discontinuity.
If unavailable, continue under local guidance and pause only dependent decisions.
<!-- handbook-managed:262a472d267fe40d17e02eb74106455169c9dfd8d68f730493222f3960c456b4 -->
