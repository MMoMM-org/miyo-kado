# Specification: 004-listdir-depth-type-folders

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-04-11 |
| **Current Phase** | Shipped |
| **Last Updated** | 2026-04-11 |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | completed | PRD complete: 7 Must features + 1 Should, 24 Gherkin acceptance criteria, zero clarification markers |
| solution.md | completed | SDD complete: 10 ADRs (all pre-confirmed via brainstorm/research), constitution-aligned, 3 worked implementation examples |
| plan/ | completed | 5 phases, 16 tasks, all shipped. 650/650 tests passing. Target version 0.2.0 via semantic-release. |

**Status values**: `pending` | `in_progress` | `completed` | `skipped`

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-11 | Spec scaffolded from brainstorm idea | Source: `docs/XDD/ideas/2026-04-11-listdir-depth-type-folders.md` — consolidates kokoro and tomo inbox handoffs on `listDir` enhancements plus two related bug fixes |
| 2026-04-11 | Research mode: Standard (parallel fire-and-forget) | Brainstorm already provided solid baseline; research used for gap-filling across Requirements, Technical, Security, Performance, Integration perspectives |
| 2026-04-11 | childCount reflects **filtered** count of direct children | Excludes hidden and out-of-scope children — prevents information leak about children the caller cannot see. Minor implementation cost (scope-check pass per folder in the walk) is acceptable. |
| 2026-04-11 | Hidden folder targets rejected with NOT_FOUND | `resolveFolder` checks any `.`-prefixed segment in `request.path` and returns NOT_FOUND (not VALIDATION_ERROR — avoids confirming existence). Closes security hole where caller could directly enumerate `.obsidian`. |
| 2026-04-11 | `depth: -1` rejected with VALIDATION_ERROR | Single unambiguous way to request unlimited recursion (omit the parameter). Kokoro's original `depth: -1` proposal is rejected; migration note goes to Kokoro reply outbox. |
| 2026-04-11 | SDD written with 10 ADRs, constitution validated | All L1 Security/Architecture/Testing/Performance rules verified: three-layer defense-in-depth preserved, no new dependencies, pagination unchanged, main-thread walk cost proven O(visited nodes), test coverage planned for every happy path + denial case. |
| 2026-04-11 | PLAN written: 5 phases, 12 tasks | Phase 1 (types+mapper) and Phase 2 (HTTP 406) parallel-safe; Phases 3→4→5 strictly sequential. All tasks trace to PRD acceptance criteria and SDD sections. TDD discipline (Prime/Test/Implement/Validate) applied per task. |
| 2026-04-11 | **Spec 004 shipped** on branch `feat/listdir-depth-type-folders`. 13 commits, 20 files changed (+1497/-67), 650/650 tests passing, all 10 ADRs reflected in code, all 24 Gherkin acceptance criteria covered. | Target version 0.2.0 via semantic-release. Outbox handoff replies delivered to Tomo and Kokoro (local — `_outbox/` is gitignored per protocol). Phase 2 Bug #1 discovered to be pre-fixed in historical commit `63fd74c` — regression tests retained. |

## Context

**Source idea:** `docs/XDD/ideas/2026-04-11-listdir-depth-type-folders.md`

**Scope:** `kado-search listDir` operation overhaul — depth parameter, folder entries, `type` field, `childCount`, canonical `/` root marker, error returns for invalid paths, folders-first sort ordering, plus two related bug fixes (HTTP 406 on trailing slash, empty-path handling).

**Origin handoffs:**
- `_inbox/from-kokoro/2026-04-09_kokoro-to-kado_listdir-depth-and-folder-items.md`
- `_inbox/from-tomo/2026-04-11_tomo-to-kado_listdir-api-gaps.md`

## Research Findings — Must Propagate to SDD

These findings emerged during the research phase and must be incorporated into the SDD:

**Critical gaps in the brainstorm spec:**
1. **`filterResultsByScope` in `src/mcp/tools.ts:93-102` needs folder awareness.** The brainstorm only addresses `filterItemsByScope` inside `search-adapter.ts`. But `tools.ts` also runs a post-adapter scope filter (line 93-102) and a blacklist filter (line 307-309). Both would apply plain `matchGlob` to folder items — a correctness bug. The SDD must include these two sites in the folder-aware refactor.
2. **`CoreSearchRequest` needs a `depth?: number` field.** The brainstorm only added `type?` and `childCount?` to `CoreSearchItem`. Without the request-side field, `request.depth` in the adapter walk is a TypeScript compile error.

**Design refinements:**
3. **Reuse `dirCouldContainMatches` from `src/core/glob-match.ts:75-80`** instead of reinventing the probe logic inline. The existing helper does exactly what the brainstorm's `folderInScope` tried to do.
4. **`childCount` computed from filtered walk**, not `folder.children.length`. The walk must count only children that pass the hidden-entry filter and the scope-pattern filter, mirroring the visible-children rule.
5. **`resolveFolder` rejects any dot-prefixed segment** in the requested path (e.g. `".obsidian"`, `"Atlas/.hidden"`) and returns NOT_FOUND — not VALIDATION_ERROR. Prevents existence confirmation.
6. **Import discipline:** `App` stays as `import type`, but `TFile` and `TFolder` become value imports (not type-only) so `instanceof` works at runtime.

**Security tradeoff to document (not change):**
7. The error distinction between `NOT_FOUND` (path doesn't exist) and `VALIDATION_ERROR` (path is a file) reveals a type hint to out-of-scope callers. Accepted as a deliberate tradeoff because explicit errors are the stated design intent. Document it in the SDD.

**Integration obligations (feed into PLAN):**
8. **Post-ship cross-repo handoffs** to Tomo (workarounds removable; `depth: -1` warning; `item.type` guard needed) and Kokoro (their `global/references/kado-v1-api-contract.md` needs external update).
9. **Version bump:** `0.1.5 → 0.2.0` via a `feat:` conventional commit (semantic-release).
10. **Test impact:** existing `test/obsidian/search-adapter.test.ts` listDir block (lines 81-144, 753, 820), `test/integration/tool-roundtrip.test.ts` (419-452), `test/mcp/request-mapper.test.ts`, and `test/live/mcp-live.test.ts` will fail — they mock `app.vault.getFiles` but the new walk uses `TFolder.children` via `getRoot()`. All need mock updates.

---
*This file is managed by the xdd-meta skill.*
</content>
</invoke>