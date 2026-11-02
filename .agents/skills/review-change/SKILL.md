---
name: review-change
description: "Reviews a code or documentation diff read-only against its task contract, acceptance criteria and verification evidence. Use when asked to review a change, branch, PR or diff, or after implementing and before handoff."
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
`.agents/skills/review-change/SKILL.md` with `git -C PATH show REVISION:FILE`.
Read this project's guidance, source map and preferences declared in `handbook.json`.
Resolve all shared references at that same revision; use `resources --revision SHA`
through the launcher for filesystem assets. Never substitute the mutable checkout.
Retain path/revision in handoffs and resume summaries. If lost, recover from context
first; otherwise establish a new baseline and report the discontinuity.
If unavailable, continue under local guidance and pause only dependent decisions.
<!-- handbook-managed:ebe1d37094b09c717f5fa71db2987ab00d7ae809ec28207c99394cfccb616374 -->
