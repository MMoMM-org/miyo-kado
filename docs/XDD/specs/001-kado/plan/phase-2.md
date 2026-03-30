---
title: "Phase 2: Core — Permission Gates & Operation Routing"
status: pending
version: "1.0"
phase: 2
---

# Phase 2: Core — Permission Gates & Operation Routing

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Permission Gate Chain example]` — Gate evaluation pseudocode
- `[ref: SDD/ADR-4]` — Chain of Responsibility for permission gates
- `[ref: SDD/ADR-8]` — Optimistic concurrency via timestamps
- `[ref: SDD/Canonical Types — CoreError, GateResult, PermissionGate]`
- `[ref: PRD/Section 5.1]` — Permission Evaluation business rules BR-P1 through BR-P10

**Key Decisions**:
- 5 gates in fixed order: Authenticate → Global Scope → Key Scope → DataType → Path Access (ADR-4)
- Short-circuit on first denial — no further gates evaluated
- Path normalization rejects `../` traversal before any vault access
- Timestamp mismatch returns 409 Conflict, not 403 Forbidden (ADR-8)

**Dependencies**:
- Phase 1 complete (canonical types, ConfigManager)

---

## Tasks

Establishes the security-critical permission evaluation chain and operation routing. This is Kado's core business logic with zero external dependencies.

- [ ] **T2.1 AuthenticateGate** `[activity: domain-modeling]`

  1. Prime: Read PRD BR-P1 (API key existence check) `[ref: PRD/Section 5.1 — BR-P1]`
  2. Test: Known enabled key → allowed; unknown key → UNAUTHORIZED; disabled key → UNAUTHORIZED; missing apiKeyId → UNAUTHORIZED
  3. Implement: Create `src/core/gates/authenticate.ts` — looks up key in config, checks `enabled` flag
  4. Validate: Unit tests pass; lint clean
  5. Success: Unauthenticated requests are rejected before any further processing `[ref: PRD/Feature 3 — API-key-based authorization]`

- [ ] **T2.2 GlobalScopeGate** `[activity: domain-modeling]`

  1. Prime: Read PRD BR-P2, BR-P4 (default-deny, path scoping) `[ref: PRD/Section 5.1 — BR-P2, BR-P4]`
  2. Test: Path in a global area → allowed; path outside all global areas → FORBIDDEN; empty global areas → all paths denied; glob pattern matching works (e.g., `projects/**` matches `projects/sub/file.md`)
  3. Implement: Create `src/core/gates/global-scope.ts` — checks if request path matches any GlobalArea's pathPatterns
  4. Validate: Unit tests pass; lint clean
  5. Success: Paths outside global areas are denied `[ref: PRD/Feature 1 — Default-Deny]` `[ref: PRD/Feature 2 — Global scope configuration]`

- [ ] **T2.3 KeyScopeGate** `[activity: domain-modeling]` `[parallel: true]`

  1. Prime: Read PRD BR-P3 (key can only restrict, not extend) `[ref: PRD/Section 5.1 — BR-P3]`
  2. Test: Key has area assigned that covers path → allowed; key has no areas assigned → FORBIDDEN; key area doesn't cover path → FORBIDDEN; key scope is intersection with global (never expands)
  3. Implement: Create `src/core/gates/key-scope.ts` — checks if request path is within any of the key's assigned areas
  4. Validate: Unit tests pass; lint clean
  5. Success: Per-key scoping restricts within global bounds `[ref: PRD/Feature 4 — Per-key scoped permissions]`

- [ ] **T2.4 DataTypePermissionGate** `[activity: domain-modeling]` `[parallel: true]`

  1. Prime: Read PRD BR-P5 through BR-P8 (data type rights) `[ref: PRD/Section 5.1 — BR-P5, BR-P6, BR-P7, BR-P8]`
  2. Test: Key has read permission for notes → allowed; key lacks update permission for frontmatter → FORBIDDEN; CRUD flags checked independently per data type; Dataview inline field treated as separate data type
  3. Implement: Create `src/core/gates/datatype-permission.ts` — extracts operation's implied CRUD action and data type, checks against key's effective permissions for the matched area
  4. Validate: Unit tests pass; lint clean
  5. Success: CRUD permissions enforced independently per data type `[ref: PRD/Feature 5 — Independent CRUD permissions]` `[ref: PRD/Feature 6 — Distinct Note and Frontmatter model]`

- [ ] **T2.5 PathAccessGate** `[activity: domain-modeling]` `[parallel: true]`

  1. Prime: Read SDD error handling matrix for VALIDATION_ERROR `[ref: SDD/Error Handling]`
  2. Test: Normal path → allowed; path with `../` → VALIDATION_ERROR; path with `..\\` → VALIDATION_ERROR; path starting with `/` normalized; empty path → VALIDATION_ERROR; path with null bytes → VALIDATION_ERROR
  3. Implement: Create `src/core/gates/path-access.ts` — normalizes path, rejects traversal sequences, validates path format
  4. Validate: Unit tests pass; lint clean
  5. Success: Path traversal attempts rejected before any vault access `[ref: PRD/Feature 7 — Fail-fast authorization]`

- [ ] **T2.6 PermissionChain** `[activity: domain-modeling]`

  1. Prime: Read SDD gate chain example `[ref: SDD/Implementation Examples — Permission Gate Chain]`
  2. Test: All gates pass → allowed; gate 1 fails → UNAUTHORIZED returned, gates 2-5 not called; gate 3 fails → FORBIDDEN returned, gates 4-5 not called; chain evaluates in correct order
  3. Implement: Create `src/core/permission-chain.ts` — `evaluatePermissions(request, config, gates)` iterates gates, short-circuits on denial
  4. Validate: Unit tests pass with mock gates; lint clean
  5. Success: Permission chain short-circuits correctly on denial `[ref: PRD/Feature 7 — Fail-fast authorization]`

- [ ] **T2.7 ConcurrencyGuard** `[activity: domain-modeling]`

  1. Prime: Read SDD timestamp concurrency example `[ref: SDD/Implementation Examples — Optimistic Concurrency]` `[ref: SDD/ADR-8]`
  2. Test: Write with matching expectedModified → allowed; write with mismatching expectedModified → CONFLICT; write without expectedModified (create) → allowed; read requests bypass guard
  3. Implement: Create `src/core/concurrency-guard.ts` — validates `expectedModified` against current mtime for write operations
  4. Validate: Unit tests pass; lint clean
  5. Success: Timestamp mismatches return 409 Conflict `[ref: PRD/Section 5.4 — BR-C1, BR-C2, BR-C3]`

- [ ] **T2.8 OperationRouter** `[activity: domain-modeling]`

  1. Prime: Read SDD OperationRouter component description `[ref: SDD/Building Block View — Components]`
  2. Test: Read request with operation "note" → routes to NoteAdapter; write request with operation "frontmatter" → routes to FrontmatterAdapter; search request → routes to SearchAdapter; unknown operation → VALIDATION_ERROR
  3. Implement: Create `src/core/operation-router.ts` — accepts adapter registry, routes CoreRequest to correct adapter based on operation field
  4. Validate: Unit tests pass with mock adapters; lint clean
  5. Success: Operations correctly routed to appropriate adapter by data type `[ref: SDD/ADR-3 — Fat Tools]`

- [ ] **T2.9 Phase Validation** `[activity: validate]`

  - Run all Phase 2 tests. Verify: all 5 gates independently testable with allow + deny cases; chain short-circuits correctly; concurrency guard validates timestamps; router dispatches to correct adapter. Lint and typecheck pass. No MCP or Obsidian imports in any `src/core/` file.
