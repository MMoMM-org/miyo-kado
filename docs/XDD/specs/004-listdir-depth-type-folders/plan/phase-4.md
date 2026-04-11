---
title: "Phase 4: Scope Filter Refactor (Three-Layer Defense)"
status: pending
version: "1.0"
phase: 4
---

# Phase 4: Scope Filter Refactor (Three-Layer Defense)

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `docs/XDD/specs/004-listdir-depth-type-folders/solution.md` §4 Permission gates and scope filtering
- `docs/XDD/specs/004-listdir-depth-type-folders/solution.md` §7 Example 2 (folder-aware scope filter with traced walkthrough)
- `docs/XDD/specs/004-listdir-depth-type-folders/solution.md` ADR-4 (filtered childCount), ADR-9 (three-layer refactor), ADR-10 (dirCouldContainMatches reuse)
- `docs/XDD/specs/004-listdir-depth-type-folders/requirements.md` Feature 7 (security criteria)
- `src/obsidian/search-adapter.ts` lines 79-88 (fileInScope, filterItemsByScope), 274-276 (filterItemsByScope call site)
- `src/mcp/tools.ts` lines 93-102 (filterResultsByScope), 307-309 (blacklist filter)
- `src/core/glob-match.ts` lines 75-80 (`dirCouldContainMatches` — reused verbatim), full file for matchGlob context

**Key Decisions**:
- **ADR-4**: `childCount` is the filtered count of children that the caller can actually see. Hidden AND out-of-scope children are excluded.
- **ADR-9**: Three defense layers — walk-time (inside the adapter's `walk`), post-walk `filterItemsByScope` in adapter, and tools-layer `filterResultsByScope` + blacklist filter in `tools.ts`. All three must be folder-aware to avoid inconsistency.
- **ADR-10**: `dirCouldContainMatches` from `src/core/glob-match.ts:75-80` is reused as-is — no reimplementation.

**Dependencies**:
- **Depends on Phase 3** — requires the walk to already be producing items with `type: 'file' | 'folder'`. Without the type discriminator, the scope filters cannot branch per item type.
- Independent of Phase 2 (HTTP 406).

---

## Tasks

This phase makes every scope-filter site folder-aware and brings `childCount` into alignment with the visible-children rule. It is a coordinated refactor across two files — the changes must ship together to avoid leaving one defense layer inconsistent with the others.

- [ ] **T4.1 Adapter-layer Folder-aware Scope Filter** `[activity: security]` `[ref: SDD/§4; SDD/§7 Example 2]`

  1. **Prime**: Read the existing `fileInScope` and `filterItemsByScope` at `src/obsidian/search-adapter.ts:79-88`, the call site at line 274-276, and `dirCouldContainMatches` at `src/core/glob-match.ts:75-80`. Understand the current behavior: `filterItemsByScope` applies `matchGlob(pattern, item.path)` uniformly, which for a folder path like `"Atlas"` against scope `"Atlas/**"` returns false — wrong for folders.
  2. **Test** (RED — write in `test/obsidian/search-adapter.test.ts` or `test/obsidian/listdir-scope.test.ts`):
      - **Folder visibility with nested scope**: scope `["Atlas/**"]`, root listing, fixture contains `Atlas/` and `Notes/`. Expected: `Atlas` visible (via `dirCouldContainMatches`), `Notes` hidden.
      - **Folder visibility with sub-scope**: scope `["Atlas/Public/**"]`, root listing. Expected: `Atlas` visible (scope pattern starts with `Atlas/`); `Atlas/Private` hidden when the listing walks into `Atlas`.
      - **Folder visibility with root glob**: scope `["**/*.md"]`, root listing. Expected: all folders visible (any `*.md` could exist under any folder).
      - **Single-star scope**: scope `["*.md"]`, root listing. Expected: all top-level folders hidden (the pattern cannot cross `/`).
      - **Walk-time vs post-walk consistency**: a folder that fails walk-time scope check is not visited; its file children do not appear. Confirmed by asserting the total item count.
      - **childCount with scope**: scope `["Atlas/**"]`, folder `Atlas` has 3 in-scope children and 2 out-of-scope sibling folders (`Atlas/Private`). `Atlas` appears in the parent listing with `childCount: 3` (only the 3 scope-visible direct children).
      - **childCount with hidden + scope**: folder has `[scope-visible.md, .hidden, Private/]`. `Atlas/Private` is out of scope. Expected `childCount: 1` (only `scope-visible.md`).
  3. **Implement** (GREEN):
      - Add a helper `folderInScope(folderPath: string, patterns: string[]): boolean` near the existing `fileInScope`. Body is a thin wrapper around `dirCouldContainMatches(folderPath, patterns)` from `glob-match.ts`. Use the helper name even though it's one line — it documents intent and makes diff review easier.
      - Extend `filterItemsByScope` at lines 85-88 to branch on `item.type`: folder items use `folderInScope`, file items use the existing `patterns.some(p => matchGlob(p, item.path))` logic.
      - Update `walk` (from Phase 3) to also accept a `scope: string[] | undefined` parameter. Walk-time filtering: skip folder children that fail `folderInScope`. File children still pass through — they are filtered post-walk.
      - Update `visibleChildCount` (from Phase 3) to accept `scope: string[] | undefined` and apply both the hidden filter and, if scope is set, folder-aware or file-aware scope check per child type.
      - Update `listDir` to pass `request.scopePatterns` down into `walk` and `visibleChildCount` calls.
  4. **Validate**: All T4.1 test cases pass. Phase 3 tests that did not set scope still pass (scope-undefined path unchanged). `npm run build` + `npm run lint` clean.
  5. **Success**:
      - Scope-restricted callers see folders if and only if any scope pattern could match a child of that folder. `[ref: PRD/Feature 7 AC scope cases]`
      - `childCount` reflects the filtered-visible count of direct children — no hidden, no out-of-scope leak. `[ref: PRD/Feature 7 AC childCount]`
      - `dirCouldContainMatches` is the single source of truth for folder scope logic. No duplicated pattern-probe code in `search-adapter.ts`. `[ref: SDD/ADR-10]`

- [ ] **T4.2 Tools-layer Folder-aware Scope Filter** `[activity: security]` `[ref: SDD/§4; SDD/ADR-9]`

  1. **Prime**: Read `filterResultsByScope` at `src/mcp/tools.ts:93-102` and the blacklist filter at lines 307-309. Confirm both sites currently call `isPathInScope` (or equivalent) and apply it uniformly to all items regardless of type. Read `dirCouldContainMatches` from `glob-match.ts` — same helper used in T4.1.
  2. **Test** (RED — write in `test/mcp/tools.test.ts` or `test/integration/scope-filter.test.ts`):
      - **Defense-in-depth consistency**: when `filterItemsByScope` (adapter, T4.1) would allow a folder, `filterResultsByScope` (tools) also allows it. When the adapter denies, tools also denies. Test with the same fixture + scope combinations from T4.1.
      - **Blacklist mode folder handling**: when the API key operates in `listMode: 'blacklist'` with a blacklist pattern `["Private/**"]`, folders whose path matches the pattern are blocked; folders whose children match are **also** blocked (opposite of whitelist).
      - **Whitelist mode is the existing primary**: when in whitelist mode with `["Atlas/**"]`, `Atlas` and `Atlas/Private` visibility matches T4.1's expectations.
      - **File items unchanged**: existing file-filter tests for `byName`, `byContent`, etc. still pass after the type-branching change.
  3. **Implement** (GREEN):
      - In `tools.ts:93-102`, extend `filterResultsByScope` with the same type-branching used in T4.1: folder items go through `dirCouldContainMatches`; file items go through the existing `isPathInScope` (or equivalent).
      - In the blacklist filter at `tools.ts:307-309`, invert the logic for folders: a folder is **blocked** if any blacklist pattern could match a child of it (i.e., if `dirCouldContainMatches(folder.path, blacklistPatterns)` is true, block it). Confirm this with the test assertions before committing.
      - Import `dirCouldContainMatches` from `src/core/glob-match.ts` at the top of `tools.ts` if not already imported.
  4. **Validate**: All T4.2 test cases pass. T4.1 tests still pass (the two layers now give consistent answers). `npm run build` + `npm run lint` clean. Manual review: the diff touches only `filterResultsByScope`, the blacklist filter, and the import — nothing else.
  5. **Success**:
      - Defense-in-depth consistency between adapter and tools layers. `[ref: SDD/ADR-9]`
      - Blacklist mode correctly blocks folders whose children would be blacklisted — prevents a bypass where listing the parent leaks the existence of blacklisted descendants. `[ref: PRD/Feature 7 security intent]`
      - Both layers use the same helper, so any future change lands once and propagates consistently. `[ref: SDD/ADR-10]`

- [ ] **T4.3 Phase 4 Validation and Security Checklist** `[activity: validate]` `[ref: Constitution L1 Security rules]`

  1. **Prime**: Read PRD Feature 7 acceptance criteria. Read the Constitution L1 Security rules (lines 8-41) — the double-layer access control principle.
  2. **Test** (integration): Run a full-flow test through the MCP tool call with a scope-restricted key:
      - Request `listDir({path: "/"})` with `scopePatterns: ["allowed/**"]`. Verify the response shows only `allowed/` and folders whose children could match, no other top-level entries.
      - Request `listDir({path: ".obsidian"})` with any key — verify `NOT_FOUND` return.
      - Request `listDir({path: "allowed/nonexistent"})` — verify `NOT_FOUND`.
      - Request `listDir({path: "allowed/some-file.md"})` — verify `VALIDATION_ERROR` with "got file" message.
      - Request `listDir({path: "allowed/", depth: 1})` with a folder that has both in-scope and out-of-scope children — verify `childCount` reflects only visible children.
  3. **Implement**: No new code — this task runs the full Phase 4 test suite and the Constitution compliance check.
  4. **Validate**:
      - All PRD Feature 7 acceptance criteria pass.
      - No information leak via `childCount` for any test vector.
      - No information leak via error-code distinction for hidden targets (both nonexistent and hidden-dot paths return `NOT_FOUND`, indistinguishable).
      - Constitution L1 Security rules satisfied: path access and API-key scoping run on every request, folders are treated with the same double-layer defense as files.
  5. **Success**: The full security story holds end-to-end. Phase 5 can safely update the public tool schema and ship without re-opening any of the security questions from the research phase.
