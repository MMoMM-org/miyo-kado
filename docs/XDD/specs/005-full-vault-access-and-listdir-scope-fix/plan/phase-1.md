---
title: "Phase 1: Core Fixes"
status: completed
version: "1.0"
phase: 1
---

# Phase 1: Core Fixes

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Building Block View]` — directory map of all modified files
- `[ref: SDD/Implementation Examples]` — walk() filtering and migration code
- `[ref: SDD/Architecture Decisions]` — ADR-2 (walk filtering), ADR-3 (migration), ADR-4 (warning removal)

**Key Decisions**:
- ADR-2: Filter files in walk() at collection time
- ADR-3: Silent migration of `/` → `**` in config-manager load()
- ADR-4: Remove `**` warning from validateGlobPattern

**Dependencies**: None — this is the first phase.

---

## Tasks

Establishes correct core behavior: glob validation, config migration, and listDir file filtering.

- [ ] **T1.1 Remove `**` warning from validateGlobPattern** `[activity: core-logic]` `[parallel: true]`

  1. Prime: Read `src/core/glob-match.ts` lines 115-136 `[ref: SDD/Architecture Decisions/ADR-4]`
  2. Test: `validateGlobPattern("**")` returns `{ok: true, warnings: []}` (no warning); existing tests for excessive `**` still reject `**/**/**/**`
  3. Implement: Remove the `if (pattern === '**')` warning block from `validateGlobPattern`
  4. Validate: `npx vitest run test/core/glob-match.test.ts` — all tests pass; lint clean
  5. Success: `**` passes validation without warnings `[ref: PRD/Feature 1/AC-5]`

- [ ] **T1.2 Config migration: `/` → `**`** `[activity: core-logic]` `[parallel: true]`

  1. Prime: Read `src/core/config-manager.ts` lines 40-61 (existing migration pattern) `[ref: SDD/Implementation Examples/Example 2]`
  2. Test: Config with `path: "/"` in global security → migrated to `**` after load; config with `path: "/"` in API key → migrated to `**`; config without `/` → unchanged; round-trip: save → load preserves `**`
  3. Implement: Add migration loop in `load()` after existing security merge — iterate `mergedSecurity.paths` and `mergedKeys[].paths`, replace exact `"/"` with `"**"`
  4. Validate: `npx vitest run test/core/config-manager.test.ts` — all tests pass; lint clean
  5. Success:
    - [ ] Legacy `/` in global paths migrated to `**` `[ref: PRD/Feature 3/AC-1]`
    - [ ] Legacy `/` in API key paths migrated to `**` `[ref: PRD/Feature 3/AC-2]`
    - [ ] Migrated config persists `**` on save `[ref: PRD/Feature 3/AC-3]`

- [ ] **T1.3 listDir file scope filtering in walk()** `[activity: core-logic]` `[parallel: true]`

  1. Prime: Read `src/obsidian/search-adapter.ts` lines 202-227 (walk function) and lines 82-96 (folderInScope, filterItemsByScope) `[ref: SDD/Implementation Examples/Example 1]`
  2. Test:
     - Scope `["Atlas"]` at root: root-level files excluded, Atlas files included
     - Scope `["**"]` at root: all files included
     - Scope `[]` (empty): no files returned
     - Scope `undefined`: all files returned (no filtering)
     - `visibleChildCount` with scope excludes out-of-scope files
  3. Implement:
     - Add `if (scope && !pathMatchesPatterns(child.path, scope)) continue;` before file push in walk()
     - Update `visibleChildCount` to also filter files by scope (currently only filters folders via `folderInScope`)
     - Import `pathMatchesPatterns` from `../core/glob-match` (already exported)
  4. Validate: `npx vitest run test/obsidian/search-adapter.test.ts` — all tests pass; lint clean; existing scope tests unchanged
  5. Success:
     - [ ] Root-level files outside scope hidden in listDir `[ref: PRD/Feature 2/AC-2]`
     - [ ] Scope `["Atlas"]` returns only Atlas content `[ref: PRD/Feature 2/AC-1]`
     - [ ] Scope `["**"]` returns all non-hidden items `[ref: PRD/Feature 2/AC-3]`
     - [ ] childCount consistent with filtered results `[ref: SDD/Implementation Gotchas]`

- [ ] **T1.4 Phase 1 Validation** `[activity: validate]`

  Run all Phase 1 tests. Verify against SDD patterns and PRD acceptance criteria. Full validation:
  ```bash
  npx vitest run test/core/glob-match.test.ts test/core/config-manager.test.ts test/obsidian/search-adapter.test.ts && npm run lint && npm run build
  ```
