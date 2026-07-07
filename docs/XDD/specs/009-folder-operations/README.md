# Specification: 009-folder-operations

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-07-07 |
| **Current Phase** | Implemented (Phases 1–4 shipped + docs); live-verify pending (Phase 5 / T5.1) |
| **Last Updated** | 2026-07-07 |
| **Branch** | `feat/folder-operations` |
| **Tracking** | _to be linked to the folder-operations issue / PR_ |

> **Implementation status.** Phases 1–4 (create / delete / rename / RBAC
> neutrality) are code-complete and unit/integration-tested (full suite green),
> and the user docs are updated. The only remaining item is **T5.1 live-verify**
> in a real Obsidian vault — mocked tests assert call sequences and pure logic,
> not Obsidian's real `createFolder`/`trashFile`/`renameFile` semantics or the
> auto-update-links dialog. See `live-test-checklist.md`.

> **Design origin.** Authored from a design dialogue with the user about how Kado
> should handle vault *folders* (create / rename / delete), which today are not a
> first-class resource — every write/rename/delete adapter resolves paths via the
> file-only `getFileByPath`, so a folder path yields `NOT_FOUND`. The supporting
> decision record is `docs/ai/memory/decisions.md` (2026-07-07).

## Problem

Kado is entirely file-centric. Concretely, before this spec:

- **Create:** `kado-write` calls `vault.create` / `vault.createBinary` directly.
  Obsidian does not auto-create missing parent folders → a write into a
  not-yet-existing folder throws a raw error (no guard, no test coverage).
- **Rename:** `rename-adapter` resolves the source with `getFileByPath` (file
  only) → a folder source returns `NOT_FOUND` ("File not found").
- **Delete:** both delete adapters resolve with `getFileByPath` → a folder path
  returns `NOT_FOUND`.

The only place Kado ever creates a folder is the audit-log directory
(`src/main.ts:112`, `exists`→`vault.createFolder`).

## Approach (one line)

Reuse the existing tools and CRUD contracts; make the adapters folder-aware by
branching on `TFile` vs `TFolder`. No new MCP tool, no parallel folder subsystem.

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | completed | Intent, scope constraints, acceptance criteria |
| solution.md | completed | Contract, permission policy, RBAC invariant, ADRs |
| plan/README.md | completed | Phased TDD implementation plan |

**Status values**: `pending` | `in_progress` | `completed` | `skipped`

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-07 | No new tool; folder ops reuse `kado-write` / `kado-rename` / `kado-delete` | Request contracts are identical (rename/delete) or best solved implicitly (create); a new tool would also force a Tomo-side MCP registration change |
| 2026-07-07 | Create is implicit `mkdir -p` on write; no explicit empty-folder create | Real need is "write a note into a new folder"; empty folders have no PKM use (YAGNI); a `content:''` special-case would be a footgun |
| 2026-07-07 | Delete only when the folder is empty | Sidesteps recursive subtree gating entirely — an empty folder has no descendants to authorize |
| 2026-07-07 | Rename is in-place only (same parent) | `/test/alt → /test/neu` yes, `/test/alt → /neu/alt` no; keeps blast radius to a single segment rename |
| 2026-07-07 | RBAC: block on permission change, never auto-migrate the config | The permission declaration is the single source of truth; a data op must not silently move a privilege boundary. Fail-closed with the boundary named |
| 2026-07-07 | Folder rename inherits the file-rename auto-update-links guard | `fileManager.renameFile` pops the same blocking "update links?" modal for folders; reuse conditional registration + `renameTimeoutMs` (decision 2026-06-15) |
