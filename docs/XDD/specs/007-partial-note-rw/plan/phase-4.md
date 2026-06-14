---
title: "Phase 4: Note adapter — partial read slicing & partial write"
status: completed
version: "1.0"
phase: 4
---

# Phase 4: Note adapter — partial read slicing & partial write

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Implementation Examples/Example 2]` — heading resolution + applyPartialWrite
- `[ref: SDD/Runtime View]` — partial read & additive write flows
- `[ref: SDD/ADR-2]` — adapter routing is the THIRD site (partial ⇒ update path)
- `[ref: SDD/ADR-3]` — section span via metadataCache (text + headingPath)
- `[ref: SDD/Error Handling]` — NOT_FOUND on missing section; clamp on over-EOF
- `[ref: CON-6]` `vault.process`; `[ref: CON-7]` dirty-editor guard on all modes

**Key Decisions**:
- Heading/section resolution lives here (needs `metadataCache`); pure slicing delegates to `core/partial-slice.ts`.
- The dirty-editor CONFLICT guard runs first for **every** write mode.
- `createNoteAdapter.write` must route any `notePartial` to the partial-write path — never to `createNote`.

**Dependencies**: Phase 1 (types + helpers) AND Phase 2 (routing must match the gate-chain discrimination).

---

## Tasks

Delivers the actual Obsidian-coupled behaviour: returning slices of a note and mutating spans of it atomically and safely.

- [x] **T4.1 `readNote` partial slicing** `[activity: backend-obsidian]`

  1. Prime: Read `src/obsidian/note-adapter.ts` (`readNote`, `stripFrontmatter`, metadataCache usage) and `[ref: SDD/Implementation Examples/Example 2]`. **Verify first** that Obsidian `HeadingCache` exposes `position.start.line` and `level` (it does — `CacheItem.position`), since the existing code only reads `heading`/`level`; add a guard/test asserting the shape.
  2. Test: `test/obsidian/note-adapter.test.ts` (mocked App/metadataCache) — `firstXChars` returns slice + `truncated`; `section` by heading text returns content to next equal-or-higher heading (or EOF); `section` by `headingPath` disambiguates duplicate headings (per `matchHeadingPath` in SDD Example 2); **`section` sets `truncated:true` when content exists outside the section, `false` only when the section is the whole body** (F3); missing section → `NOT_FOUND` naming it; `range` (line & char) returns span + `truncated`, over-EOF clamps; omitted `mode` → full body identical to today; result still carries `modified` for use as `expectedModified`
  3. Implement: branch `readNote` on `request.partial`; resolve sections from `metadataCache.getFileCache(file).headings` (text first-match + headingPath stack walk); delegate slicing to `partial-slice` helpers; set `truncated`
  4. Validate: `npx vitest run test/obsidian/note-adapter.test.ts` green; `npx tsc -p tsconfig.test.json` clean
  5. Success: all read modes incl. NOT_FOUND + truncated `[ref: PRD/AC Feature 1]`; full read unchanged `[ref: PRD/Constraints]`

- [x] **T4.2 `applyPartialWrite` + write routing** `[activity: backend-obsidian]`

  1. Prime: Read `updateNote`, `createNote`, `isFileOpenAndDirty`, `createNoteAdapter` and `[ref: SDD/Implementation Examples/Example 2]`
  2. Test: `append`/`prepend` add content without altering existing (prepend lands after frontmatter); **`insertUnderHeading` inserts at the END of the section** — before the next equal-or-higher heading / at EOF — others unchanged (F1); missing heading for insert/replace → `NOT_FOUND`; `replaceSection`/`replaceRange` replace only the span; **`replaceSection`/`replaceRange` with empty `content` deletes the span** (valid, not an error) (F2); `replaceSection` preserves the heading line, replaces only the body; **every** mode raises CONFLICT + Notice when the file is open & dirty; partial write on a missing file → `NOT_FOUND`; `createNoteAdapter.write` routes `notePartial` to the partial path (never "Note already exists")
  3. Implement: new `applyPartialWrite` — dirty-editor guard → resolve span (shared with T4.1) → compute new body inside `vault.process` (delegating to `partial-slice` apply helpers + section splice) → return new stat; update `createNoteAdapter.write` so `notePartial !== undefined` ⇒ partial path
  4. Validate: `npx vitest run test/obsidian/note-adapter.test.ts` green; full-note update/create regression intact; lint clean
  5. Success: all write modes + dirty-guard + correct routing `[ref: PRD/AC Feature 2]` `[ref: SDD/ADR-2]`

- [x] **T4.3 Phase Validation** `[activity: validate]`

  - Run note-adapter specs + full suite; confirm full-note read/update/create unchanged and the three ADR-2 sites (inferCrudAction, concurrency-guard, adapter routing) agree. `npx tsc -p tsconfig.test.json` clean.
