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
  > (2) **timeout-path gap — FIXED in Phase 5** (the existence check now uses
  > `getAbstractFileByPath`, not the file-only `getFileMtime`).

## Phase 4 — RBAC permission-neutral invariant  · `completed` (2026-07-07)
Covers FR-4 / C-4 / ADR-4 — the policy core.

**Refinement (vs the draft):** the neutral diff compares the **effective resolved
permissions** (`resolveScope` output) at source vs rewritten-target, not a
"governing pattern id" — comparing the access *outcome* is the correct security
question (two different rules that yield identical access are neutral and must
not block). Landed in `folder-policy.ts` (not `rename-policy.ts`) beside the
other folder policy.

- **T4.1/T4.2** ✅ Pure `checkFolderRenameScopeNeutral(source, target, paths,
  config, key)` in `src/core/folder-policy.ts`: for the folder and every
  descendant path `p`, rewrites `p' = target + p.slice(source.length)` and
  compares `resolveScope` for `p` vs `p'` under BOTH global security AND the key's
  scope (`permissionsEqual` handles null-vs-object and all CRUD flags). First
  mismatch → `VALIDATION_ERROR` (gate `folder-scope-neutrality`) naming `p → p'`
  and which scope differs. Descendant enumeration is the obsidian helper
  `src/obsidian/folder-tree.ts` (`collectFolderTreePaths`, `instanceof TFolder`
  walk). Wired into the rename handler AFTER base permission, BEFORE routing.
- **T4.1 tests** ✅ unit (whitelist leave-rule → block naming `global security`;
  key-scope whitelist → block naming `the key's`; broad rule / blacklist →
  allowed) + folder-tree walk tests + two handler integration tests (cross-
  boundary blocked & router not called; neutral tree allowed & routed).
- **T4.3** ✅ Immutability asserted both at unit level (`JSON.stringify` before/
  after) and handler level (config unchanged after a blocked rename).
- **T4.4** ✅ Verify: build clean; eslint clean; full suite **1636 passed**;
  touched test files typecheck-clean under the mock alias.
- **Exit:** ✅ boundary-crossing renames blocked with a clear, boundary-naming
  message; neutral renames pass untouched; RBAC config never mutated.

  > **Live-verify (Phase 5 / T5.1):** exercise a real vault where a key/global
  > rule references the old folder name, confirm the rename blocks and the config
  > file is byte-identical afterward; confirm the common (neutral) rename is
  > frictionless.

## Phase 5 — Docs, live-verify, release wiring  · `in_progress` (docs done; live-verify pending)

- **T5.1** ✅ **Live-verified** in a real vault via `test/live/folder-ops-live.test.ts`
  (7/7 pass, two-layer MCP + on-disk): mkdir-p create, non-empty delete refused,
  empty delete trashed (gone on disk), delete-on-a-file → "not a folder", delete
  missing → NOT_FOUND, in-place rename (descendant moved on disk), cross-parent
  rename refused. **Live-found bug (mocks missed it):** the delete/rename handler
  ran optimistic concurrency for `operation='folder'` too; when the path resolved
  to a real FILE, `getFileMtime` returned its mtime and `expectedModified=0`
  produced a spurious `CONFLICT` before the adapter could return "not a folder"
  (mocked handler tests used `getFileMtime → undefined`, so it never surfaced).
  Fix: skip optimistic concurrency for `operation='folder'` in both handlers
  (`src/mcp/tools.ts`) + regression unit tests.
  **RBAC permission-neutral block — live-verified 2026-07-08** with a read-only
  second key (`allowed/**` full + `allowed/rbac-demo/guarded/sub` read-only,
  fixture `test/MiYo-Kado/allowed/rbac-demo/`): `neutral → neutral-x` ALLOWED;
  `guarded → guarded-x` BLOCKED (`VALIDATION_ERROR folder-scope-neutrality`,
  message names `…/guarded/sub → …/guarded-x/sub` + "the key's" scope); `data.json`
  byte-identical afterward (not migrated). A wording polish landed from that run
  (the message read "a different the key's permission rule").
  **Auto-update-links-OFF folder timeout gap — FIXED.** The timeout branch's "did
  it move?" check now probes `deps.app.vault.getAbstractFileByPath` (matches files
  AND folders) instead of the file-only `getFileMtime`, so a folder rename that
  succeeded on the timeout path returns success with `linkUpdatePending` (and
  `modified: 0`) rather than a misleading `TIMEOUT`. Regression test added
  (folder rename, timeout, no mtime → linkUpdatePending). No open items remain in
  T5.1.
- **T5.2** ✅ Docs updated: `docs/api-reference.md` (kado-write implicit mkdir-p;
  kado-delete `folder` op + empty-only; kado-rename `folder` op, in-place-only,
  RBAC neutrality guard, examples), `docs/permissioning-for-pkm.md` (structural
  ops gated; folder rename permission-neutral, block-not-migrate),
  `README.md` (Folder operations feature bullet).
- **T5.3** ✅ Spec README status → Implemented (live-verify pending);
  `live-test-checklist.md` added; solution.md C-3/C-4/C-5 marked SHIPPED with the
  as-built refinements.
- **T5.4** ⏳ Conventional-commit history is clean (`feat(folder-ops): …` per
  phase). At merge, ensure the squash subject stays a `feat` so semantic-release
  cuts a minor. **Not yet raised as a PR / linked to an issue.**

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
