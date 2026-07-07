# Requirements: 009-folder-operations

## Goal

Let an MCP client create, rename, and delete vault **folders** through Kado's
existing tools, with the same permission discipline as file operations, and
without silently changing the vault's access policy.

## User intent (verbatim design points)

1. **Create** — "we don't need a create-folder tool; writing a note into a
   missing folder should just create the folder." → implicit `mkdir -p` on write.
2. **Delete** — "only if empty, otherwise a corresponding error." → no recursive
   delete.
3. **Rename** — "only the current folder, not the path": `/test/alt → /test/neu`
   is allowed, `/test/alt → /neu/alt` is not; plus the caller needs `rename`
   rights in `/test`. Links are not the problem (Obsidian handles them).
4. **RBAC** — a rename rewrites descendant paths, which could change their
   effective permissions. Decision: **block** with a message, do **not** rewrite
   the RBAC config.

## Functional requirements

### FR-1 — Implicit parent creation on write
- `kado-write` (note and binary) MUST create any missing parent folders of the
  target path before writing, mirroring the audit-logger pattern
  (`adapter.exists(dir)` → `vault.createFolder(dir)`).
- No new parameter, no new tool, no explicit empty-folder create operation.
- Parent creation is scoped to a path the caller is already permitted to write;
  it grants no access the write itself did not already have.

### FR-2 — Folder-aware rename (in-place only)
- `kado-rename` MUST resolve the source via `getAbstractFileByPath` and, when it
  is a `TFolder`, perform an in-place folder rename.
- MUST reject a cross-folder move of a folder with `VALIDATION_ERROR`
  ("cannot move folders — rename in place only") when
  `parentDir(source) !== parentDir(target)`.
- MUST refuse to clobber an existing target (`CONFLICT`), consistent with file
  rename.
- MUST require `update` permission resolved on the parent scope (compose the
  existing gate chain; zero new gates).
- MUST enforce the RBAC permission-neutral invariant (see FR-4).
- MUST inherit the auto-update-links confirmation-dialog guard used by file
  rename (conditional registration + `renameTimeoutMs`).

### FR-3 — Folder-aware delete (empty only)
- `kado-delete` MUST resolve the path via `getAbstractFileByPath` and, when it is
  a `TFolder`, delete it via `fileManager.trashFile`.
- MUST reject a non-empty folder with `VALIDATION_ERROR` ("Folder not empty")
  when `folder.children.length > 0`. No recursive delete.
- MUST require `delete` permission resolved on the folder path (compose the gate
  chain; zero new gates). No subtree evaluation is needed because the folder is
  empty.

### FR-4 — RBAC permission-neutral rename invariant
- Before executing a folder rename, for the folder itself and every descendant,
  compute the governing scope at the **source** path and at the rewritten
  **target** path (`resolveScope`, most-specific match — decision 2026-05-09),
  for the acting key's scope **and** the global security scope.
- If any pair differs (different governing pattern or different access level) →
  `VALIDATION_ERROR` naming the boundary (e.g. "rename blocked: `/test/neu/a.md`
  would fall under a different permission rule than `/test/alt/a.md`").
- Kado MUST NOT rewrite, add, or remove any RBAC rule as a side effect.

## Non-functional / constraints

- **No new MCP tool** and no change to the Tomo-side tool registry.
- **Zero new permission gates** — reuse `evaluatePermissions` over synthetic
  single-path requests (rename-policy / graph-policy pattern).
- **Clean architecture** — pure policy (parent-derivation, permission-neutral
  diff) lives in `core/`; Obsidian API calls stay in `obsidian/` adapters.
- **TDD** — a failing unit test precedes each behaviour; live-verify the
  dialog/timeout and backlink-rewrite paths in a real vault (mocked tests missed
  the file-rename hang; folder rename shares that risk).

## Acceptance criteria

- [ ] Writing `A/B/C/note.md` when `A/B/C` does not exist creates the folders and
      the note; a second write to the same path returns `CONFLICT` (unchanged).
- [ ] Renaming a folder `/test/alt → /test/neu` succeeds, updates backlinks, and
      returns the folder result; descendant notes are reachable at their new
      paths.
- [ ] Renaming a folder `/test/alt → /neu/alt` returns `VALIDATION_ERROR`
      (cannot move folders).
- [ ] Renaming a folder to an existing target returns `CONFLICT`.
- [ ] Renaming a folder whose descendants would change governing scope returns
      `VALIDATION_ERROR` naming the boundary; the RBAC config is untouched.
- [ ] Deleting an empty folder trashes it; deleting a non-empty folder returns
      `VALIDATION_ERROR "Folder not empty"`.
- [ ] Deleting/renaming a folder the key lacks permission on returns the same
      gate error a file at that path would (FORBIDDEN, no existence leak).
- [ ] `npm run build` clean; `tsc` clean over `test/`; all unit + integration
      tests green; live-verified in a vault.

## Out of scope

- Recursive folder delete or folder move across paths (explicit non-goals).
- Explicit empty-folder creation as a distinct operation/tool.
- Auto-migrating RBAC rules on rename.
