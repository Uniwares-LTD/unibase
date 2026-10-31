---
name: maintain-project
description: "Adopts the Handbook in a repository or reconciles an existing integration: local guidance, source map, selected skills, tracking setup and organization access. Use when onboarding a repository, updating its Handbook integration, or setting up project tracking or team access."
---

Use the task's existing Handbook path and full revision. Only if no baseline is
recorded, run `npm run handbook:check` (or `node scripts/handbook.mjs check`).
Read `docs/bootstrap.md`, `docs/work-policy.md` and
`.agents/skills/maintain-project/SKILL.md` with `git -C PATH show REVISION:FILE`.
Read this project's guidance, source map and preferences declared in `handbook.json`.
Resolve all shared references at that same revision; use `resources --revision SHA`
through the launcher for filesystem assets. Never substitute the mutable checkout.
Retain path/revision in handoffs and resume summaries. If lost, recover from context
first; otherwise establish a new baseline and report the discontinuity.
If unavailable, continue under local guidance and pause only dependent decisions.
<!-- handbook-managed:14c65b0650839a2aba61241c09395b2c025ab5785e8cbaa134b73156c73bff34 -->
