# ADR-001: Dual Anti‑Corruption Layer Architecture

*Status:* Accepted (supersedes original ADR-00X: Payload-based Versioning)
*Date:* 2026-03-30
*Original ADR:* 2026-03-09

## Context and Problem Statement

Kado is an MCP server that runs as an Obsidian plugin. It sits between two external APIs:

- **Outward-facing:** The MCP protocol (Model Context Protocol), whose SDK and specification continue to evolve.
- **Inward-facing:** The Obsidian Plugin API, whose vault access methods may change with Obsidian updates.

Kado's core (authorization logic, routing, concurrency) should remain isolated from changes on either side. When MCP changes, only the MCP Handler should need updating. When Obsidian changes, only the Obsidian Interface should need updating. The Core remains stable.

### Changes from the Original ADR

The original ADR (2026-03-09) envisioned a **payload-based versioning** approach where MCP clients send a `version` field in the JSON and the server uses version adapters to serve different request/response formats.

This decision has been **revised** because:

1. **MCP clients operate dynamically.** Claude, Cursor, and other MCP clients discover tools via `tools/list` and adapt to the current schema. No client expects a fixed "v1" schema.
2. **Version adapters introduce unnecessary complexity.** Instead of maintaining separate mapping logic per client version, a single current schema that works with MCP's tool discovery mechanism is sufficient.
3. **The ACL pattern remains valuable** — not for client versioning, but for decoupling the MCP protocol and Obsidian API from the Core.

---

## Decision

### Four-Layer Architecture with Dual ACL

```
MCP Client (Claude, Cursor, Tomo, ...)
    ↕
[MCP API Handler]              ← Outward-facing ACL
    ↕
[Kado Core]                    ← Pure business logic
    ↕
[Obsidian Plugin Interface]    ← Inward-facing ACL
    ↕
Obsidian Vault API
```

### 1. MCP API Handler (Outer ACL)

- Translates MCP requests into canonical Core requests.
- Translates Core responses back into MCP responses.
- Registers the three "Fat Tools" (`kado-read`, `kado-write`, `kado-search`) with the MCP server.
- Encapsulates all MCP SDK dependencies. The Core does not import anything from `@modelcontextprotocol/sdk`.

### 2. Kado Core

- Works exclusively with canonical internal types.
- Contains: authorization logic (fail-fast gates), routing by data type/operation, optimistic concurrency (timestamp validation), audit logging.
- Has no knowledge of MCP or Obsidian.

### 3. Obsidian Plugin Interface (Inner ACL)

- Translates canonical Core requests into Obsidian API calls (Vault API, MetadataCache, etc.).
- Translates Obsidian responses back into canonical Core responses.
- When Obsidian does not provide a needed function, custom code is added here — not in the Core.
- Encapsulates all Obsidian API dependencies. The Core does not import anything from `obsidian`.

### 4. Canonical Internal Model

A canonical model is used between the layers. Example:

```ts
interface CoreReadRequest {
  apiKeyId: string;
  operation: 'note' | 'frontmatter' | 'file' | 'dataview-inline-field';
  path: string;
}

interface CoreWriteRequest {
  apiKeyId: string;
  operation: 'note' | 'frontmatter' | 'file' | 'dataview-inline-field';
  path: string;
  content: unknown;
  expectedModified?: number;  // Timestamp für Optimistic Concurrency
}

interface CoreFileResult {
  path: string;
  content: unknown;
  created: number;
  modified: number;
}
```

---

## What Has Been Removed

| Concept from the Old ADR | Status | Rationale |
|---------------------------|--------|------------|
| `version` field in the JSON payload | **Removed** | MCP clients operate dynamically; no client needs fixed versions |
| VersionAdapter class | **Removed** | Without versioning, no adapters are needed |
| External API Adapter (ExternalFileApiAdapter) | **Renamed** → Obsidian Plugin Interface | Same idea, clearer name in the context of an Obsidian plugin |
| Canonical internal model | **Retained** | Continues to be the central abstraction between layers |
| Anti‑Corruption Layer | **Extended** to both sides | ACL not only toward the external API, but also toward the MCP protocol |

---

## Options Considered

### 1. Monolithic Plugin without Layer Separation
- All MCP, Core, and Obsidian logic in the same modules.
- Faster to start, but any change to MCP or Obsidian requires changes across the codebase.
- **Rejected**: Kado must withstand changes to two evolving APIs over the long term.

### 2. Payload Versioning with Version Adapters (Old ADR)
- Client sends `version` in JSON, server maintains separate adapters per version.
- **Rejected**: MCP clients do not need fixed versions; the complexity outweighs the benefit.

### 3. Dual ACL with Canonical Model (Chosen)
- Clear separation into four layers: MCP Handler → Core → Obsidian Interface.
- Canonical model as the bridge. No versioning.
- **Chosen**: Minimal complexity with maximum decoupling.

---

## Consequences

### Positive

- **Isolated changes**: An MCP SDK update only affects the MCP Handler. An Obsidian API change only affects the Obsidian Interface.
- **Testability**: The Core can be tested without an MCP server and without Obsidian.
- **Future-proofing**: If another protocol or another host needs to be supported, the outer layers can be replaced.
- **Less complexity**: No version adapters, no multiple schemas.

### Negative / Risks

- **Indirection**: Every request passes through two mapping steps (MCP → Core → Obsidian). For simple operations, this can feel like overhead.
- **Canonical model must stay current**: When new Obsidian features need to be utilized, the canonical model must be extended.
- **Initial effort**: The layer separation requires more boilerplate at the start than a monolithic approach.

---

## References

- [Anti-Corruption Layer Pattern — Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer)
- [Anti-Corruption Layer Pattern — AWS Prescriptive Guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/acl.html)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [AIRIS MCP Gateway](https://github.com/agiletec-inc/airis-mcp-gateway) — Reference for the "Fat Tools" pattern with few tool names and JSON-based routing
