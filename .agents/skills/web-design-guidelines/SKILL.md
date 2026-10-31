---
name: web-design-guidelines
description: "Review UI code for Web Interface Guidelines compliance. Use when asked to \"review my UI\", \"check accessibility\", \"audit design\", \"review UX\", or \"check my site against best practices\"."
argument-hint: "<file-or-pattern>"
---

Use the task's existing Handbook path and full revision. Only if no baseline is
recorded, run `npm run handbook:check` (or `node scripts/handbook.mjs check`).
Read `docs/bootstrap.md`, `docs/work-policy.md` and
`.agents/skills/web-design-guidelines/SKILL.md` with `git -C PATH show REVISION:FILE`.
Read this project's guidance, source map and preferences declared in `handbook.json`.
Resolve all shared references at that same revision; use `resources --revision SHA`
through the launcher for filesystem assets. Never substitute the mutable checkout.
Retain path/revision in handoffs and resume summaries. If lost, recover from context
first; otherwise establish a new baseline and report the discontinuity.
If unavailable, continue under local guidance and pause only dependent decisions.
<!-- handbook-managed:ba2e7e1787f814b2ce32de2770ac28525f459788b9756eec5bd43efd778c756d -->
