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

## Phase 2 — Folder-aware delete (empty only)  · `pending`
Covers FR-3. No RBAC subtlety (empty ⇒ no descendants), so it lands before rename.

- **T2.1** RED: tests — delete empty folder → trashed; non-empty folder →
  `VALIDATION_ERROR "Folder not empty"`; missing path → `NOT_FOUND`;
  no-permission folder → FORBIDDEN (existence-silent).
- **T2.2** GREEN: resolve via `getAbstractFileByPath`; `TFolder` branch checks
  `children.length` then `fileManager.trashFile`. Wire folder dispatch in the
  `kado-delete` handler (`src/mcp/tools.ts`) with gate composition (`delete` on
  the folder path).
- **T2.3** Integration test through the tool layer (request → gate → adapter).
- **T2.4** Verify: build + tsc(test) + suites green.
- **Exit:** empty folders deletable; non-empty safely refused.

## Phase 3 — Folder-aware rename (in-place, no RBAC check yet)  · `pending`
Covers FR-2 mechanics, minus the neutrality invariant (Phase 4).

- **T3.1** RED: tests — `/test/alt → /test/neu` renames the folder and its
  descendants keep resolving; `/test/alt → /neu/alt` → `VALIDATION_ERROR`
  (cannot move folders); occupied target → `CONFLICT`; missing → `NOT_FOUND`.
- **T3.2** GREEN: `getAbstractFileByPath` + `TFolder` branch in
  `rename-adapter.ts`; same-parent guard via `parentDir`; clobber guard via
  `getAbstractFileByPath(target)`; `fileManager.renameFile(folder, target)`.
- **T3.3** Extend `core/rename-policy.ts`: classify folder in-place rename;
  compose `update` permission on the folder path (pure, SDK-free unit tests).
- **T3.4** Registration gate: fold folder rename into the existing
  auto-update-links registration condition + `renameTimeoutMs` (reuse, ADR-5).
- **T3.5** Verify: build + tsc(test) + suites green.
- **Exit:** in-place folder rename works and is permission-gated; cross-folder
  and clobber refused.

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
