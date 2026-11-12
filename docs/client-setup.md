# AI Client Setup

How to connect your AI assistant to Kado. Each client needs the Kado server URL and an API key as Bearer token.

**Prerequisites:** Kado is [installed](installation.md) and you have [created an API key](configuration.md#creating-a-key) in the settings.

**Good to know:**
- Kado runs inside Obsidian. The server is only reachable while Obsidian is running with the vault open -- if Obsidian is closed, the client reports a connection error.
- Kado never exposes hidden files or folders (any path segment starting with `.`, e.g. `.obsidian/`, `.claude/`, `.agents/`). Content a client should read must live in a regular vault folder.

## Claude Code

Config file: `.mcp.json` in your project root (or `~/.claude/mcp.json` for global)

```json
{
  "mcpServers": {
    "kado": {
      "type": "http",
      "url": "http://127.0.0.1:23026/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

Claude Code picks up changes automatically on the next session.

## Claude Desktop

Config file locations:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

`claude_desktop_config.json` only launches local **stdio** servers (`command` + `args`); it has no `url`/`headers` form. Connect Kado through the [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge, which Claude Desktop starts as a stdio server and which forwards to Kado's Streamable HTTP endpoint (requires Node.js for `npx`):

```json
{
  "mcpServers": {
    "kado": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:23026/mcp",
               "--header", "Authorization:Bearer YOUR_API_KEY"]
    }
  }
}
```

Restart Claude Desktop after editing the config file.

> **Why not the "Add custom connector" UI?** Claude Desktop's built-in dialog for remote MCP servers (Settings > Connectors) only supports OAuth -- there is no field for custom headers like `Authorization: Bearer`. Since Kado uses Bearer tokens, the dialog will not work with Kado; use the config file above.

## Cursor

Config file locations:
- **Global:** `~/.cursor/mcp.json`
- **Per-project:** `.cursor/mcp.json` in the project root

Also manageable from the **Customize** page in the Cursor sidebar.

```json
{
  "mcpServers": {
    "kado": {
      "url": "http://127.0.0.1:23026/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

> **Note:** Cursor needs no `type` field for remote servers; a `url` entry connects to Kado's Streamable HTTP endpoint.

## Windsurf

Config file locations:
- **macOS:** `~/.codeium/windsurf/mcp_config.json`
- **Windows:** `%USERPROFILE%\.codeium\windsurf\mcp_config.json`
- **Linux:** `~/.codeium/windsurf/mcp_config.json`

Also configurable via **Settings > Cascade > MCP** in the UI.

```json
{
  "mcpServers": {
    "kado": {
      "serverUrl": "http://127.0.0.1:23026/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

> **Note:** Windsurf uses `serverUrl` instead of `url` and does not require a `type` field.

## Other MCP Clients

Any MCP-compatible client can connect to Kado. The generic pattern:

- **Transport:** Streamable HTTP (the legacy SSE transport is not supported -- SSE-only clients need the `mcp-remote` bridge below)
- **Endpoint:** `http://127.0.0.1:23026/mcp`
- **Auth:** HTTP header `Authorization: Bearer YOUR_API_KEY`

If your client only supports `stdio` transport, use the [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge:

```bash
npx -y mcp-remote http://127.0.0.1:23026/mcp --header "Authorization:Bearer YOUR_API_KEY"
```

## Multiple keys

You can register Kado multiple times with different API keys for different permission levels:

```json
{
  "mcpServers": {
    "vault-full": {
      "type": "http",
      "url": "http://127.0.0.1:23026/mcp",
      "headers": { "Authorization": "Bearer kado_full-access-key" }
    },
    "vault-readonly": {
      "type": "http",
      "url": "http://127.0.0.1:23026/mcp",
      "headers": { "Authorization": "Bearer kado_readonly-key" }
    }
  }
}
```

## Quick reference

| Client | Config file (macOS) | URL field | Type field |
|--------|-------------------|-----------|------------|
| Claude Code | `.mcp.json` | `url` | `"http"` |
| Claude Desktop | `~/Library/.../claude_desktop_config.json` | none (stdio via `mcp-remote`) | none (`command` + `args`) |
| Cursor | `~/.cursor/mcp.json` | `url` | not needed |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `serverUrl` | not needed |
