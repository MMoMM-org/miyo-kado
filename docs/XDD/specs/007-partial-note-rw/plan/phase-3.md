---
title: "Phase 3: Request mapping & validation boundary"
status: completed
version: "1.0"
phase: 3
---

# Phase 3: Request mapping & validation boundary

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Interface Specifications/Tool Contract]` — read/write params per mode
- `[ref: SDD/ADR-1]` — flat `mode` arg normalized to the discriminated union
- `[ref: SDD/ADR-3]` — heading text OR headingPath (exactly one)
- `[ref: SDD/ADR-4]` — range basis discriminator + index conventions
- `[ref: SDD/Error Handling]` — malformed combos → VALIDATION_ERROR at the boundary

**Key Decisions**:
- All validation fails fast at the MCP boundary with descriptive errors (mirrors the existing frontmatter `mode` validation in `mapWriteRequest`).
- Mapper routes by `operation`: `frontmatter` → existing `mode`; `note` → new `partial`/`notePartial`.

**Dependencies**: Phase 1 (T1.1 types). Independent of Phase 2 (different file) — may run in parallel.

---

## Tasks

Turns flat, untrusted MCP args into validated, normalized partial descriptors — rejecting every malformed combination before it reaches the core.

- [x] **T3.1 `mapReadRequest` — read mode validation & normalization** `[activity: backend-api]`

  1. Prime: Read `src/mcp/request-mapper.ts` (`mapReadRequest`, `validateOperationExtension`) and `[ref: SDD/Interface Specifications/Tool Contract]`
  2. Test: `test/mcp/request-mapper.test.ts` — `mode:firstXChars` requires positive int `limit`; `mode:section` requires exactly one of `heading` / `headingPath` (both or neither → error); `mode:range` requires `rangeBasis` + integer `start`/`end` with valid bounds (reject inverted, reject negative); `mode` only valid for `operation:'note'` (frontmatter/file/tags → error); omitted `mode` → no `partial` field (full read); unknown `mode` value → error
  3. Implement: extend `mapReadRequest` to parse `mode` + addressing args, build `partial: NoteReadPartial`, throw descriptive `VALIDATION_ERROR`-style errors on malformed combos
  4. Validate: `npx vitest run test/mcp/request-mapper.test.ts` green; `npx tsc -p tsconfig.test.json` clean
  5. Success: every read malformed combo rejected; valid combos normalized `[ref: PRD/AC Feature 1]` `[ref: SDD/ADR-1]`

- [x] **T3.2 `mapWriteRequest` — write mode validation & normalization** `[activity: backend-api]`

  1. Prime: Read `mapWriteRequest` (note the existing frontmatter `mode` block to extend, not break)
  2. Test: append/prepend require `content`, allow missing `expectedModified`; `insertUnderHeading`/`replaceSection` require a heading target (text XOR path); `replaceRange` requires `rangeBasis`+`start`+`end`; **replace/insert without `expectedModified` → error** (ADR-5 boundary enforcement); note `mode` and frontmatter `mode` do not collide (operation-routed); omitted `mode` → full-note write unchanged; unknown mode → error
  3. Implement: extend `mapWriteRequest` to build `notePartial: NoteWritePartial` for `operation:'note'`, preserving the frontmatter `mode` path untouched
  4. Validate: `npx vitest run test/mcp/request-mapper.test.ts` green; frontmatter `mode` tests still pass
  5. Success: write combos validated incl. the expectedModified rule `[ref: PRD/AC Feature 2]` `[ref: SDD/ADR-5]`

- [x] **T3.3 Phase Validation** `[activity: validate]`

  - Run request-mapper specs + full suite; confirm frontmatter `mode` and full-note paths are unaffected. `npx tsc -p tsconfig.test.json` clean.
