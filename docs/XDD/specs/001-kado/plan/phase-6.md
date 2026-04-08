---
title: "Phase 6: Integration, Audit & Polish"
status: completed
version: "1.0"
phase: 6
---

# Phase 6: Integration, Audit & Polish

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Acceptance Criteria]` — Full acceptance criteria checklist
- `[ref: SDD/Quality Requirements]` — Performance, security, reliability targets
- `[ref: SDD/Building Block View — AuditLogger]`
- `[ref: PRD/Section 6 — Success Metrics]`
- `[ref: Constitution.md]` — L1/L2 rules for testing, security, performance

**Key Decisions**:
- Audit log is NDJSON, append-only, with rotation
- Integration tests use mock Obsidian vault but exercise full pipeline
- No content in audit logs — only metadata (timestamps, paths, operations, decisions)

**Dependencies**:
- All previous phases complete (1-5)

---

## Tasks

Final integration, audit logging implementation, and comprehensive validation. This phase ensures all components work together and the system meets PRD acceptance criteria.

- [ ] **T6.1 AuditLogger** `[activity: backend-api]`

  1. Prime: Read SDD audit log design and PRD audit feature `[ref: SDD/Data Storage — Audit log]` `[ref: PRD/Feature 8 — Auditability]`
  2. Test: Log entry written on allowed request (timestamp, keyId, operation, path, "allowed"); log entry written on denied request (timestamp, keyId, operation, path, "denied", gate); no content in log entries; log disabled when audit.enabled = false; file rotation when exceeding maxSizeBytes
  3. Implement: Create `src/core/audit-logger.ts` — `AuditLogger` class with `log(entry)` method. Writes NDJSON to configured path. Checks file size before write, rotates if needed. Receives write callback (no direct fs access — writes through adapter or plugin API).
  4. Validate: Unit tests pass; lint clean
  5. Success: Access decisions logged with metadata only, no content `[ref: PRD/Feature 8]` `[ref: PRD/Section 5.1 — BR-P10]`

- [ ] **T6.2 Audit Integration** `[activity: backend-api]`

  1. Prime: Read SDD permission chain → audit logger integration `[ref: SDD/Building Block View — Components]`
  2. Test: Permission chain calls audit logger after each evaluation (allowed or denied); tool handlers log operation start and result; audit entries include duration
  3. Implement: Wire AuditLogger into PermissionChain (post-evaluation callback) and tool handlers (operation logging). Add duration measurement.
  4. Validate: Integration tests verify audit entries written for allow + deny; lint clean
  5. Success: All access decisions and operations auditable `[ref: SDD/Acceptance Criteria — Authentication & Authorization]`

- [ ] **T6.3 End-to-End Tool Call Tests** `[activity: testing]`

  1. Prime: Read SDD runtime view sequences and acceptance criteria `[ref: SDD/Runtime View]` `[ref: SDD/Acceptance Criteria]`
  2. Test:
     - kado-read note: auth → gates pass → note content returned with timestamps
     - kado-read frontmatter: returns structured object
     - kado-read dataview-inline-field: returns parsed fields
     - kado-write note (create): new file created
     - kado-write note (update): timestamp validated, content modified
     - kado-write with wrong timestamp: 409 Conflict
     - kado-search byTag: returns matching notes in scope
     - kado-search listDir: returns directory contents with pagination
     - Unauthorized request: 401 before any processing
     - Forbidden path: 403 at correct gate
     - Path traversal: VALIDATION_ERROR
  3. Implement: Create `test/integration/tool-roundtrip.test.ts` — tests exercise full pipeline: MCP tool args → RequestMapper → PermissionChain → OperationRouter → Adapter (mocked Obsidian) → ResponseMapper → result. Use realistic config with multiple areas and keys.
  4. Validate: All integration tests pass; lint clean
  5. Success:
     - All SDD acceptance criteria for auth/read/write/search verified `[ref: SDD/Acceptance Criteria]`
     - All PRD must-have features exercised `[ref: PRD/Features 1-21]`

- [ ] **T6.4 Console Logging** `[activity: backend-api]`

  1. Prime: Read PRD always-on console logging requirements `[ref: PRD/Section 6 — Logging Requirements]`
  2. Test: Plugin load/unload logged; server start/stop logged (with port); config changes logged (field name, not values); errors logged
  3. Implement: Add `console.log` / `console.error` calls at key lifecycle points in KadoPlugin, KadoMcpServer, and ConfigManager. Use `[Kado]` prefix for identification.
  4. Validate: Manual verification in Obsidian console; lint clean
  5. Success: Minimal always-on logging without request-level detail `[ref: PRD/Section 6]`

- [ ] **T6.5 Obsidian Mock Extension** `[activity: testing]` `[parallel: true]`

  1. Prime: Read current `test/__mocks__/obsidian.ts` and identify missing API mocks
  2. Test: Mock covers: Vault.read/modify/create/delete/trash/process; Vault.readBinary/createBinary; FileManager.processFrontMatter; MetadataCache.getFileCache with tags/frontmatter; TFile.stat with ctime/mtime/size; normalizePath
  3. Implement: Extend `test/__mocks__/obsidian.ts` with all Obsidian APIs used by adapters. Add factory helpers for creating mock TFile, TFolder, CachedMetadata with realistic data.
  4. Validate: All adapter tests can use extended mock without additional setup
  5. Success: Comprehensive Obsidian mock supports all adapter tests `[ref: Constitution — L3 Testing: prefer fakes over full Obsidian UI]`

- [ ] **T6.6 Final Validation** `[activity: validate]`

  - Run full test suite: `npm test`
  - Run build: `npm run build`
  - Run lint: `npm run lint`
  - Verify:
    - All unit tests pass (core, mcp, obsidian layers)
    - All integration tests pass (tool roundtrip)
    - Build produces valid `build/main.js`
    - Zero lint errors
    - No MCP imports in `src/core/`, no Obsidian imports in `src/core/` or `src/mcp/`
    - Plugin loads in test vault, server starts, settings tab renders
    - `manifest.json` has correct id, name, author, minAppVersion
  - Success: System meets all PRD acceptance criteria and SDD quality requirements
