# Solution: 009-folder-operations

## Design principle

Folders are containers without content, so their operations map onto the
**existing** file operations rather than a new subsystem:

| Operation | Request shape vs file | Kado handling |
|-----------|----------------------|---------------|
| create    | different (no `content`) | **implicit** `mkdir -p` on write |
| rename    | identical (`source`+`target`) | folder branch in rename adapter |
| delete    | identical (`path`) | folder branch in delete adapter |

The invariant: **no new tool, no new gate, no parallel folder-CRUD.** Rename and
delete already carry the right request contract; only source *resolution* changes
(`getAbstractFileByPath` instead of the file-only `getFileByPath`).

## Contract

### C-1 Write (implicit parent creation)
`createNote` (`src/obsidian/note-adapter.ts:300`) and `writeFile`
(`src/obsidian/file-adapter.ts:62`) ensure the target's parent chain exists
before `vault.create` / `vault.createBinary`:

```
const dir = parentDir(request.path);
if (dir && !(await adapter.exists(dir))) {
    await vault.createFolder(dir).catch(() => {/* already exists (race) */});
}
```

A shared helper `ensureParentFolder(app, path)` (new, in `src/obsidian/`) holds
this so both adapters and the audit logger use one implementation (DRY — the
audit logger at `src/main.ts:112` is refactored to call it). `createFolder`
creates intermediate folders recursively, so a single call covers `A/B/C`.

No behavioural change on an existing path: the pre-existing `CONFLICT` guard
(`getFileByPath(path)` is non-null) still fires first.

### C-2 Rename (folder branch, in-place only)
In `createRenameAdapter` (`src/obsidian/rename-adapter.ts`):

1. Resolve `const src = app.vault.getAbstractFileByPath(request.source)`.
   - `null` → `NOT_FOUND` (unchanged).
   - `TFile` → existing file path (unchanged).
   - `TFolder` → folder path (new).
2. Folder path:
   - `parentDir(source) !== parentDir(target)` → `VALIDATION_ERROR`
     ("cannot move folders — rename in place only").
   - Target occupied by anything other than `src` → `CONFLICT`.
   - RBAC permission-neutral check (C-4) → `VALIDATION_ERROR` on mismatch.
   - `await app.fileManager.renameFile(src, request.target)` — works on `TFolder`
     and rewrites all inbound backlinks for every descendant.

The existing "missing target parent folder" guard is irrelevant for in-place
folder rename (parent is unchanged) but stays for the file path.

### C-3 Delete (folder branch, empty only)
A new `createFolderDeleteAdapter` (or a `TFolder` branch shared by the note/file
delete adapters in `src/obsidian/delete-adapter.ts`):

1. Resolve via `getAbstractFileByPath`.
2. `TFolder` with `children.length > 0` → `VALIDATION_ERROR` ("Folder not
   empty").
3. Empty `TFolder` → `await app.fileManager.trashFile(folder)` (respects the
   user's "Deleted files" setting, same as note/file delete).

No subtree gating: an empty folder has no descendants, so the single
folder-path permission check is complete.

### C-4 RBAC permission-neutral invariant (the core policy)
A folder rename rewrites every descendant path `source/rel → target/rel`. Access
in Kado is path-keyed (per-key scope + global security), so a rewrite can move
content across a permission boundary. Policy — **fail-closed, never migrate:**

```
for each path p in [folder] ∪ descendants(folder):
    let p' = target + p.slice(source.length)          // rewritten path
    if resolveScope(p , key) ≢ resolveScope(p', key)  // per-key scope
    or resolveScope(p , global) ≢ resolveScope(p', global):  // global security
        → VALIDATION_ERROR naming p → p' and the differing rule
```

`≢` compares the governing pattern id AND its access level (`resolveScope`
already picks the most-specific match — decision 2026-05-09). Identical governing
scope on both sides → permitted. The common case (whole subtree under one rule)
is neutral → allowed with zero friction; only a genuine boundary crossing blocks.

Kado never writes the RBAC config: the permission declaration is the single
source of truth, and a data operation must not silently escalate or drop access.
The user consciously edits their config and retries if they want the crossing.

### C-5 Permission (who may operate)
Composed over the existing gate chain via synthetic requests
(`evaluatePermissions`, rename-policy pattern — zero new gates):

- **Folder rename** → `update` on the folder path (in-place, so source parent ==
  target parent; a single `update` check on the folder path is sufficient, with
  C-4 covering descendant neutrality).
- **Folder delete** → `delete` on the folder path.
- **Implicit parent create** → no extra check; the parent of a path the caller
  may already write is within the permitted scope.

FORBIDDEN denials stay existence-silent, consistent with the rest of Kado.

## ADRs

### ADR-1 — Reuse tools, branch adapters on file type
**Decision:** No `kado-mkdir`/`kado-rmdir`/`kado-mvdir`. `kado-write` gains
implicit `mkdir -p`; `kado-rename`/`kado-delete` resolve with
`getAbstractFileByPath` and branch on `TFolder`.
**Why:** rename/delete request contracts are byte-identical for files and
folders; only resolution differs. A new tool would also require a Tomo-side MCP
registration change for no ergonomic gain. Matches the existing "same operation,
adapter picks by type" pattern (note vs binary).
**Rejected:** dedicated folder tools (surface bloat, cross-repo coupling);
`content:''` on write to mean "folder" (footgun, ambiguous validation).

### ADR-2 — Create is implicit, not an operation
**Decision:** No explicit empty-folder create. Folders come into existence only
as parents of a written file.
**Why:** the real need is "write a note into a new folder"; an empty folder has
no PKM use. YAGNI. If a genuine need appears later, prefer a `type:'folder'`
discriminator on write over a new tool.

### ADR-3 — Delete only empty; rename only in-place
**Decision:** Non-empty delete → `VALIDATION_ERROR`; cross-folder move →
`VALIDATION_ERROR`.
**Why (delete):** empty-only removes recursive subtree gating — the single
hardest part — while covering the safe, common case. Recursive delete over
mixed-permission descendants is a much larger, separately-justified feature.
**Why (rename):** in-place keeps the blast radius to one path segment and makes
the permission-neutral diff tractable; cross-folder folder *moves* are a
non-goal.

### ADR-4 — Block on RBAC change, never auto-migrate
**Decision:** A rename that changes any descendant's governing scope is blocked
(`VALIDATION_ERROR`); the RBAC config is never rewritten.
**Why:** the config is user-declared intent and the single source of truth.
Rewriting a security policy as a side effect of a data operation is surprising,
ambiguous (which rules? globs? deny rules?), and a latent privilege-leak source.
An LLM-driven MCP call must not move a trust boundary without a human in the
loop. Fail-closed matches Kado's existing "refuse rather than guess" posture
(rename won't clobber → CONFLICT; delete only if empty).
**Rejected:** auto-migrate matching rules (couples permission layer to data
layer, ambiguous, unsafe); allow-with-warning (LLM callers ignore warnings — the
worst option for a security boundary).

### ADR-5 — Folder rename inherits the auto-update-links guard
**Decision:** Register folder rename behind the same condition as file rename and
bound it with `renameTimeoutMs`.
**Why:** `fileManager.renameFile` pops the same blocking "update links?" modal
for a folder when Obsidian's auto-update-links is off (decision 2026-06-15);
mocked tests missed it for files and will miss it for folders. Reuse the guard;
do not mutate the vault setting. On timeout, apply the same live-verified
"file already moved, links pending" success semantics.

## Touched code (anticipated)

- `src/core/rename-policy.ts` — `renameMode`/`parentDir` reuse; folder in-place
  classification; the permission-neutral diff helper (pure).
- `src/core/gates/scope-resolver.ts` — reuse `resolveScope` for the neutrality
  check (no change expected; consumed, not modified).
- `src/obsidian/ensure-parent-folder.ts` — **new** shared `mkdir -p` helper.
- `src/obsidian/note-adapter.ts`, `src/obsidian/file-adapter.ts` — call the
  helper before create.
- `src/obsidian/rename-adapter.ts` — `getAbstractFileByPath` + `TFolder` branch.
- `src/obsidian/delete-adapter.ts` — `TFolder` empty-only branch.
- `src/mcp/tools.ts` — folder dispatch in the rename/delete handlers; reuse
  `evaluateRenamePermissions`-style composition; folder-rename registration gate.
- `src/main.ts:112` — refactor the audit-log folder creation to the shared helper.
- Types in `src/types/canonical.ts` if a `TFolder` result discriminator is needed.
