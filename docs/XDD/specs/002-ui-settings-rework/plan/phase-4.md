---
title: "Phase 4: Wiring & Audit Migration"
status: completed
version: "1.0"
phase: 4
---

# Phase 4: Wiring & Audit Migration

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Implementation Boundaries — Must Preserve]` — Core pipeline, gates, adapters unchanged
- `[ref: SDD/System Context Diagram]` — Plugin → ConfigManager → SettingsTab wiring
- `[ref: SDD/Implementation Gotchas]` — Config merge, audit path resolution, modal lifecycle

**Key Decisions**:
- ADR-2: Audit log moves from `.obsidian/`-relative to vault-relative (`logDirectory/logFileName`)
- Old `settings.ts` deleted, replaced by `settings/SettingsTab.ts`

**Dependencies**: Phase 1 (types, config, audit), Phase 2 (components), Phase 3 (tabs)

---

## Tasks

Wires the new settings UI into the plugin, migrates audit log path resolution, and removes the old settings file.

- [ ] **T4.1 Update main.ts audit path resolution** `[activity: backend-api]`

  1. Prime: Read `src/main.ts` `resolvedAuditLogPath` getter and SDD audit config changes `[ref: SDD/Application Data Models — AuditConfig]`
  2. Test: `resolvedAuditLogPath` returns `{vaultPath}/{logDirectory}/{logFileName}` (not `{configDir}/...`); path sanitization still blocks `..` and absolute paths; rotation callbacks use new multi-file rotation from T1.4; `exists()`, `rename()`, `remove()` callbacks wired to `vault.adapter`
  3. Implement: Modify `src/main.ts` — change `resolvedAuditLogPath` to resolve against vault root (using `app.vault.adapter.getBasePath()` or constructing from vault path). Update `AuditLoggerDeps` wiring to provide `exists`, `rename`, `remove` callbacks. Update rotation callback to use new multi-file logic.
  4. Validate: Audit log created in vault-relative directory; rotation shifts files correctly; sanitization still works
  5. Success: Audit log written to vault-relative path `[ref: PRD/AC-4.2, AC-4.3, AC-4.5]`

- [ ] **T4.2 Replace settings.ts with new SettingsTab** `[activity: frontend-ui]`

  1. Prime: Read `src/main.ts` line where `KadoSettingTab` is registered `[ref: SDD/Implementation Boundaries — Can Modify]`
  2. Test: Plugin loads with new `SettingsTab` from `src/settings/SettingsTab.ts`; old `settings.ts` no longer imported; all tab navigation works; config changes persist through save/load cycle
  3. Implement: Delete `src/settings.ts`. Update `src/main.ts` import to `import { KadoSettingsTab } from './settings/SettingsTab'`. Ensure `addSettingTab(new KadoSettingsTab(...))` call signature matches.
  4. Validate: Plugin loads in Obsidian; settings tab opens; all tabs render; config persists
  5. Success: Clean cutover from old to new settings UI `[ref: SDD/Directory Map — DELETE settings.ts]`

- [ ] **T4.3 Verify server lock integration** `[activity: integration]`

  1. Prime: Read SDD server configuration flow `[ref: SDD/Runtime View — Settings Tab Navigation]`
  2. Test: Start server via settings → host/port/connection type fields disabled; stop server → fields re-enabled; change host/port while stopped → server starts on new address; server status indicator updates in real-time
  3. Implement: Verify `GeneralTab` reads `plugin.mcpServer.isRunning()` correctly. Ensure `handleServerToggle()` calls `saveAndRestartIfRunning()` from the new tab. No new code expected — just integration verification.
  4. Validate: Full server start/stop/restart cycle works through new UI
  5. Success: Server lock works end-to-end `[ref: PRD/AC-2.1-2.4, AC-3.1-3.3]`

- [ ] **T4.4 Verify tag × path intersection filter** `[activity: backend-api]`

  1. Prime: Read `src/mcp/tools.ts` `filterResultsByScope()` and PRD business rule `[ref: PRD/Feature 7 — Business Rule Tag × Path Intersection; SDD/Technical Debt]`
  2. Test: `kado-search` with `byTag` for a tag → results only include files within key's permitted paths; files outside allowed paths but with matching tag are excluded; test with both frontmatter and inline tags in test vault
  3. Implement: If `filterResultsByScope()` already filters `byTag` results by permitted paths, no change needed. If not, extend the function to apply path filtering to tag search results.
  4. Validate: Unit tests verify intersection; integration test in Obsidian confirms behavior
  5. Success: Tag searches respect path boundaries `[ref: PRD/Feature 7 — Business Rule]`

- [ ] **T4.5 Phase Validation** `[activity: validate]`

  Run all Phase 4 tests. Full plugin lifecycle: load → open settings → configure → start server → verify audit log in vault directory → stop server → verify settings persist after reload. `npm run build` and `npm run lint` pass.
