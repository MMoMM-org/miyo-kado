---
title: "UI Settings Rework"
status: draft
version: "1.1"
---

# Product Requirements Document

## Validation Checklist

### CRITICAL GATES (Must Pass)

- [x] All required sections are complete
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Problem statement is specific and measurable
- [x] Every feature has testable acceptance criteria (Gherkin format)
- [x] No contradictions between sections

### QUALITY CHECKS (Should Pass)

- [x] Problem is validated by evidence (not assumptions)
- [x] Context → Problem → Solution flow makes sense
- [x] Every persona has at least one user journey
- [x] All MoSCoW categories addressed (Must/Should/Could/Won't)
- [x] Every metric has corresponding tracking events
- [x] No feature redundancy (check for duplicates)
- [x] No technical implementation details included
- [x] A new team member could understand this PRD

---

## Product Overview

### Vision

Kado's settings tab becomes a self-explanatory, security-first configuration interface where users can set up MCP server access, define permission scopes, manage API keys, and control audit logging — all without needing to understand the underlying config file format.

### Problem Statement

The current Kado settings tab has significant usability gaps:

1. **Path configuration is error-prone** — users type comma-separated glob patterns into a plain text field with no validation or autocomplete. Typos silently break permissions.
2. **Tag-based filtering doesn't exist** — users cannot scope access by Obsidian tags, forcing them to rely solely on path patterns for access control.
3. **Server config is unsafe while running** — host and port fields remain editable while the MCP server is active, inviting misconfigurations that silently restart the server.
4. **Audit log is hidden** — the log lives inside `.obsidian/`, invisible to normal users and excluded from vault sync. Users cannot verify what happened.
5. **API key management lacks safety** — no confirmation on delete, no ability to regenerate a key, and the key display is basic.
6. **No whitelist/blacklist toggle** — users cannot switch a scope's interpretation between "only these are allowed" and "everything except these is blocked".
7. **Permission UI is flat** — 16 toggles in a row are hard to scan. A visual matrix (resources × CRUD) would be more intuitive.

These issues reduce trust in the security model and increase the chance of misconfiguration.

### Value Proposition

Kado's reworked settings tab replaces error-prone text inputs with guided interactions (directory pickers, tag pickers, visual permission matrices) while keeping the security model transparent. Users see exactly what is allowed, for whom, and can change it safely — without ever touching a config file.

## User Personas

### Primary Persona: Vault Admin

- **Demographics:** Technical user (developer, sysadmin, power user), 25–55, uses Obsidian daily for knowledge management or project documentation.
- **Goals:** Configure MCP access for AI agents so they can read/write specific vault areas without over-permissioning. Wants to set it up once, trust it, and move on.
- **Pain Points:** Current text-based path input is fragile. Cannot verify effective permissions at a glance. Worried about accidentally granting too broad access.

### Secondary Personas

#### AI Agent Operator

- **Demographics:** Developer or team lead who connects external AI tools (Claude, custom agents) to Obsidian via MCP.
- **Goals:** Create per-agent API keys with scoped permissions. Quickly rotate keys when needed.
- **Pain Points:** No way to regenerate a compromised key. Deleting a key has no safety net. Cannot filter access by tags.

## User Journey Maps

### Primary User Journey: First-Time Setup

1. **Awareness:** User installs Kado plugin and opens settings for the first time.
2. **Consideration:** Sees the General tab — server is off, no areas or keys configured. Info message explains default-deny.
3. **Adoption:** Creates a global area via the Global Security tab, uses directory picker for paths, adds tags via tag picker, configures the CRUD matrix. Switches to General tab, creates an API key, opens the key's tab, assigns it to the area.
4. **Usage:** Enables the server, copies the API key, configures the external AI tool. Checks audit log to verify operations.
5. **Retention:** Comes back to adjust permissions, add new areas, rotate keys — each operation is fast and safe.

### Secondary User Journeys

#### Key Rotation

1. User suspects a key is compromised or wants to rotate proactively.
2. Opens the API Key tab, clicks "Regenerate Key".
3. Confirms the action (old key immediately invalidated).
4. Copies the new key value and updates the external client.

#### Permission Audit

1. User wants to verify what an API key can actually do.
2. Expands the key's configuration panel.
3. Sees which global areas the key is assigned to, with effective permissions shown as a read-only matrix.
4. Checks the audit log (vault-relative path) for recent activity.

## Feature Requirements

### Must Have Features

#### Feature 1: Tab-Based Navigation

- **User Story:** As a vault admin, I want settings organized into clear tabs so that I can find and configure each aspect without scrolling through a single long page.
- **Acceptance Criteria:**
  - [x] Given the user opens the settings tab, When the tab loads, Then they see a horizontal tab bar with: "General", "Global Security", and one tab per existing API key
  - [x] Given the user clicks a tab, When the tab activates, Then only that tab's content is shown and the active tab is visually highlighted
  - [x] Given the user creates a new API key, When the key is created, Then a new tab appears for that key
  - [x] Given the tab bar has more tabs than fit in one row, When the user views the tab bar, Then scroll buttons (left/right arrows) appear to navigate overflow tabs

#### Feature 2: Server Configuration with Running-State Lock

- **User Story:** As a vault admin, I want the server host and port to be locked while the server is running so that I don't accidentally cause a misconfiguration or unexpected restart.
- **Acceptance Criteria:**
  - [x] Given the MCP server is stopped, When the user views the General tab, Then host and port fields are editable
  - [x] Given the MCP server is running, When the user views the General tab, Then host and port fields are disabled/read-only with a visual indicator (e.g., muted styling)
  - [x] Given the MCP server is running, When the user toggles the server off, Then the host and port fields become editable again
  - [x] Given the MCP server is running, When the user views the server status, Then the current host:port is displayed

#### Feature 3: Connection Type Toggle (Local / Public)

- **User Story:** As a vault admin, I want to choose between local-only and public network binding so that I control who can reach the MCP server.
- **Acceptance Criteria:**
  - [x] Given the user selects "Local", When the setting is applied, Then the server binds to 127.0.0.1 and the IP dropdown is disabled
  - [x] Given the user selects "Public", When the setting is applied, Then an IP dropdown becomes enabled listing available network interfaces (127.0.0.1, 0.0.0.0, detected local IPs)
  - [x] Given the server is running, When the user views connection type, Then the toggle and IP dropdown are disabled

#### Feature 4: Vault-Relative Audit Log with Directory Picker

- **User Story:** As a vault admin, I want the audit log stored inside my vault (not hidden in .obsidian) so that I can see it, sync it, and review it alongside my notes.
- **Acceptance Criteria:**
  - [x] Given the user enables audit logging, When they configure the log path, Then a directory picker allows selecting any vault folder for the log directory
  - [x] Given the user picks a directory, When the path is set, Then a separate text input allows editing the log file name (default: `kado-audit.log`)
  - [x] Given the audit log path is vault-relative, When the vault is synced, Then the audit log is included in sync
  - [x] Given the user enters a path with `..` or absolute path, When the input is validated, Then the path is rejected with an error message
  - [x] Given audit is enabled, When max size is reached, Then log rotation occurs (current → `.1` → `.2` etc.)
  - [x] Given log rotation is configured, When the user views audit settings, Then a "Max retained logs" field controls how many rotated files are kept (default: 3)

#### Feature 5: Global Areas with Directory Picker and Permission Matrix

- **User Story:** As a vault admin, I want to define access areas using a directory picker and a visual permission matrix so that I can see at a glance what is allowed where.
- **Acceptance Criteria:**
  - [x] Given the user adds a new global area, When the area is created, Then it has an empty label, no paths, no tags, and all permissions default to false (default-deny)
  - [x] Given the user clicks "Browse" on a path entry, When the directory picker modal opens, Then it shows all vault folders (filterable by search) and selecting one inserts the vault-relative path
  - [x] Given a path is configured, When the user views the permission matrix, Then a 4x4 grid shows resources (Notes, Frontmatter, Dataview, Files) x CRUD (Create, Read, Update, Delete)
  - [x] Given the user clicks a matrix dot, When toggled, Then the permission flips and the dot shows a visual on/off state
  - [x] Given the user removes an area, When confirmed, Then the area and all key assignments to it are removed

#### Feature 6: Whitelist / Blacklist Toggle Per Scope

- **User Story:** As a vault admin, I want to choose whether a scope operates in whitelist mode ("only these paths/tags are allowed") or blacklist mode ("everything except these is blocked") so that I can model both restrictive and permissive access patterns.
- **Acceptance Criteria:**
  - [x] Given a new global area is created, When the user views its settings, Then the list mode defaults to "Whitelist"
  - [x] Given the user toggles to "Blacklist", When the mode changes, Then the interpretation of ALL rules (both paths and tags) in that scope reverses — the toggle applies to the entire scope, not individually per paths or tags
  - [x] Given the user switches from whitelist to blacklist with existing rules, When the mode changes, Then an inline description updates to explain the current mode ("Only listed items are accessible" vs "Everything except listed items is accessible")
  - [x] Given a scope is in blacklist mode with zero path/tag rules, When the user views the scope, Then a warning is displayed: "Blacklist with no rules grants full access"
  - [x] Given a key is assigned to an area, When the user views the key's area config, Then the key shows the area's inherited list mode as a read-only label (not a toggle) and the key's permissions are editable but constrained by the global area's maximum

#### Feature 7: Tag Filtering (Read-Only)

- **User Story:** As a vault admin, I want to filter accessible files by Obsidian tags so that I can scope AI access to semantically meaningful content groups without relying solely on folder structure.
- **Acceptance Criteria:**
  - [x] Given the user adds a tag rule, When they enter a tag, Then tags with or without leading `#` are accepted and normalized (stored consistently without `#`)
  - [x] Given the user enters a nested tag like `#this/is/a/tag`, When the tag is saved, Then nested tags are supported and matched correctly
  - [x] Given a tag rule exists, When the permission is displayed, Then only "Read" is shown as a fixed/enabled column (CUD are not applicable for tags)
  - [x] Given the user wants wildcard matching, When they enter `#project/*`, Then all child tags under `#project/` are matched. Wildcard `*` is only valid at the end of a tag.
  - [x] Given the UI shows a tag input, When the field is empty, Then a placeholder indicates format: `#tag`, `#nested/tag`, `tag`, `tag/*`
  - [x] Given the user clicks "Add Tag", When the tag picker opens, Then it shows existing vault tags (from metadata cache, both frontmatter and inline) for selection. The user can also type a tag manually.
  - [x] Given the user views a key's tag section, When the key is assigned to global areas, Then only tags defined in those global areas are shown (key cannot add tags outside global scope)

**Business Rule — Tag × Path Intersection:** When an API key queries by tag, the result set is the intersection of (files matching the tag) AND (files within the key's allowed paths). Tags narrow the result set — they never expand access beyond allowed paths. This is a backend enforcement rule, documented here for completeness.

**Business Rule — Tag Sources:** Obsidian stores tags in two places: frontmatter (without `#`) and inline (with `#`). The tag picker and tag matching must use the complete merged tag set from Obsidian's metadata cache. The test vault contains both inline and frontmatter tags for validation.

#### Feature 8: API Key Management (Create, Copy, Rename, Delete, Regenerate)

- **User Story:** As a vault admin, I want full lifecycle management of API keys so that I can create, rotate, and revoke access for individual agents.
- **Acceptance Criteria:**
  - [x] Given the user clicks "Create API Key", When a key is generated, Then a new tab appears for the key with a unique ID and default name
  - [x] Given the user views an API key tab, When they see the key value, Then the full key is displayed (no masking) with a "Copy" button that copies to clipboard with "Copied!" feedback (1.5s)
  - [x] Given the user edits the key name, When they click "Rename", Then the tab label and page title update immediately
  - [x] Given the user clicks "Delete Key", When the confirmation dialog appears, Then it asks "Delete API key '[key-name]'? This cannot be undone." with default selection on "No" / "Cancel"
  - [x] Given the user confirms deletion, When the key is removed, Then the tab disappears and the user is redirected to the General tab
  - [x] Given the user clicks "Regenerate Key", When a confirmation dialog appears and the user confirms, Then the old key value is replaced with a new one (same key ID, new secret), and the new key is displayed in full for copying

#### Feature 9: Per-Key Area Assignment with Constrained Permissions

- **User Story:** As a vault admin, I want to assign API keys to specific global areas and optionally narrow their permissions so that each agent gets exactly the access it needs — no more.
- **Acceptance Criteria:**
  - [x] Given a key's configuration panel is expanded, When the user views available areas, Then each global area appears as a toggleable assignment
  - [x] Given a key is assigned to an area, When the user views the key's permissions for that area, Then the CRUD matrix is shown but constrained to the global area's maximum permissions (cannot grant more than global allows)
  - [x] Given a global area removes a permission, When the key's view is refreshed, Then any key permission exceeding the new global maximum is automatically revoked
  - [x] Given a key is not assigned to any area, When the key is used for an MCP request, Then all access is denied (default-deny)
  - [x] Given the global area is in whitelist mode, When the key's permissions are shown, Then enabled dots represent "allowed" operations. Given the area is in blacklist mode, Then enabled dots represent "blocked" operations. The dot semantics follow the area's list mode — no separate toggle needed.

### Should Have Features

#### Feature 10: Effective Permissions Summary

- **User Story:** As a vault admin, I want to see the effective (resolved) permissions for an API key so that I can verify the actual access without mentally combining global and key-level rules.
- **Acceptance Criteria:**
  - [x] Given a key is assigned to one or more areas, When the user views effective permissions, Then a read-only summary shows the intersection of global area permissions and key-level permissions
  - [x] Given a key has areas in both whitelist and blacklist mode, When effective permissions are shown, Then each area's mode is clearly labeled

#### Feature 11: Server Status Indicator

- **User Story:** As a vault admin, I want to see at a glance whether the MCP server is running and on which address so that I don't have to toggle settings to check.
- **Acceptance Criteria:**
  - [x] Given the server is running, When the user views the General tab, Then a status line shows "Running on {host}:{port}" with a green/accent indicator
  - [x] Given the server is stopped, When the user views the General tab, Then a status line shows "Stopped" with a muted indicator

#### Feature 12: Plugin Version & Documentation Link

- **User Story:** As a vault admin, I want to see which plugin version I'm running and quickly access documentation.
- **Acceptance Criteria:**
  - [x] Given the user opens the plugin settings, When the settings tab loads, Then the plugin version (from manifest) and a clickable link to the documentation are displayed at the top
  - Reference: [obsidian-dynbedded SettingTab.ts L33-43](https://github.com/MMoMM-org/obsidian-dynbedded/blob/main/src/DynbeddedSettingTab.ts)

### Could Have Features

#### Feature 13: Log Viewer Button

- **User Story:** As a vault admin, I want a quick button to open the audit log directly from settings so I don't have to navigate to it manually.
- **Acceptance Criteria:**
  - [x] Given audit logging is enabled and a log file exists, When the user clicks "View Log", Then the audit log file opens in Obsidian's editor

### Won't Have (This Phase)

- **New Keys session tab** — Per-key tabs are sufficient. Keys are always shown in full (no masking), so no need for a separate session view.
- **Per-key list mode override** — Keys inherit the area's whitelist/blacklist mode. Independent per-key mode toggle is deferred.
- **Custom IP entry** — IP selection is from a predefined dropdown (localhost, 0.0.0.0, detected interfaces). Free-text IP entry is deferred.
- **Tag CUD permissions** — Tags are read-only filters. Create/Update/Delete operations on tagged files via tags alone are out of scope.
- **Multi-vault support** — Settings are per-vault only.
- **Import/export settings** — No settings backup/restore mechanism in this phase.
- **Real-time permission testing** — No "test this key against this path" dry-run tool.
- **Key masking/obfuscation** — Keys are always displayed in full. No masking.

## Detailed Feature Specifications

### Feature: Security Scope Configuration (Feature 5 + 6 + 7)

**Description:** The core security configuration surface. Each scope (Global Security tab or API Key tab) contains three sections in this order: (1) list mode toggle, (2) paths section with permission matrix, (3) tags section with read-only permission. This structure is identical on both the Global Security tab and each API Key tab.

**User Flow:**

1. User navigates to the "Global Security" tab.
2. List mode toggle is at the top — defaults to "Whitelist" with explanatory text.
3. Below: **Paths** section with an "Add Path" (+) button.
4. User clicks (+) → new row: [-remove] [path input] [browse button] [4x4 permission matrix].
5. User clicks "Browse" → modal picker shows vault folders → selects one → path inserted.
6. User clicks dots in the matrix to enable resource x CRUD permissions.
7. Below paths: **Tags** section with an "Add Tag" (+) button.
8. User clicks (+) → new row: [-remove] [tag input/picker] [Read: fixed on].
9. User picks a tag from the tag picker or types one manually.
10. Changes auto-save on each interaction.

**Business Rules:**

- Rule 1: Default-deny — a new scope grants zero permissions until explicitly configured.
- Rule 2: Whitelist mode (default) — only listed paths/tags are accessible. Blacklist mode — everything except listed paths/tags is accessible. The toggle applies to the ENTIRE scope (both paths and tags together). A blacklist scope with zero rules intentionally grants full access — a UI warning must be shown in this case.
- Rule 2a: Auto-save — every setting change is persisted immediately. No explicit "Save" button. Changes take effect as soon as the user modifies a field.
- Rule 3: Tags are read-only filters — they narrow which files are returned from allowed paths. They do not grant write/create/delete capabilities. The intersection rule applies: tag results are always filtered against allowed paths.
- Rule 4: Tag normalization — `#tag`, `tag`, `#nested/tag`, `nested/tag` are all valid inputs. Stored without `#`. Display includes `#` prefix.
- Rule 5: Wildcard tags — `tag/*` matches all child tags (e.g., `project/*` matches `project/a`, `project/b/c`). Wildcard `*` is only valid at the end.
- Rule 6: Path entries use vault-relative paths. No absolute paths, no `..` traversal.
- Rule 7: Removing a global area cascades — all API key assignments referencing that area are also removed.
- Rule 8: Tag sources — the tag picker and matching use both frontmatter tags (stored without `#`) and inline tags (stored with `#`), merged into one complete set via Obsidian's metadata cache.

**Edge Cases:**

- Scenario 1: User creates an area but adds no paths or tags → Expected: Area exists but grants no access (default-deny is preserved).
- Scenario 2: User adds a path that doesn't exist in the vault → Expected: Path is accepted (folder may be created later), but currently resolves to no files.
- Scenario 3: User switches list mode from whitelist to blacklist with existing rules → Expected: Rules stay, interpretation flips. Inline description text updates to explain the new semantics.
- Scenario 4: User enters a tag with `#` prefix → Expected: Stored without `#`, displayed with `#` in UI.
- Scenario 5: User enters `#project/*` → Expected: Matches `project/a`, `project/b`, `project/b/c` etc. Does NOT match `project` itself (exact match needs separate entry).
- Scenario 6: User deletes the last path in an area → Expected: Area still exists with zero paths. Effectively grants no path-based access.

### Feature: API Key Lifecycle (Feature 8)

**Description:** Full CRUD + regenerate for API keys with safety confirmations.

**User Flow:**

1. User clicks "Create API Key" on General tab → new key generated, new tab appears.
2. User renames the key → tab label updates.
3. User copies the key (always shown in full) → clipboard + feedback.
4. User assigns key to global areas → permissions configured.
5. Later, user clicks "Regenerate" → confirmation dialog → new secret generated, old one invalidated.
6. User copies new key, updates external client.
7. When key is no longer needed: user clicks "Delete" → confirmation dialog (default = No) → key removed, tab closed.

**Business Rules:**

- Rule 1: Key deletion confirmation must default to "No" / "Cancel" to prevent accidental deletion.
- Rule 2: Key regeneration replaces the secret value but keeps the key ID, name, and all permission assignments intact.
- Rule 3: Keys are always displayed in full — no obfuscation or masking.
- Rule 4: A key with no area assignments has zero access (default-deny).

**Edge Cases:**

- Scenario 1: User deletes the only API key → Expected: Allowed. No keys means no MCP access. User can create new keys later.
- Scenario 2: User regenerates a key while the MCP server is running → Expected: Old key is immediately invalidated. Active sessions using the old key receive auth errors on next request.
- Scenario 3: User tries to rename a key to an already-used name → Expected: Allowed (names are labels, not unique identifiers).

## Success Metrics

### Key Performance Indicators

- **Adoption:** 90% of users who install Kado successfully configure at least one global area and one API key through the settings UI (vs. editing config files manually).
- **Engagement:** Average time to complete first-time setup drops below 3 minutes (currently estimated at 5–10 minutes with text-based config).
- **Quality:** Zero misconfiguration-related security incidents reported in the first 3 months after release (e.g., accidental over-permissioning due to typo in path).
- **Business Impact:** Reduction in GitHub issues related to "how do I configure permissions" by 50%.

### Tracking Requirements

| Event | Properties | Purpose |
|-------|------------|---------|
| `settings.area.created` | area_id, paths_count, tags_count | Track area creation patterns |
| `settings.area.listmode.changed` | area_id, old_mode, new_mode | Track whitelist vs blacklist adoption |
| `settings.key.created` | key_id | Track key creation volume |
| `settings.key.regenerated` | key_id | Track key rotation frequency |
| `settings.key.deleted` | key_id | Track key lifecycle |
| `settings.audit.enabled` | log_path | Track audit adoption |
| `settings.server.started` | host, port, connection_type | Track server configuration patterns |
| `settings.directory_picker.used` | context (path, audit, tag) | Track picker vs manual entry ratio |

Note: All tracking respects user privacy. Events are local only (audit log), not sent externally.

---

## Constraints and Assumptions

### Constraints

- **Obsidian Plugin API**: Must use Obsidian's `PluginSettingTab`, `Setting`, `Modal` classes. Custom components must integrate with Obsidian's DOM lifecycle.
- **No external dependencies for UI**: All UI components are vanilla DOM + Obsidian API. No React, Vue, or similar frameworks.
- **Settings storage**: Single JSON blob via Obsidian's `plugin.loadData()` / `plugin.saveData()`. No separate config files.
- **Default-deny security model**: The architecture (L1 constitutional rule) requires that nothing is accessible until explicitly granted. The UI must reinforce this.
- **Theming**: Inherit Obsidian's native theme entirely. No custom color palette. Use Obsidian's CSS variables (`--background-primary`, `--text-normal`, `--interactive-accent`, etc.). Only add `.kado-`-prefixed classes for layout/structure, not colors.
- **No backward compatibility needed**: Only test instance exists. Config can be manually reset or adjusted during development.

### Assumptions

- Users have a basic understanding of file permissions (read/write/create/delete concepts).
- Obsidian's `TFolder` API provides access to all vault folders for the directory picker.
- Tag resolution depends on Obsidian's metadata cache being available and up-to-date. Both frontmatter and inline tags must be included.
- Network interface detection (for the IP dropdown in Public mode) is available at runtime.

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Directory picker misses folders in large vaults | Medium | Low | Use Obsidian's built-in file API (already handles large vaults). Add search filter in modal. |
| Tag normalization inconsistencies between frontmatter and inline tags | Medium | Medium | Define single canonical form (without `#`). Normalize on input. Use merged tag set from metadata cache. Test with both inline and frontmatter tags in test vault. |
| Users confused by whitelist vs blacklist semantics | Medium | Medium | Add inline description text that updates when mode toggles. E.g., "Only listed paths are accessible" vs "All paths except listed ones are accessible". |
| Custom CSS conflicts with Obsidian themes | Low | Low | Inherit Obsidian theme variables. Only use `.kado-` classes for structure/layout, not colors. Test with default dark/light themes. |
| Key regeneration while server is active causes auth disruption | Low | High | Immediately invalidate old key in config. Document that active sessions will fail and need reconnection. |

## Open Questions

All open questions have been resolved:

- [x] ~~Audit log location~~ → Vault-relative path with directory picker + editable filename
- [x] ~~Permission model~~ → Keep two-layer (global → key), add whitelist/blacklist toggle per scope
- [x] ~~Tag permissions scope~~ → Read-only filter only, intersection with allowed paths
- [x] ~~Delete confirmation~~ → Confirm dialog, default = No
- [x] ~~Key regeneration~~ → Regenerate button with confirmation
- [x] ~~New Keys session tab~~ → Won't have. Per-key tabs sufficient, no masking.
- [x] ~~Tag wildcard scope~~ → Wildcard `*` only valid at the end
- [x] ~~Log rotation vs FIFO~~ → Log rotation with configurable retention count (default: 3)
- [x] ~~Directory picker implementation~~ → Modal picker (Obsidian Modal subclass with filtered folder list)
- [x] ~~Theming approach~~ → Inherit Obsidian native theme, no custom color palette
- [x] ~~Tag sources~~ → Merged set from both frontmatter and inline tags via metadata cache
- [x] ~~Key display~~ → Always shown in full, no masking

---

## Supporting Research

### Competitive Analysis

- **Obsidian plugins with settings tabs** (e.g., Dataview, Templater): Use Obsidian's native `Setting` component. Tab-based navigation is common for complex plugins. Permission matrices are not standard — Kado's CRUD grid is novel for the Obsidian ecosystem.
- **MCP server implementations**: Most MCP servers use config files, not UIs. Kado's GUI-based permission management is a differentiator.
- **Security-focused tools** (1Password, Vault): Use whitelist/blacklist toggles, confirmation dialogs for destructive actions, and visual permission grids. Kado follows these patterns.

### User Research

Based on the existing GitHub issues pattern and the current settings implementation:
- Users struggle with comma-separated glob pattern input (typos, no feedback).
- Users ask how to verify effective permissions (no summary view exists).
- Users request tag-based scoping (not currently available).
- The `.obsidian/` audit log location is a known friction point.

### Market Data

Obsidian has 5M+ users. MCP adoption is growing rapidly in the AI tools ecosystem. Kado is positioned as the security gateway between AI agents and Obsidian vaults — a unique niche with no direct competitor.
