---
title: "Phase 2: MCP Tool Registration & Handler"
status: pending
version: "1.0"
phase: 2
---

# Phase 2: MCP Tool Registration & Handler

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Interface Specifications/Tool Contract]`
- `[ref: SDD/Runtime View/Primary Flow]`
- `[ref: SDD/Implementation Examples/Example 3 (Tool Handler Composition)]`
- `[ref: SDD/Architecture Decisions/ADR-1, ADR-4, ADR-5]`
- `[ref: SDD/Cross-Cutting Concepts/System-Wide Patterns/Logging/Auditing]`

**Key Decisions**:
- ADR-1: reuse `filterResultsByScope` / `resolveScope` for path ACL — do not duplicate.
- ADR-4: path-ACL denial is silent; only feature-gate denial returns an error.
- ADR-5: one tool with a `scope` parameter (default `all`).

**Dependencies**:
- Phase 1 (all tasks) must be complete — this phase wires the pieces together.

---

## Tasks

Phase 2 wires the pieces built in Phase 1 into the MCP tool registry: a request/response mapper, a handler that composes feature gate → adapter → path ACL → audit, and the registration entry point.

- [ ] **T2.1 Request/response mappers** `[activity: backend-api]`

  1. **Prime**: Read existing mappers `[ref: src/mcp/request-mapper.ts]` and `[ref: src/mcp/response-mapper.ts]`.
  2. **Test**: `mapOpenNotesRequest({})` with no `scope` produces `CoreOpenNotesRequest` with `scope: 'all'` and the supplied `keyId`; `mapOpenNotesRequest({ scope: 'active' })` passes through; invalid scope is rejected via Zod before the mapper runs (verify at the Zod-schema boundary); `mapOpenNotesResult({ notes: [...] })` produces a `CallToolResult` where `content[0].text` is valid JSON with the exact shape `{ notes: [{ name, path, active, type }] }`.
  3. **Implement**: Add `mapOpenNotesRequest` in `src/mcp/request-mapper.ts`; add `mapOpenNotesResult` in `src/mcp/response-mapper.ts`. Both follow the existing mapper conventions.
  4. **Validate**: Unit tests pass; typecheck both tsconfig; lint.
  5. **Success**:
     - [ ] Missing `scope` defaults to `'all'` `[ref: PRD/AC Feature-1 "default all"]`
     - [ ] Response JSON shape matches contract exactly `[ref: PRD/AC Feature-1 "keys: name, path, active, type"]`

- [ ] **T2.2 Tool handler + registration** `[activity: backend-api]`

  1. **Prime**: Read the existing `registerTools` and handler pattern `[ref: src/mcp/tools.ts; registerReadTool / registerSearchTool]`; read `filterResultsByScope` `[ref: src/mcp/tools.ts; lines: 123-137]`; read SDD Example 3 `[ref: SDD/Implementation Examples/Example 3]`.
  2. **Test**:
     - Missing/invalid bearer → `UNAUTHORIZED` (existing auth path is unchanged — covered by ensuring handler does not bypass it).
     - Both gates off, `scope: 'all'` → `FORBIDDEN` with `gate: 'feature-gate'`; no adapter call (mock verifies zero invocations).
     - `scope: 'active'`, gates allow, one markdown open with key has R permission → response `{ notes: [{ ... active: true }] }`.
     - `scope: 'other'`, gates allow, two open files (one active one not), key has R on both → response contains only the non-active one with `active: false`.
     - `scope: 'all'`, gates allow both, three files open, key has R on only two of them → response contains the two (one may be active), the third is silently omitted.
     - `scope: 'all'`, only `allowActiveNote` on, two files open → response contains only the active file.
     - All files filtered by path ACL → `{ notes: [] }` with no error.
     - Zero files open + gates on → `{ notes: [] }` with no error.
     - Adapter throws unexpected error → `INTERNAL_ERROR` mapped via `mapError`; caught and logged.
  3. **Implement**: Create `registerOpenNotesTool()` in `src/mcp/tools.ts` mirroring the existing tool-registration pattern. Compose: authenticate → `mapOpenNotesRequest` → `gateOpenNoteScope` → (on allow) `enumerateOpenNotes` → prune to scope kind → `filterResultsByScope`-equivalent path ACL → `mapOpenNotesResult`. Add it to `registerTools()`. Thread `app: App` into `ToolDependencies` if not already available (minimal change — verify existing deps first).
  4. **Validate**: All tests pass, including negative path-ACL and negative feature-gate paths. `npx tsc --noEmit` both configs; `npm run lint`.
  5. **Success**:
     - [ ] Tool is registered and discoverable via MCP `list_tools` `[ref: SDD/Tool Contract]`
     - [ ] Feature-gate denial returns `FORBIDDEN` with `gate: 'feature-gate'` `[ref: PRD/AC Feature-3]`
     - [ ] Path-ACL denial NEVER surfaces per-note error `[ref: PRD/AC Feature-3 "silent filter"; SDD/ADR-4]`
     - [ ] Response shape exactly matches contract `[ref: PRD/AC Feature-1]`
     - [ ] Reuses existing path-ACL functions; no duplicated glob matching `[ref: SDD/ADR-1]`

- [ ] **T2.3 Audit log integration** `[activity: backend-api]` `[parallel: true]`

  1. **Prime**: Read `[ref: src/core/audit-logger.ts]` and existing `createAuditEntry` call sites in `src/mcp/tools.ts`.
  2. **Test**: When `auditLogger` is present, a `kado-open-notes` tool call produces one audit entry with action=`openNotes`, scope from the request, resulting permitted count; denied feature-gate calls also log (with denial reason); audit entries do NOT contain paths of ACL-filtered notes (only the permitted count).
  3. **Implement**: Wire audit-log call into the handler from T2.2 at success and denial branches.
  4. **Validate**: Unit tests pass; lint; typecheck.
  5. **Success**:
     - [ ] Audit emits exactly once per call `[ref: SDD/System-Wide Patterns/Logging-Auditing]`
     - [ ] Audit never leaks ACL-filtered paths `[ref: SDD/Gotchas; SDD/ADR-4]`

- [ ] **T2.4 Phase 2 Validation** `[activity: validate]`

  - Run all Phase 2 unit tests plus Phase 1 tests to confirm no regressions. Run `npm run build`. Manually confirm the tool appears in the MCP server's tool list when the plugin loads (smoke test via logs, UI-verification deferred to Phase 3). Confirm `ADR-1` and `ADR-4` are satisfied by code inspection — no parallel ACL path, no per-note error leaks.

---

## Deviation Log

*No deviations recorded yet.*
