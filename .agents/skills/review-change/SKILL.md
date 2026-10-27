---
name: review-change
description: "Review a proposed code or documentation diff read-only against its contract, acceptance and verification evidence."
---

Use the task's existing Handbook path and full revision. Only if no baseline is
recorded, run `npm run handbook:check` (or `node scripts/handbook.mjs check`).
Read `docs/bootstrap.md`, `docs/work-policy.md` and
`.agents/skills/review-change/SKILL.md` with `git -C PATH show REVISION:FILE`.
Read this project's guidance and source map declared in `handbook.json`.
Resolve all shared references at that same revision; use `resources --revision SHA`
through the launcher for filesystem assets. Never substitute the mutable checkout.
Retain path/revision in handoffs and resume summaries. If lost, recover from context
first; otherwise establish a new baseline and report the discontinuity.
If unavailable, continue under local guidance and pause only dependent decisions.
<!-- handbook-managed:e58a8b4040ed05806ee887c97a6a6be2bf17457ac037652f3482cb4c6f73d003 -->
