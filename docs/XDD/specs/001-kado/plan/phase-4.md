---
title: "Phase 4: MCP Layer — Server, Tools & Auth"
status: pending
version: "1.0"
phase: 4
---

# Phase 4: MCP Layer — Server, Tools & Auth

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Building Block View — MCP API Handler Layer]`
- `[ref: SDD/ADR-2]` — Streamable HTTP transport via Express.js
- `[ref: SDD/ADR-3]` — Fat Tools pattern (3 MCP tools)
- `[ref: SDD/MCP Tool Schemas]` — Zod schemas for kado-read, kado-write, kado-search
- `[ref: SDD/Runtime View — Primary Flow]` — Sequence diagram
- `[ref: SDD/Error Handling]` — Error matrix

**Key Decisions**:
- Use `@modelcontextprotocol/sdk` with `NodeStreamableHTTPServerTransport`
- Express.js hosts the `/mcp` endpoint (POST/GET/DELETE)
- Bearer token auth via Express middleware before transport handler
- MCP API Handler is the only layer that imports MCP SDK types

**Dependencies**:
- Phase 1 complete (canonical types, ConfigManager)
- Phase 2 complete (permission chain, operation router, concurrency guard)
- Phase 3 complete (all adapters)

---

## Tasks

Implements the outer ACL — the MCP protocol boundary. Wires everything together: HTTP server → auth → MCP tool handlers → core → adapters.

- [ ] **T4.1 AuthMiddleware** `[activity: backend-api]`

  1. Prime: Read SDD auth middleware design `[ref: SDD/Building Block View — AuthMiddleware]`
  2. Test: Request with valid Bearer token → sets req.auth and passes through; request without Authorization header → 401; request with invalid token format → 401; request with unknown key → 401
  3. Implement: Create `src/mcp/auth.ts` — Express middleware that extracts Bearer token, validates against ConfigManager, sets `req.auth` with key ID
  4. Validate: Unit tests pass; lint clean
  5. Success: Unauthenticated requests rejected at HTTP level `[ref: PRD/Feature 3 — API-key-based authorization]`

- [ ] **T4.2 RequestMapper & ResponseMapper** `[activity: backend-api]` `[parallel: true]`

  1. Prime: Read SDD mapper component descriptions `[ref: SDD/Building Block View — RequestMapper, ResponseMapper]`
  2. Test: MCP kado-read args → CoreReadRequest; MCP kado-write args → CoreWriteRequest with expectedModified; MCP kado-search args → CoreSearchRequest with cursor/limit; CoreFileResult → CallToolResult with text content + timestamps; CoreError → CallToolResult with isError:true; CoreSearchResult → CallToolResult with JSON items + cursor
  3. Implement: Create `src/mcp/request-mapper.ts` and `src/mcp/response-mapper.ts` — translate between MCP tool call arguments and canonical types
  4. Validate: Unit tests pass; lint clean
  5. Success: Clean bidirectional mapping between MCP and canonical types `[ref: SDD/ADR-1 — Dual ACL]`

- [ ] **T4.3 Tool Registration** `[activity: backend-api]`

  1. Prime: Read SDD tool schemas and MCP SDK tool registration API `[ref: SDD/MCP Tool Schemas]`
  2. Test: Server exposes exactly 3 tools (kado-read, kado-write, kado-search); each tool has correct Zod input schema; tool handler wires through RequestMapper → PermissionChain → OperationRouter → ResponseMapper; invalid operation value rejected by Zod validation
  3. Implement: Create `src/mcp/tools.ts` — registers `kado-read`, `kado-write`, `kado-search` with `server.registerTool()`. Each handler: map request → evaluate permissions → route to adapter → map response. Wire ConcurrencyGuard for write operations.
  4. Validate: Unit tests pass with mock core components; lint clean
  5. Success: 3 MCP tools registered with correct schemas and full pipeline `[ref: SDD/ADR-3 — Fat Tools]` `[ref: PRD/Section 5.3 — BR-T1, BR-T3]`

- [ ] **T4.4 MCP Server Lifecycle** `[activity: backend-api]`

  1. Prime: Read SDD server lifecycle and Streamable HTTP transport setup `[ref: SDD/ADR-2]` `[ref: SDD/Runtime View]`
  2. Test: Server starts on configured host:port; server stops and releases port on close; session management (create/reuse/cleanup); port-in-use error reported cleanly; CORS headers present
  3. Implement: Create `src/mcp/server.ts` — `KadoMcpServer` class with `start(config, adapters)` and `stop()`. Creates Express app, applies CORS + auth middleware, sets up `/mcp` POST/GET/DELETE handlers with `NodeStreamableHTTPServerTransport`. Session map with cleanup on close.
  4. Validate: Unit tests pass; lint clean
  5. Success: Server starts/stops cleanly, handles sessions, releases port `[ref: PRD/Feature 10 — Configurable server exposure]`

- [ ] **T4.5 Plugin Wiring** `[activity: backend-api]`

  1. Prime: Read SDD plugin entry and lifecycle `[ref: SDD/Building Block View — KadoPlugin]` `[ref: SDD/Implementation Gotchas — Express in Obsidian]`
  2. Test: KadoPlugin.onload starts MCP server when enabled; KadoPlugin.onunload stops server; server restarts when config changes (host/port); server not started when disabled in config
  3. Implement: Update `src/main.ts` — KadoPlugin.onload() creates ConfigManager, instantiates adapters, creates KadoMcpServer, calls `start()`. Uses `this.register(() => server.stop())` for cleanup. Listens for config changes to restart server.
  4. Validate: Integration tests pass; lint clean; plugin loads in test vault
  5. Success: Full pipeline works: plugin load → server start → tool call → vault operation → response `[ref: SDD/Acceptance Criteria — Server Lifecycle]`

- [ ] **T4.6 Phase Validation** `[activity: validate]`

  - Run all Phase 4 tests. Verify: auth middleware rejects unauthenticated requests; mappers translate correctly; 3 tools registered; server starts/stops; full request pipeline works end-to-end with mock vault. Lint and typecheck pass. Only `src/mcp/` files import MCP SDK types.
