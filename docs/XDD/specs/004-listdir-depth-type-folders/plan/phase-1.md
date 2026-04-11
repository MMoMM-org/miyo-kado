---
title: "Phase 1: Types and Mapper Foundation"
status: pending
version: "1.0"
phase: 1
---

# Phase 1: Types and Mapper Foundation

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `docs/XDD/specs/004-listdir-depth-type-folders/solution.md` §2 Application Data Models
- `docs/XDD/specs/004-listdir-depth-type-folders/solution.md` §7 Example 3 (Request-mapper updates)
- `docs/XDD/specs/004-listdir-depth-type-folders/solution.md` ADR-1 (depth semantics), ADR-6 (`/` root marker)
- `src/types/canonical.ts` lines 49-96 — current CoreSearchRequest and CoreSearchItem
- `src/mcp/request-mapper.ts` lines 102-113 — mapSearchRequest current body
- `src/mcp/request-mapper.ts` lines 90-94 — normalizeDirPath (retained, not changed)

**Key Decisions**:
- **ADR-1**: `depth?: number` added as optional field; positive integer or omit; `0`/negative/non-integer rejected with `VALIDATION_ERROR: "depth must be a positive integer"`
- **ADR-6**: `/` normalized to `undefined` at the mapper (canonical root); `""` rejected with `VALIDATION_ERROR: "path must not be empty. Use '/' to list the vault root."`
- Type additions to `CoreSearchItem` follow the existing optional-field pattern (`tags?`, `frontmatter?`) — additive, backward compatible

**Dependencies**:
- None — this is the foundation phase. Nothing in the codebase blocks it.

---

## Tasks

This phase establishes the type-system and request-validation foundation that every subsequent phase depends on. Phase 2 (HTTP 406) can start in parallel — it does not depend on these changes.

- [ ] **T1.1 Canonical Type Additions** `[activity: domain-modeling]` `[ref: SDD/§Interface Specifications/Application Data Models]`

  1. **Prime**: Read current `CoreSearchRequest` and `CoreSearchItem` at `src/types/canonical.ts:49-96`. Note the existing optional-field pattern (`tags?`, `frontmatter?`, `scopePatterns?`).
  2. **Test**: No new runtime tests — these are additive type-only changes. Validate via `npm run build` (tsc strict-mode compile). The Phase 3 walk tests will exercise the new fields at runtime.
  3. **Implement**:
      - Add `depth?: number` to `CoreSearchRequest` (after `limit?: number`, before `scopePatterns?`).
      - Add `type?: 'file' | 'folder'` to `CoreSearchItem` (after `frontmatter?`).
      - Add `childCount?: number` to `CoreSearchItem` (after `type?`).
      - No comments, no changed semantics, no existing field modifications.
  4. **Validate**: `npm run build` succeeds. `npm run lint` clean. Existing tests still pass (the additive changes should not break anything).
  5. **Success**:
      - `CoreSearchRequest` carries the `depth?` field so Phase 3's walk can read `request.depth`. `[ref: SDD/§Interface Specifications]`
      - `CoreSearchItem` carries `type?` and `childCount?` so Phase 3's walk can populate them and consumers can branch on them. `[ref: PRD/Feature 5]`

- [ ] **T1.2 Request Mapper Depth and Root-Marker Handling** `[activity: backend-api]` `[ref: SDD/§7 Implementation Examples/Example 3; lines: Example 3 in solution.md]`

  1. **Prime**: Read `mapSearchRequest` at `src/mcp/request-mapper.ts:102-113` and the existing `normalizeDirPath` helper at lines 90-94. Confirm the existing `limit` extraction pattern at line 110 — it is the template for how `depth` is extracted. Read `src/core/gates/path-access.ts:37-40, 56-69` for context on how `undefined` path is already accepted downstream.
  2. **Test** (RED — write these in `test/mcp/request-mapper.test.ts` first, watch them fail):
      - `depth: 1` → `result.depth === 1`
      - `depth: 3` → `result.depth === 3`
      - `depth: 0` → throws with message matching `/depth must be a positive integer/`
      - `depth: -1` → throws
      - `depth: 1.5` → throws
      - `depth: "1"` (string) → throws
      - `depth` omitted → `result.depth === undefined`
      - `path: "/"` → `result.path === undefined` (canonical root)
      - `path: ""` → throws with message matching `/path must not be empty.*Use '\/' to list the vault root\./`
      - `path` omitted → `result.path === undefined`
      - `path: "Atlas"` → `result.path === "Atlas/"` (existing normalization preserved)
      - `path: "Atlas/"` → `result.path === "Atlas/"` (existing, unchanged)
      - `byContent` with `path: "/"` → `result.path === undefined` (global fix, covers all search ops)
  3. **Implement**:
      - In `mapSearchRequest`, add a new branch after the existing `limit` extraction that validates `args['depth']`: must be a number, must be an integer, must be ≥ 1. On failure, `throw new Error("mapSearchRequest: depth must be a positive integer")`.
      - Replace the existing `path` extraction with: if `args['path'] === ''` throw with the helpful message; if `args['path'] === '/'` leave `result.path` undefined; else call `normalizeDirPath` as before.
      - Preserve `normalizeDirPath` exactly as is — byContent still needs trailing-slash handling for its prefix filter.
  4. **Validate**: New test cases pass (all 13 listed above). Existing request-mapper tests still pass. `npm run build` + `npm run lint` clean.
  5. **Success**:
      - Depth validation happens at the ACL boundary before reaching any gate or adapter. `[ref: PRD/Feature 2 AC]`
      - `/` and omitted path are equivalent; empty string returns a helpful error. `[ref: PRD/Feature 4 AC]`
      - `byContent` with `path: "/"` matches whole-vault behavior without regression. `[ref: SDD/§5 Effect on byContent]`

- [ ] **T1.3 Phase 1 Validation** `[activity: validate]`

  1. **Prime**: Read the Phase 1 task list above.
  2. **Implement**: Run the full suite: `npm test`, `npm run lint`, `npm run build`.
  3. **Validate**: Every T1.1 and T1.2 success criterion is checked off. No unrelated tests fail. No new lint or type errors. Git diff is additive-only — no existing lines removed from `canonical.ts` or `request-mapper.ts` except the two changed branches in `mapSearchRequest`.
  4. **Success**: Phase 1 artifacts are self-contained, shippable, and do not break existing consumers. Phase 3 and Phase 5 can safely build on top of the new type fields and mapper validation.
