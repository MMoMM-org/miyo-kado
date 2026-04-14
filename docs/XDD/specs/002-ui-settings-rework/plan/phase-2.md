---
title: "Phase 2: Reusable UI Components"
status: completed
version: "1.0"
phase: 2
---

# Phase 2: Reusable UI Components

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Building Block View — Components]` — Component diagram and relationships
- `[ref: SDD/Directory Map]` — `src/settings/components/` structure
- `[ref: SDD/Implementation Examples — Permission Matrix]` — Matrix DOM structure
- `[ref: SDD/Implementation Examples — VaultFolderModal]` — Folder picker pattern
- `[ref: SDD/Implementation Examples — TagPickerModal]` — Tag picker pattern
- `[ref: SDD/CSS Architecture]` — All `.kado-` class definitions

**Key Decisions**:
- ADR-1: Components are render functions (not classes) — take container + data + onChange
- ADR-3: Use `Modal` class for pickers (not SuggestModal)
- ADR-4: Tag picker uses `getAllTags(metadataCache)` for merged frontmatter+inline tags

**Dependencies**: Phase 1 (types, tag-utils)

---

## Tasks

Establishes all reusable UI components that tabs will compose in Phase 3.

- [ ] **T2.1 PermissionMatrix component** `[activity: frontend-ui]`

  1. Prime: Read SDD matrix example and CSS `.kado-perm-matrix`, `.kado-dot` classes `[ref: SDD/Implementation Examples — Permission Matrix; SDD/CSS Architecture]`
  2. Test: Renders 4×4 grid (4 resources × 4 CRUD); clicking a dot toggles `permissions[resource][op]` and calls `onChange`; `maxPermissions` disables dots where global area doesn't allow; `readOnly` mode renders all dots non-interactive; dots have correct `role="checkbox"`, `tabindex="0"`, `aria-checked` attributes; keyboard Enter/Space toggles dot
  3. Implement: Create `src/settings/components/PermissionMatrix.ts` — export `renderPermissionMatrix(containerEl, permissions, options)` function. Use Obsidian DOM methods (`createDiv`, `createEl`). Apply `.kado-dot`, `.is-active`, `.is-disabled` classes.
  4. Validate: Manual test in dev mode; accessibility attributes present; lint clean; types check
  5. Success: Matrix renders correctly with toggle, constraint, and read-only modes `[ref: PRD/AC-5.3, AC-5.4, AC-9.2]`

- [ ] **T2.2 VaultFolderModal** `[activity: frontend-ui]` `[parallel: true]`

  1. Prime: Read SDD modal example and Obsidian `Modal`, `TFolder` APIs `[ref: SDD/Implementation Examples — VaultFolderModal; SDD/Implementation Gotchas — TFolder import]`
  2. Test: Modal opens and lists all vault folders (excluding root); search input filters folders case-insensitively; clicking a folder calls `onSelect(folder.path)` and closes modal; empty state shows "No matching folders"; folders sorted alphabetically
  3. Implement: Create `src/settings/components/VaultFolderModal.ts` — class extends `Modal`. Uses `app.vault.getAllLoadedFiles()` filtered to `TFolder instanceof`. Search input with `input` event listener. Click handler calls callback and `this.close()`.
  4. Validate: Test in Obsidian dev vault with real folders; search works; modal closes on selection
  5. Success: Directory picker selects vault-relative paths `[ref: PRD/AC-4.1, AC-5.2]`

- [ ] **T2.3 TagPickerModal** `[activity: frontend-ui]` `[parallel: true]`

  1. Prime: Read SDD tag picker example and `getAllTags` API `[ref: SDD/Implementation Examples — TagPickerModal; SDD/Implementation Gotchas — getAllTags import]`
  2. Test: Modal lists all vault tags (merged frontmatter + inline); tags displayed with `#` prefix; search filters tags; clicking a tag calls `onSelect(normalizedTag)` (without `#`); when `availableTags` filter provided, only those tags shown; empty state for no matches
  3. Implement: Create `src/settings/components/TagPickerModal.ts` — class extends `Modal`. Uses `getAllTags(app.metadataCache)` → strips `#` from keys → sorts. Optional `availableTags` filter for key-level picker. Calls `normalizeTag()` from T1.2 on selection.
  4. Validate: Test in Obsidian dev vault with both frontmatter and inline tags; filter works; normalized output correct
  5. Success: Tag picker shows merged tag set and returns normalized tags `[ref: PRD/AC-7.1, AC-7.6]`

- [ ] **T2.4 PathEntry component** `[activity: frontend-ui]`

  1. Prime: Read SDD path entry structure and CSS `.kado-path-entry` `[ref: SDD/CSS Architecture; SDD/Building Block View]`
  2. Test: Renders row with: remove button, path text input, browse button, permission matrix; clicking browse opens VaultFolderModal and inserts selected path; remove button calls `onRemove()`; path input `onChange` updates rule and saves; matrix integrated via `renderPermissionMatrix()`
  3. Implement: Create `src/settings/components/PathEntry.ts` — export `renderPathEntry(containerEl, pathRule, options)`. Composes VaultFolderModal and PermissionMatrix. Path input validates: no `..`, no absolute path, no leading `/`.
  4. Validate: Renders correctly with picker integration; path validation rejects traversal; lint clean
  5. Success: Complete path row with picker + matrix `[ref: PRD/AC-5.2, AC-5.3, AC-5.4]`

- [ ] **T2.5 TagEntry component** `[activity: frontend-ui]`

  1. Prime: Read SDD tag entry structure and CSS `.kado-tag-entry`, `.kado-tag-read-badge` `[ref: SDD/CSS Architecture]`
  2. Test: Renders row with: remove button, tag text input (editable, with `#` display), browse/picker button, fixed "R" badge; clicking picker opens TagPickerModal; tag input normalizes on blur (strips `#`, trims); placeholder shows format hints; when `availableTags` provided, picker filters to those
  3. Implement: Create `src/settings/components/TagEntry.ts` — export `renderTagEntry(containerEl, tag, options)`. Composes TagPickerModal. Displays `#` prefix in input but stores without. Shows fixed read-only badge.
  4. Validate: Tag normalization works; picker integration works; "R" badge always visible
  5. Success: Tag entry with picker, normalization, and read-only indicator `[ref: PRD/AC-7.1, AC-7.3, AC-7.5, AC-7.6]`

- [ ] **T2.6 CSS styles** `[activity: frontend-ui]` `[parallel: true]`

  1. Prime: Read SDD CSS Architecture section `[ref: SDD/CSS Architecture]`
  2. Test: All `.kado-` classes defined; colors use Obsidian CSS variables only; layout works in both dark and light Obsidian themes
  3. Implement: Write `styles.css` with all classes from SDD: tab bar, permission matrix, path/tag entries, picker modal, list mode toggle, danger zone. All colors via `var(--...)`.
  4. Validate: Visual inspection in Obsidian dark and light themes; no hardcoded colors
  5. Success: Styles render correctly inheriting Obsidian theme `[ref: SDD/Constraints CON-3]`

- [ ] **T2.7 Phase Validation** `[activity: validate]`

  Run all Phase 2 tests. Verify all components render correctly in isolation. `npm run build` and `npm run lint` pass. Verify accessibility attributes on interactive elements.
