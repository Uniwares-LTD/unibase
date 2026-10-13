---
name: review-change
description: Perform an independent read-only review of a proposed code or documentation change. Use after implementation or when explicitly asked to review a diff; do not edit, publish, or manage issue state.
---

# Review Change

Read the repository adapter, task contract, plan, complete diff against the intended
base, relevant code and tests, live issue acceptance criteria when applicable, and
validation evidence. Follow `.agents/agents/reviewer.md`.

Prioritize correctness, regressions, unsafe behavior, missing acceptance criteria,
public or persisted contract compatibility, production/test/documentation gaps,
and unnecessary parallel abstractions where a suitable existing surface should be
extended. Identify validation that is missing or stale because relevant inputs
changed, and require affected checks after every correction. Leave documentation
reconciliation to `sync-docs-issues`.

Return only actionable defects, ordered by severity, with stable IDs, precise
evidence, affected paths, and bounded corrections. Keep style preferences and
optional improvements as non-blocking notes. Return `Pass` when no actionable
defect remains; distinguish verified results from missing evidence.

When a change-surface forecast exists, the change is risky or cross-cutting, the
plan materially changed, or the user requests it, finish with a compact
`Final comparison`. Compare forecast or plan with the actual reviewed diff for
changed and unchanged surfaces, acceptance-criteria coverage, validation,
documentation impact, material divergence, and residual risk. Mark each relevant
category `Matched` or `Diverged`. Harmless variance is a non-blocking note.
Report missing or stale validation and explain its practical limit. An advisory
check failure is not an automatic release gate. Call out divergence when it exposes
an actionable defect, missing required documentation or a material contract gap.
A localized low-risk change may omit this comparison.

Stay read-only: never correct the diff, commit, push, publish, merge, close issues,
or change project metadata.

For repository reuse changes, review initializer source/destination isolation and
secret exclusions, module admission versus visibility, accepted adapter versions,
scoped pagination, quota/reference transactions and outbox replay behavior. For
localized UI, include client navigation, dictionary completeness, RTL and document
nonce behavior. Use the repository adapter's checks and current service contracts.
