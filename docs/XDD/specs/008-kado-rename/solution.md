---
title: "Rename & Move — Solution Design"
status: completed
version: "1.0"
---

# Solution Design Document

> Retrospective SDD — see README.md. Describes the shipped implementation.

## Contract

`kado-rename` arguments:

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `operation` | `"note" \| "file"` | yes | note→`.md`, file→non-`.md` (both paths) |
| `source` | string | yes | current vault-relative path |
| `target` | string | yes | desired path; must not already exist |
| `expectedModified` | number | yes | source mtime from a prior read |

Result: `{ source, target, modified }`. Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`.

Full reference: `docs/api-reference.md` (Tool: kado-rename).

## Architecture

```
mapRenameRequest (mcp/request-mapper)          ← canonicalize paths, validate extensions, reject no-op
  → evaluateRenamePermissions (core/rename-policy) ← two-path policy over the existing gate chain
  → validateConcurrency (core/concurrency-guard)   ← source-mtime optimistic lock
  → router → RenameAdapter (obsidian/rename-adapter) ← fileManager.renameFile
  → mapRenameResult (mcp/response-mapper)
```

- `CoreRenameRequest` carries an explicit `kind: 'rename'` discriminator; it never flows
  through the gate chain directly — the policy composes synthetic single-path requests.
- `RenameAdapter` is registered in `AdapterRegistry`; the router branches on `isCoreRenameRequest`.

## ADRs

**ADR-1 — One tool, mode inferred from paths.** Same parent folder ⇒ rename, different ⇒
move. No `mode` flag. Rationale: minimal schema, no redundant client input.

**ADR-2 — Permission split: rename→`update`, move→`delete`(source)+`create`(target).**
Editing a name is editing the note; moving crosses a trust boundary. Rename checks `update`
on **both** source and target so filename-specific scopes still gate.

**ADR-3 — Compose the existing gate chain over synthetic requests (no new gate).** A
synthetic `CoreWriteRequest` with `expectedModified` ⇒ `update`; without ⇒ `create`; a
synthetic `CoreDeleteRequest` ⇒ `delete`. Reuses global-scope, key-scope, path-access, and
datatype-permission unchanged. Lives in pure `core/rename-policy.ts` (no MCP/SDK imports).

**ADR-4 — Execute via `app.fileManager.renameFile`.** The only API that rewrites inbound
links. Never `vault.rename`/`adapter.rename`. Same "use fileManager, not the adapter"
discipline as delete's `trashFile`.

**ADR-5 — Optimistic concurrency on the source; never clobber.** `expectedModified` mirrors
delete semantics (CONFLICT on mismatch, silent-pass on missing source so the adapter emits
NOT_FOUND). An occupied target ⇒ CONFLICT; a case-only rename (target resolves to the same
TFile) is allowed.

**ADR-6 — Path canonicalization at the mapper.** `normalizePath` is applied to source and
target in `mapRenameRequest` so mode classification, gating, mtime lookup, clobber check,
and the rename call all use the identical string (no raw-vs-normalized divergence).

**ADR-7 — Backlink rewrites across scope are an accepted disclosure boundary.** Obsidian
updates links vault-wide, touching notes the key may not access; this changes references,
not content, and is documented (domain.md / api-reference.md), not redacted.

## Constitution alignment
- Security L1: two-layer check on both paths, fail-fast before any fs op. ✓
- Code Quality L1: policy + adapter in core/obsidian, MCP glue in mcp/. ✓
- Testing L1/L2: per-tool happy + denial, access-control authorization + rejection, and an
  end-to-end integration roundtrip (in-folder rename, denied move, CONFLICT). ✓
- Architecture L2: cross-component contract handed to Kokoro (see `_outbox/for-kokoro/`). ✓
