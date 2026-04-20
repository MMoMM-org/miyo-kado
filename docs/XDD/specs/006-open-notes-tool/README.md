# Specification: 006-open-notes-tool

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-04-20 |
| **Current Phase** | Ready |
| **Last Updated** | 2026-04-20 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | completed | Approved by user |
| solution.md | completed | Approved by user |
| plan/ | completed | 3 phases approved; ready for implementation |

**Status values**: `pending` | `in_progress` | `completed` | `skipped`

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-20 | Spec scaffolded | New MCP tool `kado-open-notes` with per-key opt-in gates |
| 2026-04-20 | Per-key default OFF, no inheritance from global | User explicit opt-in required; minimizes exposure surface |
| 2026-04-20 | Single tool with `scope` param (active/other/all) | Simpler than split tools; consistent error model |
| 2026-04-20 | Path-ACL filtering is silent; `not_allowed` only on feature-gate | Prevents note-existence leak via per-note "no permission" |
| 2026-04-20 | PRD approved | All 21 acceptance criteria captured; no open questions |
| 2026-04-20 | SDD approved with 6 ADRs | Reuse existing permission chain; feature gate as standalone pure function; known view-types only; silent path-ACL filter; single tool with scope param; per-key default OFF with AND semantics |
| 2026-04-20 | PLAN approved — 3 phases, 13 tasks | Phase 1 foundation (parallelizable), Phase 2 MCP wiring, Phase 3 UI + E2E |

## Context

New MCP tool `kado-open-notes` that returns currently open Obsidian notes as JSON.

**Config surface:**
- Global: `allowActiveNote`, `allowOtherNotes` (both default `false`)
- Per Key: same flags, both default `false`, **no inheritance** from global

**UI:** New "Open Notes" section between Access Mode and Paths in both GlobalSecurityTab and ApiKeyTab. Wording flips with whitelist/blacklist access mode.

**Tool contract:**
- Params: `scope: "active" | "other" | "all"` (default `all`)
- Returns: `{ notes: [{ name, path, active, type }] }`
- Errors: `not_allowed` when all requested scopes are gated

**Semantics:**
- `active` = focused leaf
- `type` = `markdown` | `canvas` | `pdf` | …
- Feature-gate off + scope explicitly requested → `not_allowed`
- Feature-gate off + `scope: all` → silently filter out the gated category
- Path-ACL denial → silently filter (do not leak note existence)
- Path-ACL reuses existing whitelist/blacklist permission check

---
*This file is managed by the xdd-meta skill.*
