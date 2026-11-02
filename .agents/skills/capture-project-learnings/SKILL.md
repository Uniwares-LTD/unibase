---
name: capture-project-learnings
description: "Records verified, reusable knowledge in canonical docs or proposes a skill change, without creating work logs. Use when a task revealed a reusable lesson, a guidance gap, or a conflict between guidance and practice."
---

Use the task's existing Handbook path and full revision. Only if no baseline is
recorded, run `npm run handbook:check` (or `node scripts/handbook.mjs check`).
If the check reports HANDBOOK_SETUP_REQUIRED, ask once for this task:
"This repo uses Handbook for shared agent guidance. Clone Uniwares-LTD/handbook
into <resolved path>? This sets up this device; the repo is already adopted."
Use the reported destination. An explicit setup request already grants approval.
After approval run npm run handbook:setup with -- --path set to that destination,
quoted for the shell, outside the sandbox. Retain the returned path/revision and
resume the original task. Do not rerun adoption, sync templates or change tracking.
If declined, do not ask again during this task. If setup fails, explain the actual
access, network or filesystem failure and next action; do not repeatedly retry.
In either case continue under local guidance and pause only dependent decisions.
Client permission prompts may still be required.
Read `docs/bootstrap.md`, `docs/work-policy.md` and
`.agents/skills/capture-project-learnings/SKILL.md` with `git -C PATH show REVISION:FILE`.
Read this project's guidance, source map and preferences declared in `handbook.json`.
Resolve all shared references at that same revision; use `resources --revision SHA`
through the launcher for filesystem assets. Never substitute the mutable checkout.
Retain path/revision in handoffs and resume summaries. If lost, recover from context
first; otherwise establish a new baseline and report the discontinuity.
If unavailable, continue under local guidance and pause only dependent decisions.
<!-- handbook-managed:5da2fd9bb0062e9cf17b67ad8b8cde6c5434c315d0bc974a996a50e5c9bca5b1 -->
