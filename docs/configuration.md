# Configuration Guide

Settings are in **Settings > MiYo Kado** with three tabs: General, Global Security, and one tab per API key.

For installation, see [Installation](installation.md). For connecting your AI client, see [Client Setup](client-setup.md).

## General Tab

| Setting | Default | Description |
|---------|---------|-------------|
| Server enabled | Off | Start/stop the MCP server |
| Host | `127.0.0.1` | Bind address |
| Port | `23026` | TCP port |
| Connection type | `local` | `local` (127.0.0.1) or `public` (0.0.0.0) |
| Audit logging | On | Enable NDJSON audit log ([format details](how-it-works.md#audit-log)) |
| Log directory | `logs` | Vault-relative path for log files |
| Max log size | 10 MB | Triggers rotation |
| Retained logs | 3 | Number of rotated files to keep |

## Global Security Tab

The global security scope defines what is **eligible** for access across all API keys. No key can exceed these boundaries.

### Access Mode

- **Whitelist** (default): only listed paths are accessible. Nothing else exists to API keys.
- **Blacklist**: everything is accessible except listed paths.

For details on how the mode flip works, see [How It Works -- Whitelist / Blacklist Mode Flip](how-it-works.md#whitelist--blacklist-mode-flip).

### Paths

Add vault folders to the security scope. Each path entry has independent CRUD permissions per data type:

| Data Type | What it controls |
|-----------|-----------------|
| Notes | Reading/writing full markdown content |
| Frontmatter | Reading/writing YAML metadata |
| Dataview | Reading/writing inline fields like `[status:: active]` |
| Files | Reading/writing binary files (images, PDFs, etc.) |

Each data type has four permission flags: **C**reate, **R**ead, **U**pdate, **D**elete.

### Path Patterns

Paths in the security scope use glob-style patterns:

| Pattern | Matches | Example |
|---------|---------|---------|
| `**` | **Full vault** -- every file and folder | Grant an API key access to the entire vault |
| `Calendar` | Everything inside `Calendar/` and its subfolders | Equivalent to `Calendar/**` |
| `Atlas/202*` | Folders/files in `Atlas/` starting with `202` | `Atlas/202 Notes`, `Atlas/2024 Archive` |

The folder picker includes a `** (Full vault)` entry at the top for convenience. You can also type patterns manually in the text input.

**Tip**: When you add a path using the folder picker, just select the folder name (e.g. "Calendar"). The plugin automatically matches all files inside that folder and its subfolders.

### Tags

Tags restrict which tags are visible in search operations (`listTags`, `byTag`). When tags are configured, only matching tags appear in results.

Tag patterns support wildcards: `project/*` matches `project/alpha`, `project/beta`, etc.

## API Key Management

Each API key is an independent access credential with its own scope.

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

For details on how global and key scopes intersect, see [How It Works -- Scope Intersection](how-it-works.md#scope-intersection).

### Regenerating a Key

Click **Regenerate** to replace the secret. The old key is immediately invalidated. Connected clients will need the new value.

### Deleting a Key

Click **Delete API key** in the danger zone. This cannot be undone.

## What's next

- [Example Configurations](example-configs.md) -- common setups with permission matrices
- [How It Works](how-it-works.md) -- architecture, enforcement logic, audit log
- [Client Setup](client-setup.md) -- connect Claude, Cursor, Windsurf
- [API Reference](api-reference.md) -- tool schemas, parameters, error codes
