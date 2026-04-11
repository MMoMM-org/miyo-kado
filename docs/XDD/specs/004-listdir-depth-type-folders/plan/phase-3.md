---
title: "Phase 3: listDir Walk and Fixtures"
status: pending
version: "1.0"
phase: 3
---

# Phase 3: listDir Walk and Fixtures

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `docs/XDD/specs/004-listdir-depth-type-folders/solution.md` §7 Example 1 (walk implementation sketch — use as reference, not prescriptive)
- `docs/XDD/specs/004-listdir-depth-type-folders/solution.md` §Runtime View (primary flow + depth algorithm)
- `docs/XDD/specs/004-listdir-depth-type-folders/solution.md` §Implementation Gotchas (import type vs value, hasDotSegment, visibleChildCount sync)
- `docs/XDD/specs/004-listdir-depth-type-folders/solution.md` ADR-2, ADR-3, ADR-5, ADR-7, ADR-8
- `docs/XDD/specs/004-listdir-depth-type-folders/requirements.md` Features 1, 2, 5, 6, 7, 8 acceptance criteria
- `src/obsidian/search-adapter.ts` lines 111-114 (current `listDir`), 30-38 (`mapFileToItem`), 248-270 (switch statement), 252-257 (byTag error-return pattern)
- `node_modules/obsidian/obsidian.d.ts` lines 5704, 5906, 5929, 5934, 6179, 6186 (TAbstractFile, TFile, TFolder, children, getAbstractFileByPath, getRoot)

**Key Decisions**:
- **ADR-2**: `vault.getFiles()` is removed from `listDir` and replaced with `TFolder.children` traversal via `getAbstractFileByPath` or `getRoot`.
- **ADR-3**: Folders appear in the default recursive response alongside files — no files-only mode.
- **ADR-5**: `hasDotSegment` rejects any dot-prefixed path segment (including `.obsidian`, `Atlas/.hidden`). Rejection returns `NOT_FOUND`, not `VALIDATION_ERROR` — to avoid confirming existence.
- **ADR-7**: Folders sort before files; within each group, `localeCompare` with `{sensitivity: 'variant'}` for locale-independent determinism.
- **ADR-8**: `listDir` returns `CoreSearchItem[] | CoreError`. The switch case at `search-adapter.ts:249-251` must gate on the error branch using the existing `byTag` pattern (`if ('code' in result) return result`).
- **Import discipline**: `App` stays as `import type`; `TFile` and `TFolder` become runtime value imports for `instanceof` narrowing.

**Dependencies**:
- **Depends on Phase 1** — needs `CoreSearchRequest.depth?` and `CoreSearchItem.type?/childCount?` to exist in `canonical.ts`. Walk code reads `request.depth` and sets `item.type`/`item.childCount` directly.
- **Independent of Phase 2** — Phase 2 touches the transport/validation layer, Phase 3 touches the adapter.

---

## Tasks

This phase produces the new `listDir` walk — the structural core of the feature. `visibleChildCount` in this phase is **not yet scope-aware**; it only applies the hidden-entry filter. Phase 4 adds the scope-awareness in a coordinated refactor across adapter and tools layers.

- [ ] **T3.1 Test Vault Fixture Extension** `[activity: test-design]` `[ref: PRD/Supporting Research/Market Data; SDD/§Test Examples]`

  1. **Prime**: Read the current fixture layout at `test/MiYo-Kado/` (`allowed/`, `allowed/sub/`, `maybe-allowed/`, `nope/`, `logs/`, `.obsidian/plugins/`). Review PRD Features 1, 2, 5, 6, 7 to identify which tree shapes the walk tests need.
  2. **Test**: No test code — this task produces test data. The validation is that subsequent T3.2 walk tests have the fixtures they need.
  3. **Implement**: Extend `test/MiYo-Kado/` with the following additions (or create parallel fixture paths under a new `test/MiYo-Kado/listdir-fixtures/` if modifying the main fixture would break existing tests):
      - **Depth ≥ 3 nesting**: e.g., `listdir-fixtures/L0/L1/L2/L3/deep-file.md` with intermediate files at each level (one file per level to distinguish levels in assertions)
      - **Empty folder**: `listdir-fixtures/L0/EmptyFolder/` with `.gitkeep` (the `.gitkeep` dot-prefixed name also covers the "hidden file skipped" assertion)
      - **Folder containing only subfolders**: `listdir-fixtures/L0/OnlySubfolders/SubA/` + `listdir-fixtures/L0/OnlySubfolders/SubB/` with one `.md` file each, no direct files in `OnlySubfolders/`
      - **Hidden folder already exists**: `.obsidian/` — verify present. If not, add a placeholder so hidden-skip assertions work.
      - **Hidden file at top level**: `listdir-fixtures/.hidden-root.md` to assert the top-level hidden filter skips it
      - **Mixed files and folders at one level**: `listdir-fixtures/L0/` has at least 2 folders and 2 files for sort-order assertions
  4. **Validate**: `git status` shows only additions under `test/MiYo-Kado/`. Existing tests still pass (no fixture regression).
  5. **Success**: Phase 3 walk tests can express every edge case from PRD Features 1, 2, 5, 6, 7 using this fixture. `[ref: PRD/Feature 7 AC; Feature 2 AC]`

- [ ] **T3.2 listDir Walk Implementation** `[activity: backend-api]` `[ref: SDD/§7 Example 1; SDD/§Runtime View]`

  1. **Prime**: Read the current `listDir` at `src/obsidian/search-adapter.ts:111-114`, the `mapFileToItem` helper at lines 30-38, and the `byTag` error-return switch-case pattern at lines 252-257. Read the SDD §7 Example 1 walk sketch and §Runtime View depth algorithm. Read the Implementation Gotchas section — especially the `import type` vs runtime-value warning for `TFolder`.
  2. **Test** (RED — write in `test/obsidian/search-adapter.test.ts` or a new `test/obsidian/listdir-walk.test.ts`):
      - **Happy path**: `listDir({path: "listdir-fixtures/L0", depth: 1})` returns only direct children; first items are folders (`EmptyFolder`, `L1`, `OnlySubfolders`) before files; each folder item has `type: 'folder'`, `size: 0`, `created: 0`, `modified: 0`, and a `childCount`.
      - **Depth semantics**: `depth: 2` on the same path includes level-2 items (`L1/L2`, files inside `L1`) but NOT level-3 items (`L1/L2/L3`).
      - **Unlimited recursion**: `depth` omitted walks the full subtree and still sorts folders-first at each combined level.
      - **Empty folder**: `EmptyFolder` appears with `childCount: 0`; direct `listDir({path: "listdir-fixtures/L0/EmptyFolder"})` returns `items: []` (legitimate empty, not an error).
      - **Folder with only subfolders**: `OnlySubfolders` appears with `childCount: 2` (SubA + SubB), no file items inside until descended.
      - **Hidden entry at walk level**: `listdir-fixtures/.hidden-root.md` does NOT appear in any root-level listing.
      - **Hidden folder as target**: `listDir({path: ".obsidian"})` returns `NOT_FOUND` (not `VALIDATION_ERROR`). `listDir({path: "listdir-fixtures/.hidden"})` also returns `NOT_FOUND` even if the folder doesn't exist (the check fires before resolution).
      - **Path resolves to file**: `listDir({path: "listdir-fixtures/L0/L1/L2/L3/deep-file.md"})` returns `VALIDATION_ERROR` with message matching `/listDir target must be a folder, got file:/`.
      - **Missing path**: `listDir({path: "NotAVault/Folder"})` returns `NOT_FOUND` with message matching `/Path not found:/`.
      - **Root listing**: `listDir({})` (path omitted) returns vault-root children; folders sorted first.
      - **Sort determinism**: runs of the same query produce byte-identical item order across multiple calls.
      - **`type: 'file'` on file items**: every file item has `type: 'file'`, real `size`/`created`/`modified` from `TFile.stat`.
      - **Pagination respects ordering**: `listDir({path: "listdir-fixtures/L0", depth: 1, limit: 3})` returns 3 items, all folders first if there are ≥ 3 folders at that level.
      - **Switch-case error propagation**: the adapter's `createSearchAdapter.search` switch early-returns for `NOT_FOUND`/`VALIDATION_ERROR` — `filterItemsByScope` and `paginate` never see the error result.
  3. **Implement** (GREEN):
      - Update the import at `search-adapter.ts:9` from `import type {App, TFile} from 'obsidian'` to:
        ```typescript
        import {TFile, TFolder} from 'obsidian';
        import type {App} from 'obsidian';
        ```
      - Add helper functions at the file level (near the top, alongside `mapFileToItem`):
        - `hasDotSegment(path: string): boolean` — splits on `/`, returns true if any segment starts with `.`.
        - `resolveFolder(app, path): ResolveResult` — returns `{kind: 'folder', folder}`, `{kind: 'file'}`, or `{kind: 'missing'}`. Uses `app.vault.getRoot()` for `undefined` path; uses `app.vault.getAbstractFileByPath(path.replace(/\/$/, ''))` otherwise; applies `hasDotSegment` and returns `missing` if any segment is dot-prefixed.
        - `mapFolderToItem(folder: TFolder, childCount: number): CoreSearchItem` — sets `type: 'folder'`, `size: 0`, `created: 0`, `modified: 0`, and the provided `childCount`.
        - `visibleChildCount(folder: TFolder): number` — counts only children whose `name` does NOT start with `.`. **Not yet scope-aware** — Phase 4 adds the scope parameter.
        - `walk(folder, currentDepth, maxDepth, out)` — recursive walk as sketched in SDD §7 Example 1, minus the scope parameter (Phase 4 adds it).
        - `compareListDirItems(a, b)` — folders-first discriminator + `localeCompare(a.path, b.path, undefined, {sensitivity: 'variant'})`.
      - Replace the `listDir` function body with the new walk-based implementation. New signature: `function listDir(app, request): CoreSearchItem[] | CoreError`.
      - Update the switch case at `search-adapter.ts:249-251` to mirror the `byTag` pattern:
        ```typescript
        case 'listDir': {
            const listResult = listDir(app, request);
            if ('code' in listResult) return listResult;
            items = listResult;
            break;
        }
        ```
      - The old `mapFileToItem` helper stays **unchanged** — only the new inline file mapping inside `walk` sets `type: 'file'`. Other operations (`byName`, `byTag`, ...) continue to call `mapFileToItem` and produce items without `type`.
  4. **Validate**: All T3.2 test cases pass. Existing tests that do NOT mock `getFiles` for listDir still pass. Tests that mock `getFiles` for listDir will fail — they are migrated in Phase 5's integration/live test task. `npm run build` + `npm run lint` clean. No `any` types introduced.
  5. **Success**:
      - Every PRD Feature 1, 2, 5, 6 criterion passes except the scope-aware parts of Feature 7. `[ref: PRD/Feature 1 AC, Feature 2 AC, Feature 5 AC, Feature 6 AC]`
      - Hidden-entry filter applies to both children and the walk-start target (ADR-5 closes the security bypass). `[ref: PRD/Feature 7 AC hidden cases]`
      - Folders-first sort is deterministic and locale-independent. `[ref: PRD/Feature 8 AC]`
      - `listDir` signature change (`CoreSearchItem[] | CoreError`) is mirrored in the switch case — no type errors, no runtime fall-through.
      - The old `vault.getFiles()` call for listDir is gone; other operations still use it.

- [ ] **T3.3 Phase 3 Validation** `[activity: validate]`

  1. **Prime**: Read the Phase 3 task list and the SDD §Runtime View depth-algorithm trace.
  2. **Implement**: Run `npm test -- test/obsidian/`, `npm run lint`, `npm run build`. Verify the depth-2 trace example from SDD §7 Example 1 behaves exactly as documented (folders `[Atlas/202 Notes, Atlas/202 Notes/Sub, Atlas/People]` then files `[Atlas/202 Notes/Note1.md, Atlas/People/Alice.md, Atlas/README.md]`) — use an equivalent fixture subtree.
  3. **Validate**: Every T3.1 and T3.2 success criterion is checked. Failing tests exist for scope-aware Feature 7 cases (tracked for Phase 4). `listTags` size-repurpose is untouched. No regressions in any search operation other than `listDir`.
  4. **Success**: The walk primitive is complete and ready for Phase 4 to layer scope-aware filtering on top of it.
