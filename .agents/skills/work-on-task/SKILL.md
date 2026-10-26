---
name: work-on-task
description: Implement and verify bounded repository work, then perform a separate read-only review and evidence handoff.
---

Use this repository's handbook baseline for the current task. If none is resolved,
run `npm run handbook:check` from the repository root (or `node scripts/handbook.mjs check`).
Read `.agents/skills/work-on-task/SKILL.md` from the returned handbook path and revision
using `git -C <path> show <revision>:.agents/skills/work-on-task/SKILL.md`.
Resolve its policy, role and resource references inside that same handbook revision.
Read this consumer's [repository adapter](../../repository-adapter.md) for local contracts.

Cached guidance is usable; mention refresh limitations briefly when relevant. If no
baseline is available, continue under local guidance and pause only handbook-dependent
decisions. Do not treat this entrypoint as permission to create issues, publish or deploy.
