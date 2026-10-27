---
name: capture-project-learnings
description: "Capture verified reusable knowledge in canonical docs or skill proposals without creating redundant work logs."
---

Use the task's existing Handbook path and full revision. Only if no baseline is
recorded, run `npm run handbook:check` (or `node scripts/handbook.mjs check`).
Read `docs/bootstrap.md`, `docs/work-policy.md` and
`.agents/skills/capture-project-learnings/SKILL.md` with `git -C PATH show REVISION:FILE`.
Read this project's guidance and source map declared in `handbook.json`.
Resolve all shared references at that same revision; use `resources --revision SHA`
through the launcher for filesystem assets. Never substitute the mutable checkout.
Retain path/revision in handoffs and resume summaries. If lost, recover from context
first; otherwise establish a new baseline and report the discontinuity.
If unavailable, continue under local guidance and pause only dependent decisions.
<!-- handbook-managed:3592295d8dc3bff2814ae868822e91db9694d068ff8c90d391280861e2be178a -->
