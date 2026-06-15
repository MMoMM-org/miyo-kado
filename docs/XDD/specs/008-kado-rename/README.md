# Specification: 008-kado-rename

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-06-15 |
| **Current Phase** | Implemented (retrospective spec) |
| **Last Updated** | 2026-06-15 |
| **Tracking** | _to be linked to the kado-rename PR / issue_ |

> **Retrospective note.** This spec was authored *after* implementation to close the
> CONSTITUTION Code Quality L1 spec-traceability requirement. The feature was built
> from a design dialogue with the user; this document captures the agreed intent,
> contract, and decisions so the change traces to an approved spec. The supporting
> decision record is `docs/ai/memory/decisions.md` (2026-06-14).

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | completed | Captures intent + acceptance criteria |
| solution.md | completed | Contract, permission policy, ADRs |
| plan/ | n/a | Implemented before the retrospective spec; see commit history |

**Status values**: `pending` | `in_progress` | `completed` | `skipped`

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-14 | One tool, two modes inferred from paths (no flag) | Same parent ⇒ rename, different parent ⇒ move; fewer params, less error surface (YAGNI) |
| 2026-06-14 | Rename → `update`; move → `delete`(source)+`create`(target) | Mirrors the trust boundary: in-folder rename is editing; cross-folder move leaves one scope and enters another |
| 2026-06-14 | Policy composes the existing gate chain over synthetic single-path requests | Zero new gates; global-scope/key-scope/path-access/datatype-permission enforce on both paths automatically |
| 2026-06-14 | Execute via `app.fileManager.renameFile`, never `vault.rename`/`adapter.rename` | Only the fileManager API rewrites inbound `[[wikilinks]]`/markdown links; raw rename breaks backlinks |
| 2026-06-14 | `expectedModified` guards the source; refuse to clobber an existing target | Optimistic concurrency mirrors delete; CONFLICT on occupied target |
| 2026-06-14 | Backlink rewrites across scope boundaries are an accepted disclosure boundary | Unavoidable (Obsidian updates links vault-wide); changes references, not content |
| 2026-06-15 | Review follow-ups (code-review workflow) | Adapter hardening (missing target folder → VALIDATION_ERROR, race → CONFLICT), case-only rename support, path canonicalization at the mapper, policy extracted to `core/rename-policy.ts`, integration + root-level + NaN-guard tests added |
