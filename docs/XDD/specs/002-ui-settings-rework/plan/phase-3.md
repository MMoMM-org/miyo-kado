---
title: "Phase 3: Settings Tabs"
status: pending
version: "1.0"
phase: 3
---

# Phase 3: Settings Tabs

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Building Block View — Components]` — Tab structure diagram
- `[ref: SDD/Implementation Examples — Tab Bar]` — Scroll overflow pattern
- `[ref: SDD/Runtime View — Settings Tab Navigation]` — Navigation flow
- `[ref: SDD/Runtime View — Create Global Area]` — Area creation sequence
- `[ref: SDD/Runtime View — API Key Lifecycle]` — Key CRUD sequence
- `[ref: SDD/User Interface & UX — Information Architecture]` — Full settings tree

**Key Decisions**:
- ADR-1: SettingsTab owns tab bar + routing. Each tab is a separate renderer.
- UI state: only `activeTab` and `expandedKeyId` held in memory. All config state in ConfigManager.
- Auto-save: every `onChange` calls `plugin.saveSettings()`.

**Dependencies**: Phase 1 (types, config), Phase 2 (all components)

---

## Tasks

Delivers the three main settings tab screens that compose Phase 2 components into complete user interfaces.

- [ ] **T3.1 SettingsTab shell with tab bar** `[activity: frontend-ui]`

  1. Prime: Read SDD tab bar example and CSS `.kado-tab-*` classes `[ref: SDD/Implementation Examples — Tab Bar; SDD/CSS Architecture]`
  2. Test: Tab bar renders "General", "Global Security", + one tab per API key; clicking a tab switches content area; active tab has `.is-active` class; scroll buttons appear when tabs overflow; scroll buttons hidden when all tabs fit; version header shows manifest version + docs link
  3. Implement: Create `src/settings/SettingsTab.ts` — class extends `PluginSettingTab`. Renders version header (from `this.plugin.manifest.version` + link). Builds tab bar with scroll buttons. Routes to `GeneralTab`, `GlobalSecurityTab`, or `ApiKeyTab` based on `activeTab` state. `display()` re-renders entirely (preserves `activeTab`).
  4. Validate: Tab navigation works; scroll overflow works with 5+ tabs; version/docs link visible
  5. Success: Tab-based navigation with scroll overflow `[ref: PRD/AC-1.1, AC-1.2, AC-1.3, AC-1.4, AC-12.1]`

- [ ] **T3.2 GeneralTab** `[activity: frontend-ui]`

  1. Prime: Read SDD Information Architecture (General section) and runtime flows `[ref: SDD/User Interface & UX — Information Architecture; SDD/Runtime View — Settings Tab Navigation]`
  2. Test: **Server section**: status indicator shows "Running on host:port" or "Stopped"; enable toggle starts/stops server; connection type toggle (Local/Public) controls IP dropdown; when Local: IP dropdown disabled, host=127.0.0.1; when Public: IP dropdown enabled with detected interfaces; port input validates 1-65535; all server fields disabled while server is running. **API Keys section**: "Create API Key" button generates key, triggers tab re-render with new tab. **Audit section**: enable toggle; log directory with browse (VaultFolderModal); log filename text input; max size (MB) input; max retained logs input; "View Log" button opens log in Obsidian editor (if exists).
  3. Implement: Create `src/settings/tabs/GeneralTab.ts` — export `renderGeneralTab(containerEl, plugin)`. Uses Obsidian `Setting` for each row. Server fields: read `mcpServer.isRunning()` to set disabled state. Connection type: custom toggle between Local/Public labels. Audit: browse uses VaultFolderModal for directory only; separate text input for filename. View Log: `app.workspace.openLinkText(logPath, '')`.
  4. Validate: Server lock works; audit directory picker works; view log opens file; connection type toggle functions
  5. Success: Complete General tab with server lock, audit config, key creation `[ref: PRD/AC-2.1-2.4, AC-3.1-3.3, AC-4.1-4.6, AC-8.1, AC-11.1-11.2]`

- [ ] **T3.3 GlobalSecurityTab** `[activity: frontend-ui]`

  1. Prime: Read SDD area creation sequence and Information Architecture (Global Security section) `[ref: SDD/Runtime View — Create Global Area; SDD/User Interface & UX]`
  2. Test: "Add Area" button creates new area (default-deny, whitelist, empty paths/tags); area card shows: label input, list mode toggle with description text, paths section with add/remove, tags section with add/remove; list mode toggle updates description ("Only listed items..." vs "Everything except..."); blacklist mode with zero rules shows warning "Blacklist with no rules grants full access"; path entries compose PathEntry component (browse + matrix); tag entries compose TagEntry component (picker + read badge); remove area shows confirmation, cascades to key assignments; each change auto-saves
  3. Implement: Create `src/settings/tabs/GlobalSecurityTab.ts` — export `renderGlobalSecurityTab(containerEl, plugin)`. Iterates `config.globalAreas`. Each area rendered as a collapsible card. List mode toggle at top of each area. Paths section uses `renderPathEntry()` for each path rule. Tags section uses `renderTagEntry()` for each tag. Add/remove buttons manage arrays. Remove area calls `configManager.removeGlobalArea()`.
  4. Validate: Full area lifecycle works; list mode toggle updates description; components compose correctly
  5. Success: Complete Global Security tab with areas, paths, tags, list mode `[ref: PRD/AC-5.1-5.5, AC-6.1-6.4, AC-7.1-7.7]`

- [ ] **T3.4 ApiKeyTab** `[activity: frontend-ui]`

  1. Prime: Read SDD key lifecycle sequence and Information Architecture (API Key section) `[ref: SDD/Runtime View — API Key Lifecycle; SDD/User Interface & UX]`
  2. Test: **Key management**: name input + rename button updates label and tab; full key displayed (no masking) + copy button with "Copied!" feedback; regenerate button with confirmation dialog → new secret, same ID/assignments. **Area assignments**: each global area shown as toggle; when assigned: constrained permission matrix (dots disabled where global doesn't allow); inherited list mode shown as read-only label (not toggle); in whitelist mode enabled dots = "allowed", in blacklist mode enabled dots = "blocked"; unassigned areas show as available toggles. **Tags**: only tags from assigned global areas shown; tag entries with read-only badge. **Effective permissions**: read-only summary of intersection with each area's mode labeled. **Delete**: danger button at bottom; confirmation dialog with default=Cancel; on confirm: key removed, redirect to General tab. **Blacklist warning**: if inherited area is blacklist with zero rules, show warning.
  3. Implement: Create `src/settings/tabs/ApiKeyTab.ts` — export `renderApiKeyTab(containerEl, plugin, keyId)`. Key management section uses `Setting` for name/key/buttons. Copy: `navigator.clipboard.writeText()` with error handling. Regenerate: new `kado_${UUID}` replacing old `key.id`. Confirmation dialogs: Obsidian `Modal` subclass with Yes/No buttons. Area assignments: iterate `config.globalAreas`, toggle adds/removes `KeyAreaConfig`. Matrix constrained by `area.permissions` via `maxPermissions` prop. Delete: calls `configManager.revokeKey()` or removes from array, triggers `display()` with `activeTab='general'`.
  4. Validate: Full key lifecycle works; copy clipboard works; regenerate replaces secret; delete with confirm; area assignment constrains matrix; effective permissions display
  5. Success: Complete API Key tab with full lifecycle and constrained permissions `[ref: PRD/AC-8.1-8.6, AC-9.1-9.5, AC-10.1-10.2]`

- [ ] **T3.5 Phase Validation** `[activity: validate]`

  Run all Phase 3 tests. Full manual walkthrough in Obsidian dev vault: create area → add paths/tags → create key → assign to area → configure permissions → copy key → rename → regenerate → delete. Verify all PRD acceptance criteria for Features 1-12. `npm run build` and `npm run lint` pass.
