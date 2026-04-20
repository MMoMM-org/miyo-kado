---
title: "Phase 1: Core Foundation — Types, Config, Feature Gate, Adapter"
status: pending
version: "1.0"
phase: 1
---

# Phase 1: Core Foundation — Types, Config, Feature Gate, Adapter

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Constraints; lines: CON-1..CON-7]`
- `[ref: SDD/Interface Specifications/Data Storage Changes]`
- `[ref: SDD/Interface Specifications/Application Data Models]`
- `[ref: SDD/Implementation Examples/Example 1 (Feature Gate)]`
- `[ref: SDD/Implementation Examples/Example 2 (Workspace Enumeration)]`
- `[ref: SDD/Architecture Decisions/ADR-2, ADR-3, ADR-6]`

**Key Decisions**:
- ADR-2: feature gate is a pure function, not a PermissionGate entry.
- ADR-3: enumerate only `markdown`, `canvas`, `pdf`, `image`; skip non-file views via `view.file` nullish check.
- ADR-6: per-key default `false`; evaluated as AND with global — no inheritance.

**Dependencies**:
- None. This is the foundation phase.

---

## Tasks

Phase 1 establishes the type surface, config migration, feature-gate logic, and workspace enumeration. These four pieces are independent of MCP registration and settings UI, enabling parallel review.

- [ ] **T1.1 Canonical types + default factories** `[activity: domain-modeling]`

  1. **Prime**: Read existing `SecurityConfig`, `ApiKeyConfig`, `CoreError` types `[ref: src/types/canonical.ts; lines: 199-281]`; read request-type discriminator pattern `[ref: SDD/Interface Specifications/Application Data Models]`.
  2. **Test**: `createDefaultSecurityConfig()` returns `allowActiveNote: false` and `allowOtherNotes: false`; factory for new `ApiKeyConfig` (verify via inspecting `config-manager` migration) likewise defaults both to `false`; type exports for `OpenNotesScope`, `CoreOpenNotesRequest`, `OpenNoteType`, `OpenNoteDescriptor`, `CoreOpenNotesResult` compile and are importable from `src/types/canonical.ts`.
  3. **Implement**: Extend `SecurityConfig` and `ApiKeyConfig` interfaces with the two new boolean fields; update `createDefaultSecurityConfig()` and `createDefaultConfig()` to include them set to `false`; add the five new type exports; add a type guard `isCoreOpenNotesRequest()` following the existing guard pattern.
  4. **Validate**: `npx tsc --noEmit`; `npx tsc --noEmit -p tsconfig.test.json`; `npm run lint`. No existing tests should break.
  5. **Success**:
     - [ ] New fields present and default `false` `[ref: PRD/AC Feature-2 "defaults to false"]`
     - [ ] Types importable and compile `[ref: SDD/Application Data Models]`

- [ ] **T1.2 Config migration (default-merge)** `[activity: backend-api]` `[parallel: true]`

  1. **Prime**: Read existing migration flow `[ref: src/core/config-manager.ts; lines: 31-88]` — how `listMode`, `paths`, `tags` defaults get applied to older configs.
  2. **Test**: Loading a legacy config JSON with no `allowActiveNote` / `allowOtherNotes` at global or key level results in all four flags being `false`; loading a config that has the fields set to `true` preserves them; loading a malformed non-boolean value coerces to `false` (defensive). Test must use a real (fake-fs or in-memory) config object, not only types.
  3. **Implement**: In `config-manager.ts` load path, extend the merge steps to set missing fields to `false` on both `config.security` and each `apiKey` entry.
  4. **Validate**: Run the new migration tests; run existing migration tests unchanged; `npx tsc --noEmit` both src and test tsconfig.
  5. **Success**:
     - [ ] Existing configs load without manual intervention `[ref: PRD/Constraints "must not require schema version bump"]`
     - [ ] All four flags default to `false` on legacy configs `[ref: PRD/AC Feature-2]`

- [ ] **T1.3 Feature-gate pure function `gateOpenNoteScope`** `[activity: backend-api]` `[parallel: true]`

  1. **Prime**: Read SDD feature-gate example including the decision matrix `[ref: SDD/Implementation Examples/Example 1; traced-walkthrough table]`.
  2. **Test**: All seven rows of the traced walkthrough (scope × gate-state → outcome); additionally: error message contains the name(s) of the off flag(s); denial uses `code: 'FORBIDDEN'` and `gate: 'feature-gate'`; function is pure — repeated calls with same input yield identical outputs; no mutation of inputs.
  3. **Implement**: Create `src/core/gates/open-notes-gate.ts` exporting `gateOpenNoteScope(scope, global, key)` returning a `FeatureGateOutcome` discriminated union (`allow-both` | `allow-active-only` | `allow-other-only` | `deny`).
  4. **Validate**: `npm run lint`; `npx tsc --noEmit -p tsconfig.test.json`; tests are the source of truth for every branch.
  5. **Success**:
     - [ ] Denial on single gated scope returns `FORBIDDEN` with `gate: 'feature-gate'` `[ref: PRD/AC Feature-3 error semantics]`
     - [ ] `scope: all` with one category on returns the appropriate `allow-*-only` outcome, no error `[ref: PRD/AC Feature-3 silent filter]`
     - [ ] `scope: all` with both off returns `FORBIDDEN` `[ref: PRD/AC Feature-3]`
     - [ ] AND-combination of global and key (no inheritance) `[ref: PRD/AC Feature-2; SDD/ADR-6]`

- [ ] **T1.4 Workspace adapter `enumerateOpenNotes`** `[activity: backend-api]` `[parallel: true]`

  1. **Prime**: Read existing workspace API usage `[ref: src/obsidian/note-adapter.ts; lines: 131-138]`; read SDD adapter example `[ref: SDD/Implementation Examples/Example 2]`.
  2. **Test**: With a mocked `App` where workspace has zero leaves → returns `[]`; with one markdown leaf focused → returns one entry with `active: true`, `type: 'markdown'`, correct `name` and `path`; with two markdown panes on same file, one focused → returns ONE entry with `active: true` (dedupe by path with active-upgrade); with a non-file leaf (e.g., view returning undefined `file`) → excluded from output; with an unknown known-type (canvas) containing a `TFile` → returned with `type: 'canvas'`; with a leaf whose view type is NOT in `KNOWN_VIEW_TYPES` → not returned.
  3. **Implement**: Create `src/obsidian/open-notes-adapter.ts` exporting `enumerateOpenNotes(app: App)` that iterates the known view types, extracts descriptor per leaf, de-duplicates by path preferring `active: true`.
  4. **Validate**: Unit tests pass with mocked `App`/`Workspace`; `npx tsc --noEmit` both configs; `npm run lint`.
  5. **Success**:
     - [ ] Correctly identifies the active leaf when a file is focused `[ref: PRD/AC Feature-1 "active: true for focused file"]`
     - [ ] Returns `[]` when nothing relevant is open `[ref: PRD/AC Feature-1 "no file open → notes: []"]`
     - [ ] Dedupes linked panes, upgrading to `active: true` when any pane is focused `[ref: SDD/Gotchas "dedup by path with active-preference"]`
     - [ ] Excludes non-file views and unknown view types `[ref: PRD/AC Feature-5 "non-file view excluded"; SDD/ADR-3]`

- [ ] **T1.5 Phase 1 Validation** `[activity: validate]`

  - Run all new Phase 1 unit tests. Run both tsconfig typechecks (`src` and `test`). Run `npm run lint`. Run `npm run build` to confirm the production bundle still compiles. Verify no existing tests regress. Confirm ADRs 2, 3, 6 are respected in code and commit messages reference SDD.

---

## Deviation Log

*No deviations recorded yet. If implementation requires changes from the SDD, record here with rationale and user approval.*
