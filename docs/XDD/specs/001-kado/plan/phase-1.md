---
title: "Phase 1: Foundation — Types, Config, Plugin Scaffold"
status: pending
version: "1.0"
phase: 1
---

# Phase 1: Foundation — Types, Config, Plugin Scaffold

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Canonical Types]` — All interfaces in `src/types/canonical.ts`
- `[ref: SDD/Configuration Types]` — KadoConfig, ApiKeyConfig, GlobalArea, ServerConfig, AuditConfig
- `[ref: SDD/Directory Map]` — Overall project structure
- `[ref: SDD/ADR-5]` — Single data.json via Obsidian native API
- `[ref: SDD/ADR-6]` — API key format (kado_ + UUID)

**Key Decisions**:
- Core types have zero dependencies on MCP SDK or Obsidian API (ADR-1)
- All config persisted via `plugin.loadData()` / `plugin.saveData()` (ADR-5)
- API keys are `kado_` + `crypto.randomUUID()` (ADR-6)

**Dependencies**:
- None — this is the first phase

---

## Tasks

Establishes the type system, configuration management, and plugin entry point that all subsequent phases depend on.

- [ ] **T1.1 Canonical Type Definitions** `[activity: domain-modeling]`

  1. Prime: Read SDD Canonical Types section and Configuration Types section `[ref: SDD/Interface Specifications]`
  2. Test: Type compilation check — all types compile with strict mode; factory functions produce valid instances; type guards discriminate correctly between CoreReadRequest, CoreWriteRequest, CoreSearchRequest
  3. Implement: Create `src/types/canonical.ts` with all request types (CoreReadRequest, CoreWriteRequest, CoreSearchRequest), result types (CoreFileResult, CoreWriteResult, CoreSearchResult), error types (CoreError, CoreErrorCode), gate types (GateResult, PermissionGate), and config types (KadoConfig, ApiKeyConfig, GlobalArea, ServerConfig, AuditConfig, DataTypePermissions, CrudFlags)
  4. Validate: `npm run build` passes (tsc -noEmit); no lint errors; types importable from other modules
  5. Success: All canonical types compile and are importable; no MCP or Obsidian imports in the file `[ref: SDD/ADR-1]`

- [ ] **T1.2 ConfigManager** `[activity: domain-modeling]`

  1. Prime: Read SDD Configuration Types and data storage section `[ref: SDD/ADR-5]` `[ref: SDD/Data Storage]`
  2. Test: Default config is valid KadoConfig with empty areas and keys; loadConfig merges stored data with defaults; saveConfig round-trips correctly; generateApiKey produces `kado_` prefixed UUID; addArea/removeArea/addKey/revokeKey mutations work correctly; getKeyById returns undefined for unknown keys
  3. Implement: Create `src/core/config-manager.ts` — ConfigManager class with `load(data)`, `save()`, `getConfig()`, `generateApiKey(label)`, `revokeKey(id)`, `addGlobalArea(area)`, `removeGlobalArea(id)`, `getKeyById(id)`. Config manager receives load/save callbacks (no direct Obsidian dependency).
  4. Validate: Unit tests pass; lint clean; types check
  5. Success: ConfigManager creates, stores, and retrieves config with API keys and global areas `[ref: PRD/Feature 5 — API Key Management]` `[ref: PRD/Feature 12 — API key management interface]`

- [ ] **T1.3 Plugin Scaffold (KadoPlugin)** `[activity: backend-api]`

  1. Prime: Read current `src/main.ts` and `src/settings.ts` (template code). Read SDD Plugin Entry section `[ref: SDD/Building Block View — Obsidian Plugin Entry]`
  2. Test: KadoPlugin extends Plugin; onload initializes ConfigManager and registers settings tab; onunload cleans up; loadSettings/saveSettings round-trip through ConfigManager
  3. Implement: Rename `MyPlugin` → `KadoPlugin` in `src/main.ts`. Remove template ribbon icon, status bar, commands, modal. Wire ConfigManager with `this.loadData()` / `this.saveData()` callbacks. Rename `SampleSettingTab` → `KadoSettingTab` (placeholder display for now). Update `manifest.json` (id: `kado`, name: `Kado`, author, description). Update `package.json` name.
  4. Validate: All tests pass; lint clean (fixes 6 pre-existing `obsidianmd/sample-names` errors); `npm run build` succeeds; plugin loads in test vault
  5. Success: Plugin loads/unloads cleanly; settings tab appears; no template code remains `[ref: SDD/Implementation Gotchas — lint errors]`

- [ ] **T1.4 Phase Validation** `[activity: validate]`

  - Run all Phase 1 tests. Verify: canonical types compile with no MCP/Obsidian imports; ConfigManager CRUD works; KadoPlugin loads/unloads; lint and typecheck pass.
