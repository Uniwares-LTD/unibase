---
name: capture-project-learnings
description: Capture verified reusable knowledge in canonical docs or skill proposals without creating redundant work logs.
---

Use this repository's handbook baseline for the current task. If none is resolved,
run `npm run handbook:check` from the repository root (or `node scripts/handbook.mjs check`).
Read `.agents/skills/capture-project-learnings/SKILL.md` from the returned handbook path and revision
using `git -C <path> show <revision>:.agents/skills/capture-project-learnings/SKILL.md`.
Resolve its policy, role and resource references inside that same handbook revision.
Read this consumer's [repository adapter](../../repository-adapter.md) for local contracts.

Cached guidance is usable; mention refresh limitations briefly when relevant. If no
baseline is available, continue under local guidance and pause only handbook-dependent
decisions. Do not treat this entrypoint as permission to create issues, publish or deploy.
