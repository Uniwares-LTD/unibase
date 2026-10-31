---
name: maintain-docs
description: "Sets up a repository's documentation and templates from the Handbook starters, writes new documents from templates, restructures docs and refreshes local templates on request. Use when setting up docs or templates in a repository, writing a new guide, spec or decision record, reorganizing docs, or updating a template."
---

Use the task's existing Handbook path and full revision. Only if no baseline is
recorded, run `npm run handbook:check` (or `node scripts/handbook.mjs check`).
Read `docs/bootstrap.md`, `docs/work-policy.md` and
`.agents/skills/maintain-docs/SKILL.md` with `git -C PATH show REVISION:FILE`.
Read this project's guidance, source map and preferences declared in `handbook.json`.
Resolve all shared references at that same revision; use `resources --revision SHA`
through the launcher for filesystem assets. Never substitute the mutable checkout.
Retain path/revision in handoffs and resume summaries. If lost, recover from context
first; otherwise establish a new baseline and report the discontinuity.
If unavailable, continue under local guidance and pause only dependent decisions.
<!-- handbook-managed:353e40624c9e9baffae5e5378b6a93aa9a0c689c99c35162bf35647a77826ea5 -->
