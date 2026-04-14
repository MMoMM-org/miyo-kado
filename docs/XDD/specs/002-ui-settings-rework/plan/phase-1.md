---
title: "Phase 1: Data Model & Config Extensions"
status: completed
version: "1.0"
phase: 1
---

# Phase 1: Data Model & Config Extensions

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Data Storage Changes]` — Type modifications for GlobalArea, KeyAreaConfig, AuditConfig
- `[ref: SDD/Application Data Models]` — Entity field and behavior changes
- `[ref: PRD/Feature 4]` — Audit log vault-relative path requirements
- `[ref: PRD/Feature 6]` — Whitelist/blacklist toggle requirements
- `[ref: PRD/Feature 7]` — Tag filtering requirements

**Key Decisions**:
- ADR-2: Extend existing types (don't replace). Add `listMode`, `tags` to GlobalArea; `tags` to KeyAreaConfig; `logDirectory`, `logFileName`, `maxRetainedLogs` to AuditConfig.
- ADR-4: Tags stored without `#`. Wildcard `*` only at end.
- ADR-5: `listMode` on GlobalArea, not per-rule.

**Dependencies**: None — this is the foundation phase.

---

## Tasks

Establishes the extended data model and config management that all subsequent phases depend on.

- [ ] **T1.1 Extend canonical types** `[activity: domain-modeling]`

  1. Prime: Read `src/types/canonical.ts` `[ref: SDD/Data Storage Changes]`
  2. Test: Type compilation checks — new fields exist on GlobalArea (listMode, tags), KeyAreaConfig (tags), AuditConfig (logDirectory, logFileName, maxRetainedLogs); `createDefaultConfig()` returns correct defaults; ListMode type accepts only 'whitelist' | 'blacklist'
  3. Implement: Modify `src/types/canonical.ts` — add `ListMode` type, extend interfaces, update `createDefaultConfig()` factory. Remove `logFilePath` from AuditConfig, add `logDirectory: 'logs'`, `logFileName: 'kado-audit.log'`, `maxRetainedLogs: 3`. Add `listMode: 'whitelist'` and `tags: []` to GlobalArea default.
  4. Validate: `npm run build` passes; existing tests still pass; new defaults verified
  5. Success: All new fields typed and defaulted correctly `[ref: PRD/F4, F6, F7]`

- [ ] **T1.2 Tag normalization utilities** `[activity: domain-modeling]` `[parallel: true]`

  1. Prime: Read PRD Feature 7 acceptance criteria and SDD ADR-4 `[ref: PRD/Feature 7; SDD/ADR-4]`
  2. Test: `normalizeTag('#project')` → `'project'`; `normalizeTag('project')` → `'project'`; `normalizeTag('#this/is/a/tag')` → `'this/is/a/tag'`; `normalizeTag('  #tag  ')` → `'tag'`; `normalizeTag('')` → `null`; `isWildcardTag('project/*')` → `true`; `isWildcardTag('project')` → `false`; `matchTag('project/a', 'project/*')` → `true`; `matchTag('project', 'project/*')` → `false`; `matchTag('project/a/b', 'project/*')` → `true`; `matchTag('other', 'project/*')` → `false`; `matchTag('project', 'project')` → `true`
  3. Implement: Create `src/core/tag-utils.ts` with `normalizeTag()`, `isWildcardTag()`, `matchTag()` functions
  4. Validate: Unit tests pass; lint clean; no obsidian imports (core isolation)
  5. Success: Tags normalized consistently; wildcards match only descendants `[ref: PRD/AC-7.1, AC-7.2, AC-7.4]`

- [ ] **T1.3 Extend ConfigManager** `[activity: domain-modeling]`

  1. Prime: Read `src/core/config-manager.ts` and T1.1 type changes `[ref: SDD/Application Data Models]`
  2. Test: `addGlobalArea()` creates area with listMode='whitelist' and empty tags; `load()` merges new default fields into old config shapes (missing listMode gets 'whitelist', missing tags gets []); config round-trips correctly through save/load
  3. Implement: Update `ConfigManager` — ensure `load()` merge handles missing new fields gracefully (deep merge with defaults). No new methods needed — existing `addGlobalArea()`, `removeGlobalArea()` work with extended types.
  4. Validate: Existing config-manager tests pass; new merge tests pass; `npm run build` clean
  5. Success: Old configs gain new defaults on load; new areas created with correct defaults `[ref: SDD/Implementation Gotchas — Config merge on load]`

- [ ] **T1.4 Extend audit log rotation** `[activity: domain-modeling]`

  1. Prime: Read `src/core/audit-logger.ts` and SDD rotation example `[ref: SDD/Implementation Examples — Audit Log Rotation]`
  2. Test: Rotation with maxRetainedLogs=3 shifts log→.1, .1→.2, .2→.3, deletes .4 if exists; rotation with maxRetainedLogs=1 shifts log→.1, deletes .2; `updateConfig()` accepts new AuditConfig shape; NDJSON write still works after rotation
  3. Implement: Modify `AuditLogger` — extend rotation logic to shift N files. Update `AuditLoggerDeps` to include `exists()`, `rename()`, `remove()` callbacks. Keep backward compat for existing `rotate()` callback by replacing it with the new multi-file approach.
  4. Validate: Unit tests pass with mock I/O; existing audit tests adapted; lint clean
  5. Success: Multi-file rotation works with configurable retention `[ref: PRD/AC-4.5, AC-4.6]`

- [ ] **T1.5 Phase Validation** `[activity: validate]`

  Run all Phase 1 tests. Verify `npm run build` and `npm run lint` pass. Confirm all new types, utilities, config merge, and rotation logic work together.
