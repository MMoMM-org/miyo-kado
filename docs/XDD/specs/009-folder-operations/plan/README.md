# Implementation Plan: 009-folder-operations

Branch: `feat/folder-operations`. TDD throughout — a failing test precedes each
behaviour (RED → GREEN → REFACTOR). Commit after each phase. Phases are ordered
so the low-risk, self-contained win (implicit create) lands first and the
policy-heavy work (RBAC neutrality) last.

Legend: `pending` | `in_progress` | `completed`

---

## Phase 1 — Implicit parent creation on write  · `completed` (2026-07-07)
Covers FR-1. Smallest, independent, immediately useful.

- **T1.1** ✅ RED: `test/obsidian/ensure-parent-folder.test.ts` (helper unit
  tests) + adapter wiring tests in `note-adapter.test.ts` / `file-adapter.test.ts`.
  **Deviation from the drafted approach:** rather than make the shared mock
  stateful (teach `vault.create` to throw on a missing parent + model a folder
  tree — risky ripple across 1600 tests), non-vacuity is secured by (a) a
  dedicated helper test with realistic `adapter.exists`/`createFolder` behaviour
  and (b) an **ordering assertion** in each adapter test (`createFolder`'s
  invocation order < `create`'s) — this fails if `ensureParentFolder` is absent
  or called after the write. Global mock change limited to adding `createFolder`.
- **T1.2** ✅ GREEN: `src/obsidian/ensure-parent-folder.ts`
  (`ensureParentFolder(app, path)` = `exists`→`createFolder`, race-catch; reuses
  `parentDir` from `core/rename-policy`). Called in `createNote` (`note-adapter`)
  and `writeFile` (`file-adapter`) before create.
- **T1.3** ✅ REFACTOR: audit-log folder creation (`src/main.ts`) now calls the
  shared helper (DRY — one implementation for adapters + logger).
- **T1.4** ✅ Verify: `npm run build` clean; `eslint src/` clean; full suite
  **1602 passed**; touched test files typecheck-clean under an obsidian→mock
  alias (the bare-tsc `App` 2345 flood is a resolution artifact — the project
  only typechecks `src/**`, so tests are checked against the mock at runtime).
- **Exit:** ✅ writes auto-create parents; audit logger uses the one helper.

  > **Not yet live-verified** (deferred to Phase 5 / T5.1): confirm in a real
  > vault that a `kado-write` into a genuinely missing folder creates it — mocked
  > tests assert the call sequence, not Obsidian's real `createFolder` semantics.

## Phase 2 — Folder-aware delete (empty only)  · `completed` (2026-07-07)
Covers FR-3. No RBAC subtlety (empty ⇒ no descendants), so it lands before rename.

**Design refinement (vs the drafted "infer folder from resolved type"):** the
delete tool is `operation`-dispatched and extension-strict, so inferring a folder
from the path type would have meant abusing `operation='file'` on a non-`.md`
folder path — hacky and undiscoverable for a destructive op. Chosen instead: an
explicit **`operation: 'folder'`** (new `DeleteDataType` member). Permission has
no per-folder dimension, so a folder delete is authorized as a **synthetic
`note.delete` at the folder path** via `src/core/folder-policy.ts`
(`evaluateFolderDeletePermissions`) — the rename-policy/graph-policy pattern,
**zero new gates**. `expectedModified` is not required for folders (a folder has
no mtime; empty-only is the safety, and concurrency is inert because
`getFileMtime` returns undefined for a folder path). Audit records it as a `note`
op (`extractDataType`).

- **T2.1** ✅ RED then GREEN: `delete-adapter.test.ts` (+4) — empty → trashed;
  non-empty → `VALIDATION_ERROR "not empty"`; missing → `NOT_FOUND`; path is a
  file → `VALIDATION_ERROR "not a folder"`.
- **T2.2** ✅ GREEN: `createFolderDeleteAdapter` (`getAbstractFileByPath` →
  `instanceof TFolder` → `children.length` check → `fileManager.trashFile`);
  registered in `main.ts` deleteAdapters; `DeleteDataType += 'folder'`; mapper
  accepts `folder` and skips `expectedModified`; tool schema exposes `folder`;
  handler branches permission through `folder-policy`.
- **T2.3** ✅ Integration: `operation-router.test.ts` (folder route) +
  `tools.test.ts` (`kado-delete handler — folder`: routes without
  expectedModified; FORBIDDEN via the folder-policy gate branch); mapper tests.
- **T2.4** ✅ Verify: build clean; eslint clean; full suite **1614 passed**;
  touched test files typecheck-clean under the obsidian→mock alias.
- **Exit:** ✅ empty folders deletable; non-empty / file / missing safely refused.

  > **Not yet live-verified** (Phase 5 / T5.1): real-vault empty vs non-empty
  > delete, and that `trashFile` on a `TFolder` respects the "Deleted files"
  > setting.

## Phase 3 — Folder-aware rename (in-place, no RBAC check yet)  · `completed` (2026-07-07)
Covers FR-2 mechanics, minus the neutrality invariant (Phase 4).

- **T3.1/T3.2** ✅ `rename-adapter.ts`: source now resolves via
  `getAbstractFileByPath` (was file-only `getFileByPath`), narrowed with
  `instanceof TFolder`/`instanceof TFile`. New `renameFolder` helper: same-parent
  guard (`parentDir(source) !== parentDir(target)` → `VALIDATION_ERROR "in place
  only"`), clobber guard (`CONFLICT`), `fileManager.renameFile(folder, target)`
  (rewrites descendant backlinks natively), result `modified: 0` (folders have no
  mtime). Tests: in-place rename, cross-parent → VALIDATION_ERROR, clobber →
  CONFLICT, missing → NOT_FOUND. **The source-resolution change also required
  updating the existing file-rename tests** (they mocked `getFileByPath`; now
  they provide the source through `getAbstractFileByPath`) — file-rename
  behaviour is unchanged, verified by the same assertions.
- **T3.3** ✅ Permission via `evaluateFolderRenamePermissions` in
  `src/core/folder-policy.ts` — synthetic **note.update** on BOTH source and
  target (a rename is editing; both checked so filename-specific scopes gate).
  Zero new gates. `rename-policy.ts` also coerces a stray `folder` op to `note`
  defensively. Pure unit tests (allow / deny-on-source-first / both-paths-gated).
- **T3.4** ✅ Registration gate + timeout: folder rename is just
  `operation='folder'` on the SAME `kado-rename` tool, so it inherits the
  conditional registration (auto-update-links) and `renameTimeoutMs` guard for
  free — no separate wiring. Mapper accepts `folder`, skips `expectedModified`;
  handler branches permission to the folder policy.
- **T3.5** ✅ Verify: build clean; eslint clean (incl. the obsidianmd
  `no-tfile-tfolder-cast` rule — narrowing via `instanceof`, not casts); full
  suite **1625 passed**; touched test files typecheck-clean under the mock alias.
- **Exit:** ✅ in-place folder rename works and is permission-gated; cross-folder
  move and clobber refused.

  > **Live-verify items (Phase 5 / T5.1):** (1) real-vault folder rename with
  > auto-update-links ON and OFF (descendant backlink rewrite; dialog/timeout);
  > (2) **known timeout-path gap** — on the auto-update-links-OFF timeout branch
  > the handler confirms success via `getFileMtime(target)`, which returns
  > undefined for a *folder* (it is file-only), so a folder rename that actually
  > succeeded could be reported as `TIMEOUT`. Harmless when auto-update is on
  > (the default, and the only state where rename is registered by default);
  > revisit if folder rename is enabled with auto-update off.

## Phase 4 — RBAC permission-neutral invariant  · `pending`
Covers FR-4 / C-4 / ADR-4 — the policy core.

- **T4.1** RED: pure-core tests for the neutral diff over
  `[folder] ∪ descendants`: identical governing scope → allow; a descendant
  crossing into a different rule (per-key AND global) → block with the boundary
  named. Table-drive with whitelist and blacklist rule sets.
- **T4.2** GREEN: implement the diff in `core/rename-policy.ts` consuming
  `resolveScope` (`src/core/gates/scope-resolver.ts`) for source vs rewritten
  target paths; compare governing pattern id + access level. Wire it into the
  folder rename branch before execution.
- **T4.3** Assert the config object is never mutated (spy / deep-freeze the
  config in a test).
- **T4.4** Verify: build + tsc(test) + full suite green.
- **Exit:** boundary-crossing renames blocked with a clear message; neutral
  renames pass untouched; RBAC config immutable.

## Phase 5 — Docs, live-verify, release wiring  · `pending`

- **T5.1** Live-test in a real vault (mocked tests missed the file-rename hang —
  same risk here): confirm (a) write into a new folder, (b) folder rename with
  auto-update-links ON and OFF (dialog/timeout + backlink rewrite for
  descendants), (c) empty vs non-empty delete, (d) an RBAC-crossing rename
  blocks. Record findings back into `solution.md` if behaviour differs.
- **T5.2** Update `docs/api-reference.md`, `docs/permissioning-for-pkm.md`, and
  `README.md` (folder behaviour of write/rename/delete; the empty-only and
  in-place constraints; the block-not-migrate RBAC rule).
- **T5.3** Update spec README status → Implemented; link the PR/issue; add any
  live-test ADR refinements (mirror the 008 pattern).
- **T5.4** Conventional-commit history reviewed; ensure the squash subject
  reflects a `feat` (folder operations) for semantic-release.

---

## Risks & notes
- **Mock fidelity (Phase 1):** the current `obsidian` mock stubs `create` as a
  bare `vi.fn()`; without teaching it the missing-parent throw, Phase 1 tests
  pass vacuously. Fix the mock first.
- **Dialog hang (Phase 3/5):** folder rename shares the file-rename modal-hang
  risk; do not mutate the vault setting — reuse the guard and live-verify.
- **`resolveScope` reuse (Phase 4):** consume it, do not fork glob logic —
  `isPathPermittedForKey`/`resolveScope` are the single source of match logic.
- **Sequencing:** Phases 1–2 are independent and could ship as their own PR
  ahead of 3–4 if a smaller increment is preferred.
