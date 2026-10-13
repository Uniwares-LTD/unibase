---
name: sync-docs-issues
description: Reconcile canonical documentation and GitHub issue evidence with a verified final diff. Use after implementation and review, or when asked to check whether code, docs, and an associated issue remain aligned; do not close issues or manage project fields.
---

# Sync Docs and Issues

Read the repository adapter, final diff, validation evidence, and canonical docs.
Update the nearest canonical source when verified behavior, setup, architecture,
interfaces, constraints, or developer workflow changed. Revise stale guidance and
link instead of duplicating. If no documentation change is needed, record a concise
evidence-based rationale.

Use only documentation relationships, catalogs, or context maps named by the
adapter. Keep them synchronized when their cataloged interface changes. Detect and
correct stale local links, duplicated authority, undocumented generated-artifact
ownership, and temporary guidance that lacks a removal condition. Do not invent new
catalogs or governance layers for repositories that do not configure them.

Use learning capture when there is a useful verified observation beyond the
current-state update. Keep current-state documentation separate from chronological
lessons, and do not record assumptions as facts.

External writes require explicit session authorization; an issue-backed task or
existing PR alone does not authorize comments. If commenting is authorized,
re-fetch the issue and prepare concise evidence: outcome, validation, documentation
impact and the reviewed commit/PR when available. Use an evidence marker only when
the adapter defines one; inspect existing comments to avoid duplicates. Never rewrite the issue
body, close the issue, change labels, assignment, or milestone, or mutate GitHub
Project fields unless separately requested.

For this repository, reconcile generated environment and translation inventories
with their canonical sources. Distinguish the current JSON template catalog from
retained historical YAML fixtures. Validate local links, anchors and actual package
commands through the repository adapter; retain historical evidence as dated evidence.
