# Specification: 005-full-vault-access-and-listdir-scope-fix

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-04-12 |
| **Current Phase** | Ready |
| **Last Updated** | 2026-04-12 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | completed | 5 features, 16 acceptance criteria |
| solution.md | completed | 4 ADRs confirmed |
| plan/ | completed | 3 phases, 12 tasks (3 parallel in P1, 4 parallel in P3) |

**Status values**: `pending` | `in_progress` | `completed` | `skipped`

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-12 | Use `**` glob for full vault access | Consistent with glob convention, no special-casing in permission engine needed |
| 2026-04-12 | API key paths stay picker-only | Keep constraint model simple; future: subfolder narrowing of global paths |
| 2026-04-12 | No root-only (`*`) feature for now | Simplify scope — full vault or specific directories only |
| 2026-04-12 | ADR-2: Filter files in walk() not post-walk | Consistent with folder filtering, better memory efficiency |
| 2026-04-12 | ADR-3: Silent migration in load() | Follows existing migration pattern, transparent to user |
| 2026-04-12 | ADR-4: Remove `**` warning entirely | `**` is officially supported, warning would confuse picker users |

## Context

Two bugs discovered via Privat-Test vault:
1. No way to configure "full vault" access — `/` pattern doesn't match any Obsidian paths (expands to `//**`), UI rejects `/` in path input, folder picker excludes vault root
2. `listDir` walk adds files unconditionally without scope filtering — only folders are checked

Additional: legacy `/` configs need migration to `**`, docs need comprehensive update.

---
*This file is managed by the xdd-meta skill.*
