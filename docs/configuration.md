# Configuration Guide

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

## Settings Overview

Settings are in **Settings > MiYo Kado** with three tabs: General, Global Security, and one tab per API key.

<!-- TODO: Add screenshot of the settings tabs -->

## General Tab

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

## Global Security Tab

The global security scope defines what is **eligible** for access across all API keys. No key can exceed these boundaries.

<!-- TODO: Add screenshot of global security tab -->

### Access Mode

- **Whitelist** (default): only listed paths are accessible. Nothing else exists to API keys.
- **Blacklist**: everything is accessible except listed paths.

### Paths

Add vault folders to the security scope. Each path entry has independent CRUD permissions per data type:

| Data Type | What it controls |
|-----------|-----------------|
| Notes | Reading/writing full markdown content |
| Frontmatter | Reading/writing YAML metadata |
| Dataview | Reading/writing inline fields like `[status:: active]` |
| Files | Reading/writing binary files (images, PDFs, etc.) |

Each data type has four permission flags: **C**reate, **R**ead, **U**pdate, **D**elete.

<!-- TODO: Add screenshot of permission matrix -->

**Tip**: When you add a path using the folder picker, just select the folder name (e.g. "Calendar"). The plugin automatically matches all files inside that folder and its subfolders.

### Tags

Tags restrict which tags are visible in search operations (`listTags`, `byTag`). When tags are configured, only matching tags appear in results. Leave empty for unrestricted tag access.

Tag patterns support wildcards: `project/*` matches `project/alpha`, `project/beta`, etc.

## API Key Management

Each API key is an independent access credential with its own scope.

<!-- TODO: Add screenshot of API key tab -->

### Creating a Key

1. Open **Settings > MiYo Kado**
2. Click **Create API Key** in the General tab
3. Set a descriptive label
4. Configure paths and permissions (subset of global security)
5. Copy the key ID -- this is the Bearer token for MCP clients

### Key Permissions

Each key has:

- **Access mode** -- independent whitelist/blacklist, intersected with global scope
- **Paths** -- picked from global paths, each with their own CRUD permissions per data type
- **Tags** -- subset of global tags, controls which tags the key can search by

### How Scopes Intersect

A request must pass **both** the global scope and the key scope. The effective permission is the intersection:

```
Global: Calendar (Read only)
Key:    Calendar (Read + Write)
Result: Calendar (Read only)  -- global wins
```

```
Global: Calendar, Atlas, 100 Inbox
Key:    Calendar only
Result: Calendar only  -- key restricts further
```

### Regenerating a Key

Click **Regenerate** to replace the secret. The old key is immediately invalidated. Connected clients will need the new value.

### Deleting a Key

Click **Delete API key** in the danger zone. This cannot be undone.

## MCP Client Configuration

Add this to your `.mcp.json` (Claude Code, Cursor, or compatible clients):

```json
{
  "mcpServers": {
    "my-vault": {
      "type": "http",
      "url": "http://127.0.0.1:23026/mcp",
      "headers": {
        "Authorization": "Bearer kado_your-api-key-id-here"
      }
    }
  }
}
```

### Multiple Keys

You can create multiple keys with different permission levels:

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

## Typical Setup

### Researcher with AI assistant

Goal: Let the AI read your notes and create new ones in an inbox.

1. **Global security**: whitelist mode, add `Notes` (read-only) and `AI Inbox` (full CRUD)
2. **API key**: same paths, notes = read only, AI Inbox = create + read + update
3. **Tags**: add `project/*` so the AI can search by project tags

### Shared vault with multiple agents

Goal: Different AI agents have different access levels.

1. **Global security**: whitelist all shared folders
2. **Key "Research Agent"**: read-only access to everything
3. **Key "Writing Agent"**: read + write to `Drafts`, read-only to `Sources`
4. **Key "Admin Agent"**: full CRUD on all paths
