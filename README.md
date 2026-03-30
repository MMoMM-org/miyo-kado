# Kado — Obsidian MCP Gateway

Security-first MCP server plugin for Obsidian. Gives AI assistants controlled, granular access to your vault.

## Features

- **Default-Deny**: Nothing is accessible until explicitly whitelisted
- **Two-Tier Access Control**: Global areas define what's eligible; API keys define what's permitted
- **Per-Key Permissions**: Separate CRUD rights for Notes, Frontmatter, Dataview Inline Fields, and Files
- **3 MCP Tools**: `kado-read`, `kado-write`, `kado-search` with JSON sub-operations
- **Optimistic Concurrency**: Timestamp-based conflict detection on writes
- **Audit Logging**: NDJSON access log with rotation (metadata only, no content)

## Architecture

Kado uses a four-layer Dual Anti-Corruption Layer architecture:

```
MCP Client → [MCP API Handler] → [Kado Core] → [Obsidian Plugin Interface] → Vault
```

- **MCP API Handler**: Express + Streamable HTTP transport
- **Kado Core**: Permission gates, routing, concurrency — no MCP or Obsidian imports
- **Obsidian Interface**: Vault adapters for notes, frontmatter, files, inline fields, search

See [ADR-001](docs/XDD/adr/) and [Solution Design](docs/XDD/specs/001-kado/solution.md) for details.

## Part of MiYo

Kado is part of the [MiYo ecosystem](https://github.com/miyo). See MiYo Kokoro for cross-component architecture and design decisions.

## Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | Official MCP TypeScript SDK — Streamable HTTP transport |
| `express` | HTTP server for MCP endpoint |
| `cors` | CORS middleware (restricted to `origin: false` by default) |
| `zod` | Schema validation for MCP tool inputs |
| `obsidian` | Obsidian Plugin API |

## Development

```bash
npm ci              # Install dependencies
npm run dev         # Watch mode (hot-reload ready)
npm test            # Run tests (vitest)
npm run build       # Production build
npm run lint        # ESLint
```

## License

[0-BSD](LICENSE)
