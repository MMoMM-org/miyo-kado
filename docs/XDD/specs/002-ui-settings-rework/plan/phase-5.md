---
title: "Phase 5: Integration Testing & Polish"
status: pending
version: "1.0"
phase: 5
---

# Phase 5: Integration Testing & Polish

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: PRD/All Features]` — Full acceptance criteria sweep
- `[ref: SDD/Quality Requirements]` — Performance, usability, security, reliability targets
- `[ref: SDD/Acceptance Criteria]` — EARS-format system criteria
- `[ref: SDD/Risks and Technical Debt]` — Known gotchas to verify

**Key Decisions**:
- All prior ADRs — verify they were implemented correctly
- Tag × Path intersection rule — verify backend behavior matches PRD business rule

**Dependencies**: All previous phases complete

---

## Tasks

Final validation sweep ensuring all PRD acceptance criteria are met, edge cases handled, and the plugin is ready for use.

- [ ] **T5.1 End-to-end settings walkthrough** `[activity: integration]`

  1. Prime: Read PRD Features 1-12 acceptance criteria `[ref: PRD/Feature Requirements]`
  2. Test: Execute complete first-time setup journey in test vault:
     - Open settings → version + docs link visible
     - General tab: server stopped, fields editable
     - Create global area → default-deny, whitelist mode
     - Add path via picker → matrix appears, toggle dots
     - Add tag via picker → read badge shown, tag normalized
     - Toggle list mode → description text updates
     - Create API key → new tab appears
     - Copy key → clipboard works
     - Rename key → tab label updates
     - Assign key to area → constrained matrix shown
     - Enable audit → set directory via picker, set filename
     - Start server → fields lock, status shows "Running on..."
     - Stop server → fields unlock
     - Regenerate key → confirm → new secret, same assignments
     - Delete key → confirm (default=Cancel) → tab removed
     - Remove area → cascades to key assignments
  3. Implement: Fix any issues discovered during walkthrough
  4. Validate: All 34 PRD acceptance criteria pass
  5. Success: Complete first-time setup journey works end-to-end `[ref: PRD/User Journey — First-Time Setup]`

- [ ] **T5.2 Edge case verification** `[activity: integration]`

  1. Prime: Read PRD edge cases and SDD error handling `[ref: SDD/Error Handling; PRD/Detailed Feature Specifications — Edge Cases]`
  2. Test:
     - Area with no paths/tags → no access (default-deny preserved)
     - Path with `..` traversal → rejected with inline error
     - Absolute path → rejected
     - Tag with `#` prefix → stored without `#`, displayed with `#`
     - Wildcard `#project/*` → matches `project/a`, `project/b/c`, NOT `project`
     - Empty tag after normalization → not added
     - Delete only API key → allowed, no crash
     - Rename key to duplicate name → allowed (labels not unique)
     - Regenerate key while server running → old key immediately invalid
     - Tab bar with 10+ keys → scroll buttons appear and work
     - Audit log at max size → rotates correctly, retains N files
     - Clipboard failure → shows Notice, doesn't crash
  3. Implement: Fix any edge case failures
  4. Validate: All edge cases handled gracefully
  5. Success: All documented edge cases pass `[ref: PRD/Detailed Feature Specifications — Edge Cases]`

- [ ] **T5.3 Theme compatibility check** `[activity: frontend-ui]`

  1. Prime: Read SDD constraint CON-3 `[ref: SDD/Constraints CON-3]`
  2. Test: Open settings in Obsidian default dark theme → all elements visible, readable, correct contrast; switch to Obsidian default light theme → same verification; no hardcoded colors in DOM; all colors from CSS variables
  3. Implement: Fix any theme-specific issues (typically border colors, text contrast)
  4. Validate: Both themes render correctly
  5. Success: Settings UI works in dark and light Obsidian themes `[ref: SDD/Constraints CON-3]`

- [ ] **T5.4 Cleanup and final validation** `[activity: validate]`

  1. Prime: Read all SDD sections for completeness `[ref: SDD/All Sections]`
  2. Test: `npm run build` clean; `npm run lint` clean; `npx vitest run` all pass; no console errors in Obsidian dev tools; old `settings.ts` fully removed; no dead code remaining
  3. Implement: Remove any TODO comments, unused imports, or debug logging added during development
  4. Validate: Production build succeeds; plugin loads cleanly in Obsidian
  5. Success:
    - [ ] All 34 PRD acceptance criteria verified `[ref: PRD/All Features]`
    - [ ] All 5 ADRs implemented correctly `[ref: SDD/Architecture Decisions]`
    - [ ] Build, lint, tests all green
    - [ ] Plugin loads and settings tab works end-to-end
