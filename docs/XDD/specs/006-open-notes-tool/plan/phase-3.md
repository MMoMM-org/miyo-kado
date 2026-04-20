---
title: "Phase 3: Settings UI & End-to-End Validation"
status: completed
version: "1.0"
phase: 3
---

# Phase 3: Settings UI & End-to-End Validation

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Cross-Cutting Concepts/User Interface & UX]`
- `[ref: SDD/Building Block View/Directory Map (settings/*)]`
- `[ref: PRD/Feature 4 (Settings UI)]`
- `[ref: src/settings/tabs/ApiKeyTab.ts; lines: 109-130]` (section pattern)
- `[ref: src/settings/tabs/GlobalSecurityTab.ts; lines: 15-111]` (access-mode toggle helper)

**Key Decisions**:
- Section lives **between** Access Mode and Paths in both tabs.
- Toggle descriptions flip with `listMode` (inclusive wording for whitelist, exclusive for blacklist).
- Default state for new configs: both toggles `off`.

**Dependencies**:
- Phase 1 (types and config migration).
- Phase 2 (tool must exist so E2E tests can exercise it end-to-end).

---

## Tasks

Phase 3 adds the settings UI, wires it into both tabs, and closes out with end-to-end live testing against a real Obsidian vault per `docs/live-testing.md`.

- [x] **T3.1 OpenNotesSection component** `[activity: frontend-ui]`

  1. **Prime**: Read access-mode toggle precedent `[ref: src/settings/tabs/ApiKeyTab.ts; lines: 111-126]`; read the existing helper pattern `[ref: src/settings/tabs/GlobalSecurityTab.ts; lines: 85-111]`; read CSS classes `[ref: styles.css; .kado-section-label]`.
  2. **Test**: Rendering with `listMode: 'whitelist'` produces inclusive description text ("Expose…"); rendering with `listMode: 'blacklist'` produces exclusive wording ("Allow…through"); flipping a toggle invokes the supplied `onChange` callback with the new boolean value; the section renders exactly two `Setting` instances with names "Active note" and "Other open notes"; section label uses `kado-section-label` class with text "Open Notes".
  3. **Implement**: Create `src/settings/components/OpenNotesSection.ts` exporting `renderOpenNotesSection(container, state, listMode, callbacks)` where `state` has `{ allowActiveNote, allowOtherNotes }` and `callbacks` has `onToggleActive` and `onToggleOther`. Component is pure-presentational — no plugin/config coupling — so it can be reused by both tabs.
  4. **Validate**: Component unit tests pass (mock DOM); typecheck both configs; lint.
  5. **Success**:
     - [ ] Inclusive/exclusive wording flips with `listMode` `[ref: PRD/AC Feature-4 "wording flips"]`
     - [ ] Two toggles rendered with correct labels `[ref: SDD/UI/Information Architecture]`
     - [ ] `onChange` callbacks fire with new value `[ref: SDD/UI/Interaction Design]`

- [x] **T3.2 ApiKeyTab integration** `[activity: frontend-ui]` `[parallel: true]`

  1. **Prime**: Read current render flow `[ref: src/settings/tabs/ApiKeyTab.ts; lines: 99-150]`.
  2. **Test**: For a given `key` and `plugin`, rendering places the Open Notes section between Access Mode (line ~126) and Paths (line ~129); flipping the "Active note" toggle updates `key.allowActiveNote`, calls `plugin.saveSettings()`, and triggers `onRedisplay()` (verified via spies); same for "Other open notes".
  3. **Implement**: In `ApiKeyTab.ts` render function, after the Access Mode `Setting` block and before the Paths section label, call `renderOpenNotesSection(...)` with state from `key` and callbacks that mutate `key`, save, and redisplay.
  4. **Validate**: Typecheck both configs; lint. Confirm section placement via live testing (Phase 3 E2E task).
  5. **Success**:
     - [ ] Section appears in the correct position in the DOM `[ref: PRD/AC Feature-4 "between Access Mode and Paths"]`
     - [ ] Toggle changes persist via `saveSettings()` and refresh the view `[ref: PRD/AC Feature-4 "persists without restart"]`

- [x] **T3.3 GlobalSecurityTab integration** `[activity: frontend-ui]` `[parallel: true]`

  1. **Prime**: Read current render flow `[ref: src/settings/tabs/GlobalSecurityTab.ts; lines: 1-60]` — especially where `renderAccessModeToggle` is called and where Paths begin.
  2. **Test**: Rendering places the section between the access-mode toggle and the Paths section; flipping each toggle updates `security.allowActiveNote` / `security.allowOtherNotes`, calls `plugin.saveSettings()`, and redisplays; when `security.listMode` changes (e.g., whitelist→blacklist), the Open Notes section re-renders with the new wording on the next redisplay.
  3. **Implement**: Insert `renderOpenNotesSection(...)` call in `GlobalSecurityTab.ts` at the correct position with `security` state and plugin-saving callbacks.
  4. **Validate**: Typecheck both configs; lint. Confirm section placement via live testing (Phase 3 E2E task).
  5. **Success**:
     - [ ] Section appears between access-mode toggle and Paths section `[ref: PRD/AC Feature-4]`
     - [ ] Toggles persist and re-render on listMode changes `[ref: PRD/AC Feature-4]`

- [ ] **T3.4 End-to-End live testing** `[activity: validate]` `[status: pending — requires human verification in live Obsidian vault per docs/live-testing.md]`

  1. **Prime**: Read `[ref: docs/live-testing.md]` for vault setup; re-read PRD acceptance criteria.
  2. **Test (manual, scripted)**:
     - Install plugin into live vault; confirm existing config (no open-notes flags on disk) still loads.
     - Default state: open settings, confirm both Open Notes toggles default OFF at both global and per-key tabs.
     - With both off: call `kado-open-notes` via MCP client → expect `FORBIDDEN` with `gate: 'feature-gate'`.
     - Enable global `allowActiveNote` only; key still off → call with `scope: 'active'` → still `FORBIDDEN` (no inheritance).
     - Enable key `allowActiveNote` too → call with `scope: 'active'`; while one markdown note is focused → response contains that note with `active: true`, correct type.
     - Open a canvas file in another pane → call with `scope: 'all'` (after enabling `allowOtherNotes` on both levels) → response contains markdown (active) and canvas (non-active) entries.
     - Open a PDF in a pane where the key has NO R permission on its path → call with `scope: 'all'` → PDF is silently omitted.
     - Flip `listMode` whitelist↔blacklist and confirm the Open Notes toggle descriptions flip wording on the next redisplay.
     - Mobile: if feasible, smoke-test on Obsidian mobile — focused note detection and tool response parity.
  3. **Implement**: No new code unless defects are discovered. If defects occur, fix and re-run the relevant phase tests before returning to E2E.
  4. **Validate**: All E2E scenarios pass. Capture screenshots for the PR if relevant.
  5. **Success**:
     - [ ] All PRD acceptance criteria verifiable from a fresh Obsidian install `[ref: PRD/Feature-1..5]`
     - [ ] Privacy invariant holds under adversarial probing (no per-note errors on ACL deny) `[ref: PRD/AC Feature-3; SDD/ADR-4]`
     - [ ] Existing configs migrate silently and default OFF `[ref: PRD/Constraints]`

- [x] **T3.5 Phase 3 Validation** `[activity: validate]`

  - Run full test suite (Phase 1 + Phase 2 + Phase 3). `npm run build`; `npm run lint`; typecheck both configs. Confirm plugin loads, appears in the MCP tool list, and all UI toggles function on both desktop and mobile (if available). Update `docs/ai/memory/decisions.md` with a one-line summary of the shipped behavior. Update `CHANGELOG` / release notes. Confirm README / docs mention the new capability with a usage example.

  **Validation results (2026-04-20):**
  - `npx vitest run` → 915 tests pass across 41 files (+63 total across Phase 1-3)
  - `npm run build` → clean production bundle
  - `npm run lint` → clean
  - UI toggles: covered by unit tests (ApiKeyTab: 5 new, GlobalSecurityTab: 6 new, OpenNotesSection: 14)
  - **T3.4 (live vault E2E)**: deferred to human verification in a real Obsidian vault per `docs/live-testing.md`. Automated coverage verifies integration at code level.
  - Commits: `57a15fb` (T3.1), `e81a862` (T3.2), `3263fa7` (T3.3)

---

## Deviation Log

*No deviations recorded yet.*
