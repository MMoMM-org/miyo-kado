---
title: "Phase 3: Obsidian Interface — Vault Adapters"
status: pending
version: "1.0"
phase: 3
---

# Phase 3: Obsidian Interface — Vault Adapters

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Building Block View — Obsidian Plugin Interface Layer]`
- `[ref: SDD/ADR-1]` — Core has no Obsidian imports; adapters translate canonical ↔ Obsidian
- `[ref: SDD/ADR-7]` — Self-parsed Dataview inline fields
- `[ref: SDD/Implementation Gotchas]` — vault.read vs cachedRead, MetadataCache timing, processFrontMatter atomicity

**Key Decisions**:
- All adapters implement a common interface pattern: accept canonical request, return canonical result
- Use `vault.read()` (not `cachedRead()`) before writes for accurate content
- Use `FileManager.processFrontMatter()` for atomic frontmatter modification
- Inline field parsing: 3 regex patterns (bare, bracket, paren), skip code blocks and frontmatter

**Dependencies**:
- Phase 1 complete (canonical types)
- Phase 2 complete (operation router interface — adapters must conform to what the router expects)

---

## Tasks

Implements the inner ACL — all Obsidian API interactions are encapsulated here. Each adapter translates between canonical types and Obsidian API calls.

- [ ] **T3.1 NoteAdapter** `[activity: backend-api]`

  1. Prime: Read Obsidian Vault API signatures (read, modify, create, delete, process, trash) `[ref: SDD/Building Block View — NoteAdapter]`
  2. Test: readNote returns content + timestamps; createNote at new path succeeds; createNote at existing path → CONFLICT; updateNote modifies content; deleteNote removes file; paths normalized before Vault calls
  3. Implement: Create `src/obsidian/note-adapter.ts` — wraps `vault.read()`, `vault.create()`, `vault.modify()`, `vault.trash()`. Returns `CoreFileResult` with `file.stat.ctime`, `file.stat.mtime`, `file.stat.size`.
  4. Validate: Unit tests pass with Obsidian mock; lint clean
  5. Success: Note CRUD operations work through canonical interface `[ref: PRD/Feature 1 — Note CRUD]`

- [ ] **T3.2 FrontmatterAdapter** `[activity: backend-api]`

  1. Prime: Read `FileManager.processFrontMatter()` API and frontmatter helpers `[ref: SDD/Building Block View — FrontmatterAdapter]`
  2. Test: readFrontmatter returns structured object; readFrontmatter on note without frontmatter → empty object; updateFrontmatter modifies only frontmatter, preserves body; malformed YAML update → VALIDATION_ERROR
  3. Implement: Create `src/obsidian/frontmatter-adapter.ts` — uses `app.metadataCache.getFileCache()` for reads, `app.fileManager.processFrontMatter()` for writes
  4. Validate: Unit tests pass; lint clean
  5. Success: Frontmatter read/write preserves note body exactly `[ref: PRD/Feature 2 — Frontmatter access]` `[ref: PRD/Section 5.1 — BR-P7]`

- [ ] **T3.3 FileAdapter** `[activity: backend-api]` `[parallel: true]`

  1. Prime: Read Obsidian binary file API (readBinary, createBinary, modifyBinary) `[ref: SDD/Building Block View — FileAdapter]`
  2. Test: readFile returns base64-encoded content + timestamps; createFile at new path succeeds; file size reported correctly
  3. Implement: Create `src/obsidian/file-adapter.ts` — wraps `vault.readBinary()`, `vault.createBinary()`, `vault.modifyBinary()`. Converts ArrayBuffer ↔ base64 string for canonical interface.
  4. Validate: Unit tests pass; lint clean
  5. Success: Binary file CRUD works through canonical interface `[ref: PRD/Feature 4 — Non-Markdown file access]`

- [ ] **T3.4 InlineFieldAdapter** `[activity: backend-api]`

  1. Prime: Read SDD Dataview inline field parsing example and Dataview research findings `[ref: SDD/Implementation Examples — Dataview Inline Field Parsing]` `[ref: SDD/ADR-7]`
  2. Test: Parse bare field (`key:: value`) correctly; parse bracket field (`[key:: value]`) correctly; parse paren field (`(key:: value)`) correctly; skip fields inside code blocks; skip fields inside frontmatter; handle multiple fields per line (bracket/paren); handle duplicate keys (merge to array); modify single field preserving surrounding text; modify bracket field preserving wrapping style; empty value → null
  3. Implement: Create `src/obsidian/inline-field-adapter.ts` — `parseInlineFields(content)` returns `InlineField[]` with positions. `readFields(file)` reads note and parses. `writeField(file, key, value, expectedModified)` reads note, finds field by key and position, splices new value, writes back via `vault.modify()`.
  4. Validate: Unit tests pass with comprehensive edge cases; lint clean
  5. Success: Inline fields parsed and modified correctly across all 3 syntax variants `[ref: PRD/Feature 5 — Independent CRUD for Dataview Inline Fields]`

- [ ] **T3.5 SearchAdapter** `[activity: backend-api]`

  1. Prime: Read Obsidian MetadataCache API, vault listing methods, and SDD search business rules `[ref: SDD/Building Block View — SearchAdapter]` `[ref: PRD/Section 5.2 — BR-S1 through BR-S8]`
  2. Test: listDir returns files in directory with timestamps; listDir respects scope (no results outside permitted paths); byTag returns notes matching tag via MetadataCache; byName returns notes matching name pattern; listTags returns all visible tags with counts; pagination works (cursor returns next page, absent on last page); empty results return empty array, not error
  3. Implement: Create `src/obsidian/search-adapter.ts` — uses `vault.getMarkdownFiles()`, `vault.getFiles()`, `metadataCache.getFileCache()`, `getAllTags()`. Implements cursor-based pagination (offset-encoded cursor). Filters results against effective scope before returning.
  4. Validate: Unit tests pass; lint clean
  5. Success: Search/listing returns only in-scope results with pagination `[ref: PRD/Feature 17 — Path/directory listing]` `[ref: PRD/Feature 18 — Chunked note search]` `[ref: PRD/Feature 19 — Tag-based search]`

- [ ] **T3.6 Phase Validation** `[activity: validate]`

  - Run all Phase 3 tests. Verify: all 5 adapters return canonical types; no Obsidian API calls leak into Core; inline field parser handles all 3 variants + edge cases; search respects scope boundaries. Lint and typecheck pass.
