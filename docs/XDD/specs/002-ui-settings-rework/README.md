# Specification: 002-UI Settings Rework

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-03-31 |
| **Current Phase** | Ready |
| **Last Updated** | 2026-03-31 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | completed | v1.1 — all user feedback incorporated, all questions resolved |
| solution.md | completed | v1.0 — all ADRs confirmed, full design documented |
| plan/ | completed | 5 phases, 22 tasks |

**Status values**: `pending` | `in_progress` | `completed` | `skipped`

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-31 | Initialize spec 002 | UI settings rework based on v3 mockup analysis |
| 2026-03-31 | Audit log: vault-relative path | User wants log visible, syncable, with directory picker. No .obsidian hidden path. |
| 2026-03-31 | Keep two-layer permission model | GlobalAreas → Keys inherit. Add whitelist/blacklist toggle per scope. Default = whitelist, nothing allowed. Keys restricted to global's available paths/tags. |
| 2026-03-31 | Tags: Read-only filter only | Tags are a filter mechanism ("files from allowed paths with tag X"). CUD not applicable to tags. Fixed R permission. |
| 2026-03-31 | Delete key: confirmation dialog, default=No | Prevent accidental key deletion. |
| 2026-03-31 | Add regenerate key button | Allow key rotation without losing assignments. Confirmation required. |
| 2026-03-31 | PRD draft completed | Full requirements document written to requirements.md |
| 2026-03-31 | Tab overflow: scroll buttons | Left/right arrows for tab bar overflow, not second row |
| 2026-03-31 | Audit log: editable filename + rotation with retention | Dir picker for folder, text input for filename. Log rotation with max retained count (default 3). |
| 2026-03-31 | Path picker: modal (not system browser) | Obsidian Modal subclass with filtered TFolder list. Standard Obsidian pattern. |
| 2026-03-31 | Whitelist/blacklist: per scope, not per path/tag | One toggle per area/tab applies to both paths and tags in that scope |
| 2026-03-31 | Tag picker + manual entry | Tags selectable from vault metadata cache (frontmatter + inline merged) AND manually editable |
| 2026-03-31 | Tag x Path intersection rule | Tag queries return only files that are BOTH tagged AND in allowed paths |
| 2026-03-31 | No key masking | Keys always displayed in full, no obfuscation |
| 2026-03-31 | No New Keys session tab | Per-key tabs sufficient |
| 2026-03-31 | Wildcard only at end | tag/* valid, project/*/notes NOT valid |
| 2026-03-31 | Inherit Obsidian theme | No custom color palette, use Obsidian CSS variables |
| 2026-03-31 | No backward compat needed | Only test instance, config can be reset during dev |
| 2026-03-31 | Plugin version + docs link | Show version from manifest + link to docs at top of settings (ref: dynbedded) |
| 2026-03-31 | PRD v1.1 — user review incorporated | All inline notes resolved, open questions closed |
| 2026-03-31 | ADR-1: Settings file decomposition | Split settings.ts into SettingsTab + tabs/ + components/. Confirmed. |
| 2026-03-31 | ADR-2: Data model extensions | Extend GlobalArea (listMode, tags), AuditConfig (logDir, fileName, retention), KeyAreaConfig (tags). Confirmed. |
| 2026-03-31 | ADR-3: Obsidian Modal for pickers | Use Modal class for folder/tag pickers. Confirmed. |
| 2026-03-31 | ADR-4: Tag storage & matching | Store without #, normalize on input, getAllTags() for merged set, wildcard at end only. Confirmed. |
| 2026-03-31 | ADR-5: Whitelist/blacklist scope-level | listMode on GlobalArea applies to both paths and tags. Key inherits. Confirmed. |
| 2026-03-31 | SDD v1.0 completed | Full solution design with all sections, 5 ADRs confirmed |
| 2026-03-31 | PLAN v1.0 completed | 5 phases, 22 tasks, all PRD/SDD requirements mapped |
| 2026-03-31 | Validation: blacklist + zero rules = full access | Intentional. UI warning added for both global and key level. |
| 2026-03-31 | Validation: key tab shows inherited mode | Read-only label, permissions editable but constrained by global max. |
| 2026-03-31 | Validation: fix getAllTags API | Use app.metadataCache.getTags(), not getAllTags() standalone import |
| 2026-03-31 | Validation: add ServerConfig.connectionType | Added to SDD data model |
| 2026-03-31 | Validation: tag×path filter moved to Phase 4 | May need production code, not just Phase 5 verification |
| 2026-03-31 | Validation: all MEDIUM findings fixed | PRD v1.2, SDD v1.1, PLAN v1.1 |

## Context

UI rework of the Kado Obsidian plugin settings tab. Mockup exists in temp/v3/. Key concerns:
- MCP server IP/port should be locked while server is running
- Audit log location decision (.obsidian vs vault-relative)
- Directory paths should use a directory picker
- Tag input should handle with/without #, nested tags (#this/is/a/tag), and wildcard (*)
- Design must align with existing Kado visual identity

---
*This file is managed by the xdd-meta skill.*
