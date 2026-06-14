---
title: "Phase 1: Foundations — types & pure slice helpers"
status: completed
version: "1.0"
phase: 1
---

# Phase 1: Foundations — types & pure slice helpers

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Application Data Models]` — NoteReadMode/NoteWriteMode, HeadingTarget, RangeTarget, NoteReadPartial/NoteWritePartial, truncated
- `[ref: SDD/Implementation Examples/Example 1]` — pure slice helpers
- `[ref: SDD/ADR-1]` — single flat mode normalized to discriminated union
- `[ref: SDD/ADR-4]` — range basis line(1-based incl.)/char(0-based excl., code points)
- `[ref: SDD/ADR-6]` — truncated flag

**Key Decisions**:
- Internal representation is a discriminated union (`NoteReadPartial` / `NoteWritePartial`); the flat MCP `mode` arg is normalized into it in Phase 3.
- `CoreWriteRequest.mode` stays `FrontmatterWriteMode`; note partial writes use a new `notePartial` field (avoids overloading frontmatter semantics).
- Slice helpers are pure string→string, Obsidian-free, code-point safe.

**Dependencies**: None (foundation). T1.1 and T1.2 are independent.

---

## Tasks

Establishes the type vocabulary and the pure content-math used by every later phase.

- [x] **T1.1 Canonical type extensions** `[activity: domain-modeling]` `[parallel: true]`

  1. Prime: Read `src/types/canonical.ts` (CoreReadRequest, CoreWriteRequest, CoreFileResult, type guards) and `[ref: SDD/Application Data Models]`
  2. Test: type-level — a `CoreWriteRequest` with `notePartial` is still recognized by `isCoreWriteRequest`; `isCoreReadRequest` still holds with `partial` set; `truncated` is optional on `CoreFileResult`. Add a focused spec asserting the unions accept each valid arm and reject extra keys (compile-time + a runtime guard test).
  3. Implement: add `NoteReadMode`, `NoteWriteMode`, `HeadingTarget`, `RangeTarget`, `NoteReadPartial`, `NoteWritePartial`; add `partial?: NoteReadPartial` to `CoreReadRequest`, `notePartial?: NoteWritePartial` to `CoreWriteRequest`, `truncated?: boolean` to `CoreFileResult`. Do **not** change existing guards' behaviour.
  4. Validate: `npm run build` clean; `npx tsc -p tsconfig.test.json` clean for touched specs; existing canonical/guard tests still pass.
  5. Success: types compile and existing guards unchanged `[ref: SDD/Application Data Models]`; backward-compat invariant preserved `[ref: PRD/Constraints]`

- [x] **T1.2 Pure slice & apply helpers** `[activity: backend-logic]` `[parallel: true]`

  1. Prime: Read `[ref: SDD/Implementation Examples/Example 1]` and the multibyte/boundary edge cases in `[ref: PRD/Detailed Feature Specifications/Edge Cases]`
  2. Test (RED first): `test/core/partial-slice.test.ts` — `firstXChars` (limit<len → truncated; limit≥len → full, not truncated; never splits a multibyte code point); `sliceByLineRange` (inclusive 1-based; clamp past EOF; truncated reflects content outside; reject start<1 or start>end); `sliceByCharRange` (0-based exclusive end, code points; clamp; reject inverted/negative); `applyAppend` (newline join, empty body, body already ending in `\n`); `applyPrepend` (newline join)
  3. Implement: NEW `src/core/partial-slice.ts` with `firstXChars`, `sliceByLineRange`, `sliceByCharRange`, `applyAppend`, `applyPrepend` — no imports from `obsidian`/MCP SDK
  4. Validate: `npx vitest run test/core/partial-slice.test.ts` green; `npx tsc -p tsconfig.test.json` clean; lint clean
  5. Success: all boundary/multibyte criteria pass `[ref: SDD/Quality Requirements/Correctness]`; helpers are Obsidian-free `[ref: SDD/ADR-7]`

- [x] **T1.3 Phase Validation** `[activity: validate]`

  - Run `npm run build` + `npx vitest run test/core/partial-slice.test.ts` + canonical/guard specs + `npx tsc -p tsconfig.test.json`. All green, no behaviour change to existing guards.
