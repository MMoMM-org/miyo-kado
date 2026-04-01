# Development Guide

## Prerequisites

- Node.js 20+
- An Obsidian vault for live testing (see [Live Testing](live-testing.md))

## Commands

```bash
npm ci                # Install dependencies
npm run dev           # Watch mode (hot-reload into test vault)
npm run build         # TypeScript check + esbuild production build
npm test              # Run tests (vitest)
npm run test:watch    # Watch mode tests
npm run test:coverage # Coverage report
npm run lint          # ESLint
```

## Project Structure

```
src/
  core/              # Permission gates, routing, config — no Obsidian/MCP imports
    gates/           # authenticate, global-scope, key-scope, datatype-permission, path-access
    glob-match.ts    # Glob pattern matching for path permissions
    tag-utils.ts     # Tag normalization and wildcard matching
    permission-chain.ts
    concurrency-guard.ts
    config-manager.ts
    audit-logger.ts
    operation-router.ts
  mcp/               # MCP SDK layer — Express server, auth, tool registration
    server.ts        # HTTP server lifecycle, rate limiting, concurrency cap
    auth.ts          # Bearer token middleware (constant-time comparison)
    tools.ts         # kado-read, kado-write, kado-search handlers + scope injection
    request-mapper.ts
    response-mapper.ts
  obsidian/          # Obsidian API adapters — vault I/O
    note-adapter.ts
    frontmatter-adapter.ts
    file-adapter.ts
    inline-field-adapter.ts
    search-adapter.ts
  settings/          # Obsidian settings UI
    SettingsTab.ts
    tabs/            # General, GlobalSecurity, ApiKey tab renderers
    components/      # Reusable UI components (PathEntry, PermissionMatrix, etc.)
  types/
    canonical.ts     # All internal types — the contract between layers
  main.ts            # Plugin entry point, wires everything together
```

## Architecture

Four-layer design with clean boundaries:

```
MCP Client
    |
    v
[MCP API Handler]     Express, StreamableHTTP, auth, rate limiting
    |                  Imports: @modelcontextprotocol/sdk, express
    v
[Kado Core]           Permission gates, routing, concurrency guard
    |                  Imports: NONE from obsidian or MCP SDK
    v
[Obsidian Interface]  Vault adapters for read/write/search
    |                  Imports: obsidian
    v
Vault (filesystem)
```

The core layer has zero dependencies on Obsidian or the MCP SDK. This allows it to be fully unit tested with mocks.

## Testing

Tests mirror the `src/` structure under `test/`:

```
test/
  core/              # Unit tests for gates, routing, config, etc.
  mcp/               # Unit tests for server, auth, tools, mappers
  obsidian/          # Unit tests for vault adapters (mocked Obsidian API)
  integration/       # End-to-end tool call pipeline
  live/              # Tests against running Obsidian (manual, not in CI)
  __mocks__/         # Obsidian API mock
  TEST-MATRIX.md     # Full test inventory with positive/negative coverage
```

See [TEST-MATRIX.md](../test/TEST-MATRIX.md) for the complete test inventory.

### Running Live Tests

Live tests connect to a real Obsidian instance. See [Live Testing](live-testing.md) for setup.

### Hot-Reload Caveat

Copying a new `main.js` while Obsidian is running triggers a hot-reload, but the settings tab UI and MCP server state may retain old code. Always use **disable > enable** after deploying a new build.

## Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP TypeScript SDK -- Streamable HTTP transport |
| `express` | HTTP server for MCP endpoint |
| `cors` | CORS middleware (restricted to `origin: false`) |
| `zod` | Schema validation for MCP tool inputs |
| `obsidian` | Obsidian Plugin API (peer dependency) |

## Code Conventions

- Strict TypeScript (`"strict": true`) -- no `any`, use `unknown` + narrowing
- Import order: node builtins > external > internal
- Each file has a header comment explaining why it exists
- Public functions have JSDoc with `@param` / `@returns` / `@throws`
- TDD: write failing test first, then minimal implementation
