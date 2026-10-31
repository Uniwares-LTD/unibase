---
name: manage-issues
description: "Drafts and creates human-approved issues and keeps status, blockers and evidence current on assigned issues in the recorded tracking project. Use when creating, triaging, enrolling or updating issues, reviewing the board, or recommending the next issue."
---

Use the task's existing Handbook path and full revision. Only if no baseline is
recorded, run `npm run handbook:check` (or `node scripts/handbook.mjs check`).
Read `docs/bootstrap.md`, `docs/work-policy.md` and
`.agents/skills/manage-issues/SKILL.md` with `git -C PATH show REVISION:FILE`.
Read this project's guidance, source map and preferences declared in `handbook.json`.
Resolve all shared references at that same revision; use `resources --revision SHA`
through the launcher for filesystem assets. Never substitute the mutable checkout.
Retain path/revision in handoffs and resume summaries. If lost, recover from context
first; otherwise establish a new baseline and report the discontinuity.
If unavailable, continue under local guidance and pause only dependent decisions.
<!-- handbook-managed:7f7b109dd2ef85278efa83bd3152bc3fa24207c1841fab350419eeadb548b96f -->
