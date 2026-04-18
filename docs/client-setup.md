# AI Client Setup

How to connect your AI assistant to Kado. Each client needs the Kado server URL and an API key as Bearer token.

**Prerequisites:** Kado is [installed](installation.md) and you have [created an API key](configuration.md#creating-a-key) in the settings.

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

```json
{
  "mcpServers": {
    "kado": {
      "type": "sse",
      "url": "http://127.0.0.1:23026/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

Restart Claude Desktop after editing the config file.

> **Why not the "Add custom connector" UI?** Claude Desktop has a built-in dialog for adding MCP servers (Settings > Custom Connectors), but it only supports OAuth authentication -- there is no field for custom headers like `Authorization: Bearer`. Since Kado uses Bearer tokens, you must use the config file instead. The dialog will not work with Kado.

> **Note:** Older Claude Desktop versions (pre-2025) only supported `stdio` transport. If `"type": "sse"` doesn't work, update your Claude Desktop or use the stdio proxy workaround:
> ```json
> {
>   "mcpServers": {
>     "kado": {
>       "command": "npx",
>       "args": ["-y", "mcp-remote", "http://127.0.0.1:23026/mcp",
>                "--header", "Authorization:Bearer YOUR_API_KEY"]
>     }
>   }
> }
> ```

## Cursor

Config file locations:
- **Global:** `~/.cursor/mcp.json`
- **Per-project:** `.cursor/mcp.json` in the project root

Also configurable via **Settings > Features > MCP** in the UI.

```json
{
  "mcpServers": {
    "kado": {
      "type": "sse",
      "url": "http://127.0.0.1:23026/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

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

- **Transport:** Streamable HTTP (or SSE for older clients)
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
| Claude Desktop | `~/Library/.../claude_desktop_config.json` | `url` | `"sse"` |
| Cursor | `~/.cursor/mcp.json` | `url` | `"sse"` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `serverUrl` | not needed |
