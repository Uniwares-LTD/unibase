---
name: compile-feature-spec
description: Turn an unclear feature or documentation outcome into a bounded implementation-ready specification; stay read-only.
---

Use this repository's handbook baseline for the current task. If none is resolved,
run `npm run handbook:check` from the repository root (or `node scripts/handbook.mjs check`).
Read `.agents/skills/compile-feature-spec/SKILL.md` from the returned handbook path and revision
using `git -C <path> show <revision>:.agents/skills/compile-feature-spec/SKILL.md`.
Resolve its policy, role and resource references inside that same handbook revision.
Read this consumer's [repository adapter](../../repository-adapter.md) for local contracts.

Cached guidance is usable; mention refresh limitations briefly when relevant. If no
baseline is available, continue under local guidance and pause only handbook-dependent
decisions. Do not treat this entrypoint as permission to create issues, publish or deploy.
