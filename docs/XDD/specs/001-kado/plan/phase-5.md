---
title: "Phase 5: Settings UI"
status: completed
version: "1.0"
phase: 5
---

# Phase 5: Settings UI

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Cross-Cutting Concepts — User Interface & UX]` — Settings wireframes
- `[ref: SDD/Building Block View — KadoSettingTab]`
- `[ref: PRD/Features 8-16]` — All configuration UI features

**Key Decisions**:
- Native Obsidian `Setting` components (no Svelte or custom framework)
- Settings tab has sections: Server, Global Areas, API Keys, Audit
- Per-key configuration opens inline (expanding section or sub-view)
- Effective permissions view shows intersection of global + key config

**Dependencies**:
- Phase 1 complete (ConfigManager, KadoSettingTab scaffold)
- Phase 4 complete (server lifecycle — UI controls server start/stop)

---

## Tasks

Implements the Obsidian Settings UI for all configuration needs. The user manages global areas, API keys, per-key scopes, and server settings entirely through this UI.

- [ ] **T5.1 Server Settings Section** `[activity: frontend-ui]`

  1. Prime: Read SDD server settings wireframe and Obsidian Setting API `[ref: SDD/Cross-Cutting — Settings Tab Structure]`
  2. Test: Server enable toggle starts/stops server; host field accepts IP addresses; port field accepts valid port numbers; status indicator shows running/stopped/error; invalid port shows validation error
  3. Implement: In `src/settings.ts` KadoSettingTab.display() — add Server section with: status display (running/stopped + endpoint URL), enable toggle, host text input, port number input. Wire to ConfigManager and KadoMcpServer restart.
  4. Validate: Manual test in Obsidian; unit tests for validation logic; lint clean
  5. Success: User can enable/disable server and configure host:port from settings `[ref: PRD/Feature 9 — Global configuration screen]` `[ref: PRD/Feature 10 — Configurable server exposure]`

- [ ] **T5.2 Global Areas Management** `[activity: frontend-ui]`

  1. Prime: Read SDD global areas wireframe and PRD global area features `[ref: SDD/Cross-Cutting — Settings Tab Structure]` `[ref: PRD/Feature 2 — Global scope configuration]` `[ref: PRD/Feature 11 — Manage global allowed areas]`
  2. Test: "Add Area" creates new area with empty config; area card shows label, path patterns, CRUD toggles per data type; editing area updates config; removing area updates config; CRUD toggles render as checkboxes for C/R/U/D per data type (Note, FM, File, DV)
  3. Implement: In `src/settings.ts` — add Global Areas section with: "Add Area" button, area cards with label, path pattern input, 4x4 CRUD toggle grid (4 data types x 4 operations), edit/delete buttons. Wire mutations through ConfigManager.
  4. Validate: Manual test in Obsidian; lint clean
  5. Success: User can define, edit, and remove global areas with per-data-type CRUD `[ref: PRD/Feature 15 — CRUD permission editing per data type]`

- [ ] **T5.3 API Key Management** `[activity: frontend-ui]`

  1. Prime: Read SDD API key wireframe and PRD key management features `[ref: SDD/Cross-Cutting — Per-Key Configuration]` `[ref: PRD/Feature 5 — API Key Management]` `[ref: PRD/Feature 12 — API key management interface]`
  2. Test: "Generate Key" creates new key with kado_ prefix; key displayed in UI and copyable; key card shows label and status; revoke button disables key; new key defaults to no permissions
  3. Implement: In `src/settings.ts` — add API Keys section with: "Generate Key" button (prompts for label), key cards showing label + truncated key + copy button + status badge, revoke button. Wire through ConfigManager.
  4. Validate: Manual test in Obsidian; lint clean
  5. Success: User can create, view, copy, and revoke API keys `[ref: PRD/Feature 12]`

- [ ] **T5.4 Per-Key Configuration** `[activity: frontend-ui]`

  1. Prime: Read SDD per-key config wireframe and PRD per-key features `[ref: SDD/Cross-Cutting — Per-Key Configuration]` `[ref: PRD/Feature 13 — Per-key configuration screen]` `[ref: PRD/Feature 14 — API-key-level area selection]`
  2. Test: Configure button expands per-key settings; key can select which global areas to use; per-area CRUD toggles constrained to global maximum; effective permissions section shows intersection result; changes persist through ConfigManager
  3. Implement: In `src/settings.ts` — per-key expandable section with: label edit, enable toggle, area assignment checkboxes (only global areas shown), per-area CRUD grid (disabled toggles for operations not allowed globally), effective permissions summary. Wire through ConfigManager.
  4. Validate: Manual test in Obsidian; lint clean
  5. Success: User can configure per-key scopes within global bounds and see effective permissions `[ref: PRD/Feature 14]` `[ref: PRD/Feature 16 — Understandable effective-permissions view]`

- [ ] **T5.5 Audit Settings Section** `[activity: frontend-ui]`

  1. Prime: Read SDD audit config and PRD audit feature `[ref: SDD/Configuration Types — AuditConfig]` `[ref: PRD/Feature 8 — Auditability]`
  2. Test: Audit enable toggle works; log path configurable; max size configurable
  3. Implement: In `src/settings.ts` — add Audit section with: enable toggle, log path text input, max size slider/input
  4. Validate: Manual test in Obsidian; lint clean
  5. Success: User can enable/disable and configure audit logging `[ref: PRD/Feature 8]`

- [ ] **T5.6 Phase Validation** `[activity: validate]`

  - Run all Phase 5 tests. Verify: all settings sections render; config changes persist; server restarts on host/port change; CRUD toggles constrained to global maximums; effective permissions accurate. Lint and typecheck pass.
