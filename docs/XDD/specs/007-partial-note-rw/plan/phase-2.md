---
title: "Phase 2: Gate chain — create/update discrimination & lock semantics"
status: completed
version: "1.0"
phase: 2
---

# Phase 2: Gate chain — create/update discrimination & lock semantics

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Implementation Examples/Example 3]` — inferCrudAction with partial modes (traced table)
- `[ref: SDD/Implementation Examples/Example 4]` — concurrency-guard additive lock-free path
- `[ref: SDD/ADR-2]` — partial note write is always Note-Update
- `[ref: SDD/ADR-5]` — append/prepend lock-free; replace/insert require expectedModified

**Key Decisions**:
- Presence of `notePartial` overrides the legacy `expectedModified`-based create/update rule.
- This phase covers **two of the three ADR-2 sites** (`inferCrudAction`, `concurrency-guard`). The third (adapter routing) is Phase 4 — they must agree.
- Full-note path (no `notePartial`) keeps today's behaviour exactly.

**Dependencies**: Phase 1 (T1.1 types — `notePartial`). May run in parallel with Phase 3 (different files).

---

## Tasks

Generalises the write-classification and concurrency rules so a partial write is correctly an update — additive writes lock-free, destructive writes locked.

- [x] **T2.1 `inferCrudAction` — partial write ⇒ update** `[activity: backend-logic]`

  1. Prime: Read `src/core/gates/datatype-permission.ts` (`inferCrudAction`, lines ~42-49) and `[ref: SDD/Implementation Examples/Example 3]`
  2. Test: `test/core/gates/datatype-permission.test.ts` — write with `notePartial:{mode:'append'}` and **no** `expectedModified` infers `update` (checks Note-Update, not Note-Create); write with `notePartial` + `expectedModified` infers `update`; full-note write (no `notePartial`) unchanged (expectedModified → update, absent → create); FORBIDDEN when key lacks Note-Update for a partial write
  3. Implement: in `inferCrudAction`, return `'update'` when `request.notePartial !== undefined`, before the `expectedModified` check
  4. Validate: `npx vitest run test/core/gates/datatype-permission.test.ts` green; full-note classification regression intact
  5. Success: partial write never classified create `[ref: PRD/AC Feature 2 — permission]` `[ref: SDD/ADR-2]`

- [x] **T2.2 `validateConcurrency` — additive lock-free, destructive locked** `[activity: backend-logic]`

  1. Prime: Read `src/core/concurrency-guard.ts` and `[ref: SDD/Implementation Examples/Example 4]`
  2. Test: `test/core/concurrency-guard.test.ts` — `notePartial:{append}` without `expectedModified` → allowed (no CONFLICT, not treated as create); `notePartial:{prepend}` without expectedModified → allowed; `notePartial:{replaceSection|replaceRange|insertUnderHeading}` without expectedModified → rejected (malformed/VALIDATION-style); partial write with stale `expectedModified` → CONFLICT; partial write with fresh `expectedModified` → allowed; full-note write rules unchanged
  3. Implement: add a partial branch in `validateConcurrency` — additive modes skip the optimistic check when `expectedModified` is absent; replace/insert without `expectedModified` are rejected; with `expectedModified`, fall through to the standard mtime compare; never hit the "no expectedModified + file exists → create" path for partial writes
  4. Validate: `npx vitest run test/core/concurrency-guard.test.ts` green; full-note concurrency regression intact
  5. Success: additive lock-free, destructive locked `[ref: PRD/AC Feature 2 — concurrency]` `[ref: SDD/ADR-5]`

- [x] **T2.3 Phase Validation** `[activity: validate]`

  - Run both gate specs + the full suite. Confirm the full-note (no-mode) paths are byte-identical in behaviour. `npx tsc -p tsconfig.test.json` clean for touched specs.
