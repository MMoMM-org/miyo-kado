# Specification: 002-UI Settings Rework

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-03-31 |
| **Current Phase** | PRD |
| **Last Updated** | 2026-03-31 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | in_progress | PRD draft complete, user review pending |
| solution.md | pending | Technical design |
| plan/ | pending | Implementation plan |

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

## Context

UI rework of the Kado Obsidian plugin settings tab. Mockup exists in temp/v3/. Key concerns:
- MCP server IP/port should be locked while server is running
- Audit log location decision (.obsidian vs vault-relative)
- Directory paths should use a directory picker
- Tag input should handle with/without #, nested tags (#this/is/a/tag), and wildcard (*)
- Design must align with existing Kado visual identity

---
*This file is managed by the xdd-meta skill.*
