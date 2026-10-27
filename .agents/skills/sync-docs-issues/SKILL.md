---
name: sync-docs-issues
description: "Reconcile canonical documentation and issue evidence with verified work; do not create issues or accept completion."
---

Use the task's existing Handbook path and full revision. Only if no baseline is
recorded, run `npm run handbook:check` (or `node scripts/handbook.mjs check`).
Read `docs/bootstrap.md`, `docs/work-policy.md` and
`.agents/skills/sync-docs-issues/SKILL.md` with `git -C PATH show REVISION:FILE`.
Read this project's guidance and source map declared in `handbook.json`.
Resolve all shared references at that same revision; use `resources --revision SHA`
through the launcher for filesystem assets. Never substitute the mutable checkout.
Retain path/revision in handoffs and resume summaries. If lost, recover from context
first; otherwise establish a new baseline and report the discontinuity.
If unavailable, continue under local guidance and pause only dependent decisions.
<!-- handbook-managed:11f64d47c378193a771fe632d3569d2071f74424c3bf0a22aa38382e73761eff -->
