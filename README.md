# Kado -- Obsidian MCP Gateway

Security-first [Model Context Protocol](https://modelcontextprotocol.io/) server plugin for Obsidian. Gives AI assistants controlled, granular access to your vault through three tools: `kado-read`, `kado-write`, and `kado-search`.

## Features

- **Default-deny security** -- nothing is accessible until explicitly whitelisted
- **Two-tier access control** -- global security scope defines what is eligible; per-key scope defines what is permitted
- **Five permission gates** -- authenticate, global-scope, key-scope, datatype-permission, path-access
- **Four data types** -- notes (markdown), frontmatter (YAML as JSON), files (binary as base64), Dataview inline fields
- **Six search operations** -- byName, byTag, byContent, byFrontmatter, listDir, listTags
- **Optimistic concurrency** -- timestamp-based conflict detection on writes
- **Rate limiting** -- 200 requests/minute per IP
- **Audit logging** -- NDJSON log with rotation (metadata only, no content)

## Quick Start

1. Install the plugin (see [Installation](docs/configuration.md#installation))
2. Open **Settings > MiYo Kado**
3. Add paths to the global security whitelist
4. Create an API key and assign it paths/permissions
5. Enable the server
6. Connect your MCP client using the key

```json
{
  "mcpServers": {
    "kado": {
      "type": "http",
      "url": "http://127.0.0.1:23026/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY_ID"
      }
    }
  }
}
```

## Documentation

| Document | Audience | Content |
|----------|----------|---------|
| [Configuration Guide](docs/configuration.md) | Vault owners | Installation, settings UI, security setup, API key management |
| [API Reference](docs/api-reference.md) | MCP client developers | Tool schemas, parameters, examples, error codes, auth |
| [Development Guide](docs/development.md) | Contributors | Build, test, lint, architecture, live testing |

## Security Model

Every request passes through five gates in order. The first denial stops the chain.

| # | Gate | Purpose |
|---|------|---------|
| 0 | authenticate | Bearer token must match an enabled API key |
| 1 | global-scope | Path must be inside the global whitelist (or outside the blacklist) |
| 2 | key-scope | Path must be inside the key's own scope |
| 3 | datatype-permission | Key must have the required CRUD flag for the data type |
| 4 | path-access | Final path-traversal and validation check |

Global security and each API key independently configure **whitelist** or **blacklist** mode. Both scopes can restrict by **tags** for search operations.

## Architecture

```
MCP Client -> [MCP API Handler] -> [Kado Core] -> [Obsidian Interface] -> Vault
```

- **MCP API Handler** -- Express + Streamable HTTP transport, auth, rate limiting
- **Kado Core** -- Permission gates, routing, concurrency guard. No MCP or Obsidian imports.
- **Obsidian Interface** -- Vault adapters for notes, frontmatter, files, inline fields, search

## Part of MiYo

Kado is part of the [MiYo ecosystem](https://github.com/miyo). See MiYo Kokoro for cross-component architecture.

## License

[0-BSD](LICENSE)
