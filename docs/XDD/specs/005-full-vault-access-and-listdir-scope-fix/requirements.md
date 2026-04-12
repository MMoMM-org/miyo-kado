---
title: "Full Vault Access & listDir Scope Fix"
status: draft
version: "1.0"
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
- [ ] Every metric has corresponding tracking events
- [x] No feature redundancy (check for duplicates)
- [x] No technical implementation details included
- [x] A new team member could understand this PRD

---

## Product Overview

### Vision

Vault administrators can grant "full vault" access with a single, discoverable path entry — and the permission system accurately filters all search results to match configured scope.

### Problem Statement

Users cannot configure "full vault" access through any supported path. The `/` value was historically allowed but silently matches nothing in the permission system — it expands to `//**` which never matches Obsidian's relative paths. The settings UI now rejects `/` on input, and the folder picker excludes the vault root. Additionally, `listDir` returns files at the walk root regardless of scope patterns, leaking items that should be hidden in whitelist mode. MCP clients see items they shouldn't, and cannot read them — creating confusion and eroding trust in the permission model.

### Value Proposition

A working, documented "full vault" path (`**`) removes guesswork for vault administrators. Fixing `listDir` file filtering closes the last scope leak, making the permission system consistent: if you can see it, you can read it; if you can't read it, you don't see it.

## User Personas

### Primary Persona: Vault Administrator

- **Demographics:** Technical user configuring Kado for their Obsidian vault. Sets up global security scope and API keys for MCP consumers (e.g., Claude Code, other LLM agents).
- **Goals:** Grant appropriate access to vault content per consumer. Understand exactly what each API key can see and do. Configure quickly without reading source code.
- **Pain Points:** No obvious way to allow full vault access. `/` looks correct but silently fails. No feedback when a path pattern matches nothing. Must hand-edit JSON to work around UI limitations.

### Secondary Persona: MCP Consumer (LLM Agent)

- **Demographics:** Automated client connecting to Kado via MCP protocol. Uses `listDir` to discover vault structure, then reads/searches content.
- **Goals:** Discover available content accurately. Only see items it has permission to access. Build a reliable mental model of vault structure from `listDir` results.
- **Pain Points:** Sees files in `listDir` that it cannot actually read (scope leak). Wastes tokens attempting to access items that will be denied. Cannot distinguish "I can see this" from "I can access this."

## User Journey Maps

### Primary User Journey: Granting Full Vault Access

1. **Awareness:** Administrator installs Kado and opens settings. Wants to give an API key access to the entire vault.
2. **Consideration:** Looks at path entry. Sees the folder picker only shows subdirectories, not the vault root. Tries typing `/` — gets a validation error.
3. **Adoption:** Finds `** (Full vault)` at the top of the folder picker, selects it. Sees it populate the path field. Sets permissions.
4. **Usage:** MCP consumer connects, calls `listDir` with `path: "/"`, sees all vault content. Reads and searches as expected.
5. **Retention:** Configuration is intuitive. The permission system behaves predictably. No surprises.

### Secondary User Journey: Migrating from Legacy `/` Config

1. **Awareness:** Administrator upgrades Kado. Had `/` in their config from an older version.
2. **Usage:** On load, Kado silently migrates `/` to `**` in both global and API key paths.
3. **Retention:** Everything works as originally intended. No manual intervention needed.

## Feature Requirements

### Must Have Features

#### Feature 1: `**` as Full Vault Path

- **User Story:** As a vault administrator, I want to select "Full vault" in the path picker so that I can grant access to all vault content without guessing the correct pattern.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given the administrator opens the folder picker in Global Security, When the picker appears, Then `** (Full vault)` is the first entry above all vault folders
  - [ ] Given the administrator selects `** (Full vault)`, When the selection is applied, Then the path field shows `**` and the config stores `**`
  - [ ] Given a whitelist scope contains path `**`, When a file at any depth is checked against scope, Then it matches and the configured permissions apply
  - [ ] Given a whitelist scope contains path `**`, When `listDir` is called at root, Then all non-hidden files and folders are returned
  - [ ] Given the path input field contains `**`, When the field validates, Then no error or warning is shown (the "matches entire vault" warning is suppressed for `**`)

#### Feature 2: listDir File Scope Filtering

- **User Story:** As an MCP consumer, I want `listDir` to only return files I have permission to access so that I can trust the listing results.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a whitelist scope with paths `["Atlas"]`, When `listDir` is called at vault root, Then only files matching scope patterns are returned alongside in-scope folders
  - [ ] Given root-level files exist outside any whitelisted path, When `listDir` is called at root, Then those files are not included in results
  - [ ] Given a whitelist scope with `**`, When `listDir` is called at root, Then all non-hidden files and folders are returned (no false filtering)
  - [ ] Given a blacklist scope with path `["Secret"]`, When `listDir` is called at root, Then files inside `Secret/` are excluded but all other files are returned

#### Feature 3: Legacy `/` Migration

- **User Story:** As a vault administrator who configured `/` in an earlier Kado version, I want my config to keep working after upgrading so that I don't need to reconfigure manually.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a config with path `/` in global security paths, When Kado loads the config, Then `/` is silently replaced with `**` in memory
  - [ ] Given a config with path `/` in an API key's paths, When Kado loads the config, Then `/` is silently replaced with `**` in that key's paths
  - [ ] Given the migration runs, When the config is next saved, Then the persisted config contains `**` instead of `/`

#### Feature 4: Documentation Update

- **User Story:** As a vault administrator or contributor, I want documentation to accurately describe how to configure full vault access and how scope filtering works so that I can set up Kado correctly.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given the README, When a user reads the security section, Then `**` is documented as the full vault access pattern
  - [ ] Given the configuration guide, When a user reads the path patterns section, Then bare names, globs, and `**` are explained with examples
  - [ ] Given the API reference, When a reader looks at `listDir`, Then it documents that results are scope-filtered for both files and folders
  - [ ] Given the API reference, When a reader looks at the path parameter, Then `/` is documented as the listDir vault-root marker (distinct from `**` scope pattern)

### Should Have Features

#### Feature 5: PathEntry validation improvement

- **User Story:** As a vault administrator, I want clear feedback when a path pattern is invalid or matches nothing so that I don't accidentally create broken configs.
- **Acceptance Criteria:**
  - [ ] Given the path input rejects `/`, When the administrator types `/`, Then the error message suggests using `**` for full vault access or the folder picker

### Could Have Features

- Audit log entry when migration rewrites `/` → `**` (helps debugging)

### Won't Have (This Phase)

- Root-level-only access (`*` pattern) — deferred, no use case yet
- Manual glob entry in API key paths — API keys continue to pick from global paths only
- API key subfolder narrowing (e.g., global allows `Atlas`, key restricts to `Atlas/202 Notes`) — tracked as a future enhancement

## Detailed Feature Specifications

### Feature: listDir File Scope Filtering

**Description:** Currently, the `listDir` walk function only scope-checks folders (skipping out-of-scope directories). Files at the walk root level are added unconditionally. This means root-level files that don't match any whitelisted path appear in results even though the permission gates would deny actual reads.

**User Flow:**
1. MCP consumer calls `listDir` with `path: "/"`
2. Kado resolves `/` to vault root, walks children
3. For each folder: check against scope patterns, skip if out-of-scope
4. For each file: **check against scope patterns, skip if out-of-scope** (new behavior)
5. Return sorted, filtered results

**Business Rules:**
- Rule 1: A file appears in `listDir` results only if it matches at least one scope pattern
- Rule 2: Folder visibility rules remain unchanged (folder appears if it could contain in-scope items)
- Rule 3: `childCount` for folders should only count scope-matching children (files + folders)
- Rule 4: When scope is `undefined` (no filtering), all files and folders appear (backward compatible)

**Edge Cases:**
- Files at vault root with no matching scope pattern → Expected: excluded from results
- `**` scope with root-level files → Expected: all files included
- Empty scope patterns array `[]` → Expected: no files returned
- Files with names starting with `.` → Expected: already excluded by existing hidden-file check

## Success Metrics

### Key Performance Indicators

- **Correctness:** Zero files appear in `listDir` that the permission gates would deny on read
- **Migration:** 100% of legacy `/` configs are silently upgraded on first load
- **Discoverability:** `**` is selectable in the folder picker without typing

### Tracking Requirements

| Event | Properties | Purpose |
|-------|------------|---------|
| config_migration | from_pattern, to_pattern, scope (global/key) | Track how many installs need migration |
| path_pattern_selected | pattern, source (picker/manual) | Understand how administrators configure paths |

---

## Constraints and Assumptions

### Constraints

- Must be backward compatible — existing configs with named paths (e.g., `Atlas`, `100 Inbox`) must continue working identically
- Migration must be transparent — no user action required, no data loss
- `**` warning in `validateGlobPattern` must be suppressed or removed since `**` is now an official supported pattern
- Obsidian plugin API: `TFolder` root has path `""` — cannot be selected via standard folder picker

### Assumptions

- The existing `matchGlob("**", path)` correctly matches all vault paths (confirmed by existing tests)
- No configs exist with patterns like `**/something` that would be affected by `**` validation changes
- The config migration pattern in `config-manager.ts` (merge-on-load) is sufficient for this change

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Migration silently breaks custom `/`-prefixed patterns from unknown sources | Medium | Low | Only migrate exact `/` match, not patterns starting with `/` |
| `listDir` file filtering changes `childCount` behavior | Medium | Medium | Update `visibleChildCount` to also filter files by scope; add tests |
| MCP consumers rely on seeing all root files in `listDir` | Low | Low | This is a bug fix — consumers shouldn't see items they can't access |

## Open Questions

- (none — all decisions made during investigation)

---

## Supporting Research

### Competitive Analysis

Not applicable — Kado is a novel Obsidian-to-MCP bridge with no direct competitors for this permission model.

### User Research

Bug discovered during live testing with Privat-Test vault. The vault administrator (project owner) configured `/` expecting full vault access, found via MCP that the permission system didn't enforce the expected behavior. Root cause confirmed by code analysis.

### Market Data

Not applicable for this bug fix / UX improvement.
