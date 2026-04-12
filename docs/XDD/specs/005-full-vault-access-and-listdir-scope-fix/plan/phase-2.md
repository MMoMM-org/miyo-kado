---
title: "Phase 2: Settings UI"
status: completed
version: "1.0"
phase: 2
---

# Phase 2: Settings UI

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Cross-Cutting Concepts/User Interface & UX]` — VaultFolderModal wireframe, PathEntry change
- `[ref: SDD/Implementation Examples/Example 3]` — synthetic picker entry code
- `[ref: SDD/Architecture Decisions/ADR-1]` — `**` as official full-vault pattern

**Key Decisions**:
- ADR-1: `**` is the official full-vault pattern — must be discoverable in the UI

**Dependencies**: Phase 1 (T1.1 specifically — `**` must pass validation before the UI can use it).

---

## Tasks

Enables administrators to configure full vault access through the settings UI.

- [ ] **T2.1 VaultFolderModal: add `** (Full vault)` entry** `[activity: frontend-ui]`

  1. Prime: Read `src/settings/components/VaultFolderModal.ts` `[ref: SDD/Cross-Cutting Concepts/User Interface & UX]`
  2. Test: Modal shows `** (Full vault)` as first entry; selecting it calls `onSelect("**")`; search filter for "full" or "**" shows the entry; entry appears above all vault folders
  3. Implement:
     - In `onOpen()`, before `renderList()`, insert a `** (Full vault)` button as first child of `listEl`
     - The entry uses the same `kado-picker-item` class
     - Search filter includes the entry when query matches "**" or "full vault" (case-insensitive)
  4. Validate: Manual test in Obsidian dev vault; lint clean; build clean
  5. Success:
     - [ ] `** (Full vault)` is the first entry in the picker `[ref: PRD/Feature 1/AC-1]`
     - [ ] Selecting it stores `**` in the path config `[ref: PRD/Feature 1/AC-2]`

- [ ] **T2.2 PathEntry: improve `/` rejection message** `[activity: frontend-ui]`

  1. Prime: Read `src/settings/components/PathEntry.ts` lines 48-73 `[ref: SDD/Interface Specifications/PathEntry validation]`
  2. Test: Typing `/` shows error with suggestion to use `**`; typing `**` passes validation cleanly (no error, no warning)
  3. Implement:
     - In the `change` handler, when `value.startsWith('/')`, show a Notice: "/ is not a valid path. Use ** for full vault access or pick a folder."
     - Verify that `**` already passes through (it should after T1.1 removes the warning)
  4. Validate: Manual test in Obsidian dev vault; lint clean; build clean
  5. Success:
     - [ ] `/` input shows helpful error message `[ref: PRD/Feature 5/AC-1]`
     - [ ] `**` input accepted without error or warning `[ref: PRD/Feature 1/AC-5]`

- [ ] **T2.3 Phase 2 Validation** `[activity: validate]`

  Run full validation:
  ```bash
  npm run build && npm run lint
  ```
  Manual verification: open settings in dev vault, test the folder picker and path input.
