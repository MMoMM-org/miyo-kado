---
title: "Phase 2: HTTP 406 Bug #1 Investigation and Fix"
status: completed
version: "1.0"
phase: 2
---

# Phase 2: HTTP 406 Bug #1 Investigation and Fix

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `docs/XDD/specs/004-listdir-depth-type-folders/solution.md` §Known Technical Issues (HTTP 406 description)
- `docs/XDD/specs/004-listdir-depth-type-folders/requirements.md` Feature 3 (acceptance criteria)
- `docs/XDD/ideas/2026-04-11-listdir-depth-type-folders.md` §6 Bug #1 description and contingency plan
- `_inbox/from-tomo/2026-04-11_tomo-to-kado_listdir-api-gaps.md` §1 — original reproducer (`path: "100 Inbox/"` → HTTP 406)

**Key Decisions**:
- Root cause is **unknown** at spec time. The investigation is driven by a failing reproducer test. Fix lands wherever the root cause lives — mapper, transport, Zod schema, or elsewhere.
- **Contingency**: if the root cause is in the MCP SDK or otherwise out of our control, fall back to stripping trailing slashes in `mapSearchRequest`. This is explicitly documented as a workaround, not the preferred outcome.
- `normalizeDirPath` in `request-mapper.ts:90-94` already appends a trailing slash for `listDir` paths — so something DOWNSTREAM of the mapper is rejecting the slash. The investigation starts there.

**Dependencies**:
- None directly. **Can run in parallel with Phase 1** `[parallel: true with Phase 1]`.
- Uses the existing `test/MiYo-Kado/` fixture vault. No Phase 3 fixture extensions needed yet — the reproducer only needs one real folder path (e.g., `test/MiYo-Kado/allowed/`).

---

## Tasks

This phase closes the HTTP 406 trailing-slash bug. It is independent of the main `listDir` refactor and can ship on its own if needed.

- [x] **T2.1 HTTP 406 Reproducer and Root-Cause Fix** `[parallel: true]` `[activity: backend-api]` `[ref: PRD/Feature 3; SDD/§Known Technical Issues]`

  1. **Prime**: Read Tomo's original reproducer in `_inbox/from-tomo/2026-04-11_tomo-to-kado_listdir-api-gaps.md` §1. Read `src/mcp/request-mapper.ts:90-94` (`normalizeDirPath`) to confirm it does NOT strip the trailing slash — it appends one if missing. Read `src/core/gates/path-access.ts:19-50` to confirm the gate's `normalizePath` keeps trailing slashes intact. Read `src/mcp/tools.ts:68-74` (`kadoSearchShape`) to confirm Zod accepts any string. Skim `src/mcp/tools.ts:277-380` (`registerSearchTool`) for the error-response pipeline between the adapter result and the HTTP layer.
  2. **Test** (RED): Write an integration test in `test/integration/tool-roundtrip.test.ts` (or a new file `test/integration/listdir-trailing-slash.test.ts`) that:
      - Sets up a test vault with a folder `AllowedFolder/` containing at least one markdown file
      - Calls `kado-search listDir` via the full MCP tool-handler path with `path: "AllowedFolder/"` (explicit trailing slash)
      - Asserts the response is a successful listing — no `code` field, non-empty or empty `items`, no HTTP 406
      - Also asserts that `path: "AllowedFolder"` (no trailing slash) returns an equivalent result
  3. **Implement** (GREEN):
      - Run the failing test. Capture the full stack trace or error origin.
      - Follow the call stack from `registerSearchTool` → `mapSearchRequest` → permission chain → `createSearchAdapter.search` → `listDir`. Identify the layer that produces the 406.
      - Common suspects: (a) Zod schema path pattern (unlikely — no pattern set); (b) path-access gate's pattern match against blacklist/whitelist patterns that assume no trailing slash; (c) MCP SDK content-negotiation layer; (d) an HTTP handler wrapping the response writer.
      - Fix at the root-cause layer. **Do not paper over it with a second normalization step** unless the root cause is outside our codebase, in which case strip the trailing slash defensively in `mapSearchRequest` before `normalizeDirPath` runs.
      - Document the root cause in the commit message and in this task's completion note.
  4. **Validate**:
      - Failing test now passes.
      - All existing tests still pass.
      - `npm run build` + `npm run lint` clean.
      - The same trailing-slash input works for any folder path in the vault, not just the one in the reproducer.
  5. **Success**:
      - Every PRD Feature 3 acceptance criterion passes. `[ref: PRD/Feature 3 AC]`
      - Root cause is documented — a future reader of the commit history can understand why the bug existed and how it was fixed. `[ref: SDD/§Known Technical Issues]`
      - If the contingency fallback (mapper strip) was used, the task's completion note explicitly says so and flags the underlying upstream issue for follow-up.

- [x] **T2.2 Phase 2 Validation** `[activity: validate]`

  1. **Prime**: Read T2.1 completion notes for the root cause.
  2. **Implement**: Run `npm test`, `npm run lint`, `npm run build`. Run the live test suite at `test/live/mcp-live.test.ts` if it has tests that exercise trailing-slash paths — if they previously skipped this case, add an assertion now.
  3. **Validate**: Every T2.1 success criterion is checked off. No regressions elsewhere.
  4. **Success**: Bug #1 is closed. Tomo's `kado_client.py` trailing-slash strip workaround is no longer needed (documented in Phase 5 post-ship handoff).
