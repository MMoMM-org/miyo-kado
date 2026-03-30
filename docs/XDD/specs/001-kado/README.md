# Specification: 001-kado

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-03-13 |
| **Current Phase** | PLAN |
| **Last Updated** | 2026-03-30 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| prd.md | completed | v2.0 — 21 must-have features, 4 data types (Notes, Frontmatter, Dataview Inline Fields, Files), 3 fat MCP tools, dual ACL architecture, timestamp concurrency |
| solution.md | completed | v1.0 — 4-layer Dual ACL, Streamable HTTP transport, Express.js, 3 fat tools, Chain of Responsibility gates, 8 ADRs confirmed |
| plan/ | completed | v1.0 — 6 phases, 30 tasks. Foundation → Core gates → Obsidian adapters → MCP server → Settings UI → Integration |

**Status values**: `pending` | `in_progress` | `completed` | `skipped`

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-13 | Created spec 001-kado | New specification for Kado project |
| 2026-03-13 | PRD v1.1 completed | Synthesized 5-perspective research into requirements.md |
| 2026-03-30 | PRD v2.0 rewritten | Consolidated requirements.md and prd.md into single prd.md. Added Dataview Inline Fields as 4th data type. Added fat tools pattern (kado-read/write/search), timestamp-based concurrency, dual ACL architecture. Removed payload versioning. Translated to English. |
| 2026-03-30 | ADR-001 revised | Superseded payload versioning ADR with Dual Anti-Corruption Layer Architecture ADR |
| 2026-03-30 | Spec files reorganized | Moved from spec_temp/ to docs/XDD/specs/001-kado/. Deleted duplicate requirements.md. DesignEntwurf.md archived to docs/XDD/ideas/. Constitution.md moved to project root. |
| 2026-03-30 | SDD v1.0 completed | 4-layer Dual ACL architecture. Streamable HTTP transport (revised from SSE — SSE is deprecated). Express.js for HTTP server. 8 ADRs confirmed: Dual ACL, Streamable HTTP, Fat Tools, Chain of Responsibility, data.json storage, kado_ UUID keys, self-parsed Dataview fields, timestamp concurrency. |
| 2026-03-30 | PLAN v1.0 completed | 6 phases, 30 tasks. Sequential dependencies: Foundation → Core → Adapters → MCP → UI → Integration. Parallel opportunities within phases 2 and 3. TDD throughout. |

## Context

Kado — Obsidian MCP Gateway plugin. Security-first MCP server exposing granular, per-API-key access control to vault content.

---
*This file is managed by the xdd-meta skill.*
