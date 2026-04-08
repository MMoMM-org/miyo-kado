<p align="center">
  <img src="assets/MiYo-Kado.png" alt="MiYo Kado logo" width="160" />
</p>

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

Global security and each API key independently configure **whitelist** or **blacklist** mode. Both scopes can use **tags** for search operations.

## Architecture

```
MCP Client -> [MCP API Handler] -> [Kado Core] -> [Obsidian Interface] -> Vault
```

- **MCP API Handler** -- Express + Streamable HTTP transport, auth, rate limiting
- **Kado Core** -- Permission gates, routing, concurrency guard. No MCP or Obsidian imports.
- **Obsidian Interface** -- Vault adapters for notes, frontmatter, files, inline fields, search

## Part of MiYo

Kado is part of the MiYo ecosystem...

more to come soon(TM)

## Future Roadmap

### Permission Rework for Tags

At the moment you can search by Tags. Therefore the only option you have as a permission is R = Read. You either allow or deny.
In the furture this will change to:

- Read (R) => Search (S)
- Deny (D) = Deny access to data types which have the tag

The Deny Permission will probably not change the behaviour with the white-/blacklist toggle, but I will need to take a look at the scenarios first.

### Granular Whitelist / Blacklist Toggle

At the moment you can toggle the behaviour of the permissions between whitelist (default) and blacklist. This is for all datatypes AND the tags.
In the future I might allow a more granular white-/blacklisting.

### Choosing Subpathes for Key Permissions

At the moment you can only choose pathes which are eligible from the Global Security Tab, e.g. /Atlas. This means you can't easily change permissions for /Atlas/People
Workaround for the time being is to also make /Atlas/People eligble from the Global Security Tab.

## Contributing

Contributions are welcome. The short version:

1. **Open an issue first** for anything non-trivial (bugs, features, refactors) so we can align on scope before you invest time.
2. **Fork & branch** from `master`. Use a descriptive branch name (e.g. `fix/search-tag-case`, `feat/granular-scopes`).
3. **Keep changes focused** -- one feature or one fix per PR. See [Development Guide](docs/development.md) for build, test, and lint commands.
4. **Tests & lint must pass** -- run `npm run build`, `npm test`, and `npm run lint` before pushing.
5. **Conventional commits** -- e.g. `feat:`, `fix:`, `docs:`, `refactor:`. Release notes are generated from commit history.
6. **Open a PR** against `master` and reference the issue. Small, reviewable diffs get merged fastest.

For security issues, please **do not** open a public issue -- email marcus@mmomm.org instead.

## License

[MIT](LICENSE)
