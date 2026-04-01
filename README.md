# Kado -- Obsidian MCP Gateway

Security-first [Model Context Protocol](https://modelcontextprotocol.io/) server plugin for Obsidian. Gives AI assistants controlled, granular access to your vault through three tools: `kado-read`, `kado-write`, and `kado-search`.

## Features

- **Default-deny security** -- nothing is accessible until explicitly whitelisted
- **Two-tier access control** -- global security scope defines what is eligible; per-key scope defines what is permitted
- **Five permission gates** -- authenticate, global-scope, key-scope, datatype-permission, path-access (evaluated in order, first denial stops the chain)
- **Four data types** -- notes (markdown), frontmatter (YAML as JSON), files (binary as base64), Dataview inline fields
- **Six search operations** -- byName, byTag, byContent, byFrontmatter, listDir, listTags
- **Optimistic concurrency** -- timestamp-based conflict detection on writes
- **Rate limiting** -- 200 requests/minute per IP, with `RateLimit-*` response headers
- **Concurrency cap** -- max 10 concurrent MCP requests
- **Audit logging** -- NDJSON log with rotation (metadata only, no content)

## Security Model

Every request passes through a chain of five gates:

| # | Gate | Purpose |
|---|------|---------|
| 0 | `authenticate` | Bearer token must match an enabled API key |
| 1 | `global-scope` | Path must be inside the global whitelist (or outside the global blacklist) |
| 2 | `key-scope` | Path must be inside the key's own whitelist/blacklist |
| 3 | `datatype-permission` | Key must have the required CRUD flag for the data type (note/frontmatter/file/inline-field) |
| 4 | `path-access` | Final path-level permission check against the most specific matching path rule |

Global security and each API key independently configure **whitelist** or **blacklist** mode. In whitelist mode, only listed paths are accessible. In blacklist mode, all paths except listed ones are accessible.

Both global and key scopes can restrict by **tags** (used for search filtering).

## Installation

### From Obsidian Community Plugins (when published)

1. Open **Settings > Community Plugins > Browse**
2. Search for **MiYo Kado**
3. Click **Install**, then **Enable**

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/MMoMM-org/miyo-kado/releases)
2. Create `<vault>/.obsidian/plugins/miyo-kado/`
3. Place the three files inside that folder
4. Restart Obsidian and enable **MiYo Kado** under **Settings > Community Plugins**

## Configuration

Settings are in **Settings > MiYo Kado** with three tabs:

### General Tab

| Setting | Default | Description |
|---------|---------|-------------|
| Server enabled | Off | Start/stop the MCP server |
| Host | `127.0.0.1` | Bind address |
| Port | `23026` | TCP port |
| Connection type | `local` | `local` (127.0.0.1) or `public` (0.0.0.0) |
| Audit logging | On | Enable NDJSON audit log |
| Log directory | `logs` | Vault-relative path for log files |
| Max log size | 10 MB | Triggers rotation |
| Retained logs | 3 | Number of rotated files to keep |

### Global Security Tab

- **List mode**: whitelist (default) or blacklist
- **Paths**: vault folder patterns with per-path CRUD permissions for each data type
- **Tags**: restrict search operations to specific tags

### API Key Tab (one tab per key)

Each API key has:

- **Label** -- human-readable name
- **Enabled** toggle
- **List mode** -- independent whitelist/blacklist, intersected with global scope
- **Paths** -- subset of (or further restriction on) global paths, each with their own data type permissions
- **Tags** -- subset of global tags

## MCP Tool Reference

All tools use the Streamable HTTP transport at `POST /mcp`.

### kado-read

Read content from the vault. Returns content plus `created`, `modified`, and `size` metadata.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `operation` | `"note" \| "frontmatter" \| "file" \| "dataview-inline-field"` | Yes | What to read |
| `path` | string | Yes | Vault-relative path, e.g. `"Calendar/2026-03-31.md"` |

**Response fields**: `path`, `content`, `created`, `modified`, `size`

### kado-write

Write content to the vault. Supports create (omit `expectedModified`) and update (pass `modified` from a prior read).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `operation` | `"note" \| "frontmatter" \| "file" \| "dataview-inline-field"` | Yes | What to write |
| `path` | string | Yes | Vault-relative path |
| `content` | string \| object | Yes | String for note/file, JSON object for frontmatter/inline-field |
| `expectedModified` | number | No | Timestamp from prior read. Omit for new files. |

**Response fields**: `path`, `created`, `modified`

Returns `CONFLICT` if the file was modified between your read and write.

### kado-search

Search the vault. Results are scoped to the calling key's permissions and paginated.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `operation` | `"byName" \| "byTag" \| "byContent" \| "byFrontmatter" \| "listDir" \| "listTags"` | Yes | Search type |
| `query` | string | No | Search query. Supports `*` and `?` globs for byName and byTag. Required for all except listDir and listTags. |
| `path` | string | No | Folder path for listDir, or path prefix for byContent |
| `cursor` | string | No | Pagination cursor from a previous response |
| `limit` | integer | No | Items per page (default 50, max 500) |

**Response fields**: `items[]` (each with `path`, `name`, `created`, `modified`, `size`, optional `tags`/`frontmatter`), `cursor`, `total`

#### Search operations

| Operation | Query example | Description |
|-----------|---------------|-------------|
| `byName` | `"2026-03-*"` | Substring or glob match on file name |
| `byTag` | `"#project/*"` | Exact or glob match on tags |
| `byContent` | `"meeting notes"` | Substring match in note body |
| `byFrontmatter` | `"status=draft"` or `"status"` | Key=value match or key-only existence check |
| `listDir` | -- | List folder contents (use `path` param) |
| `listTags` | -- | All permitted tags with counts |

## Authentication

Requests require a Bearer token in the `Authorization` header:

```
Authorization: Bearer <api-key-id>
```

The token value is the API key's `id` field. Comparison uses constant-time equality to prevent timing attacks.

### Creating API Keys

1. Open **Settings > MiYo Kado**
2. In any tab, use the "Create API Key" action
3. Configure label, paths, tags, and data type permissions
4. Copy the key ID for use in your MCP client config

## Error Codes

All errors are returned as MCP tool results with `isError: true`.

| Code | HTTP-equivalent | When |
|------|----------------|------|
| `UNAUTHORIZED` | 401 | Missing or invalid Bearer token |
| `FORBIDDEN` | 403 | Key lacks permission (gate name included in response) |
| `NOT_FOUND` | 404 | File does not exist at the given path |
| `CONFLICT` | 409 | `expectedModified` does not match current file timestamp |
| `VALIDATION_ERROR` | 400 | Invalid parameters (missing path, bad operation, etc.) |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

Rate limit exceeded returns HTTP 429 with a `Retry-After` header (not an MCP error).

## MCP Client Configuration

Example `.mcp.json` for Claude Code or compatible clients:

```json
{
  "mcpServers": {
    "kado": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:23026/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY_ID"
      }
    }
  }
}
```

## Architecture

Four-layer Dual Anti-Corruption Layer design:

```
MCP Client -> [MCP API Handler] -> [Kado Core] -> [Obsidian Plugin Interface] -> Vault
```

- **MCP API Handler** -- Express + Streamable HTTP transport, auth middleware, rate limiting
- **Kado Core** -- Permission gates, routing, concurrency guard. No MCP or Obsidian imports.
- **Obsidian Interface** -- Vault adapters for notes, frontmatter, files, inline fields, search

See [ADR-001](docs/XDD/adr/) and [Solution Design](docs/XDD/specs/001-kado/solution.md) for details.

## Part of MiYo

Kado is part of the [MiYo ecosystem](https://github.com/miyo). See MiYo Kokoro for cross-component architecture and design decisions.

## Development

```bash
npm ci                # Install dependencies
npm run dev           # Watch mode (hot-reload into test vault)
npm run build         # TypeScript check + esbuild production build
npm test              # Run tests (vitest)
npm run test:watch    # Watch mode tests
npm run test:coverage # Coverage report
npm run lint          # ESLint
```

See [docs/live-testing.md](docs/live-testing.md) for Obsidian vault testing setup.

## Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | Official MCP TypeScript SDK -- Streamable HTTP transport |
| `express` | HTTP server for MCP endpoint |
| `cors` | CORS middleware (restricted to `origin: false` by default) |
| `zod` | Schema validation for MCP tool inputs |
| `obsidian` | Obsidian Plugin API (peer dependency) |

## License

[0-BSD](LICENSE)
