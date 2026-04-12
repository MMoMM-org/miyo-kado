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

### Audit Log Format

Kado writes one JSON object per line (NDJSON) to `<log-directory>/kado-audit.log`. Every request gets one entry — allowed or denied. **Content is never logged**: only metadata (who, what, where, decision).

Example lines:

```json
{"timestamp":"2026-03-31T14:29:06.365+02:00","apiKeyId":"kado_9e1d…","operation":"read","dataType":"note","path":"Projects/doc.md","decision":"allowed"}
{"timestamp":"2026-03-31T14:29:07.100+02:00","apiKeyId":"kado_9e1d…","operation":"update","dataType":"frontmatter","path":"Projects/doc.md","decision":"denied","gate":"datatype-permission"}
{"timestamp":"2026-03-31T14:29:08.412+02:00","apiKeyId":"kado_9e1d…","operation":"search","dataType":"note","path":"byTag:#project/alpha","decision":"allowed"}
{"timestamp":"2026-03-31T14:29:09.001+02:00","apiKeyId":"kado_bad…","operation":"read","dataType":"note","path":"secret/keys.md","decision":"denied","gate":"global-scope"}
```

| Field | Description |
|-------|-------------|
| `timestamp` | ISO 8601 with local timezone offset |
| `apiKeyId` | Truncated key ID of the caller |
| `operation` | `read` / `create` / `update` / `delete` / `search` |
| `dataType` | `note` / `frontmatter` / `dataview-inline-field` / `file` |
| `path` | Vault-relative path (or search query descriptor for search ops) |
| `decision` | `allowed` or `denied` |
| `gate` | On denial only: which permission gate rejected (`authenticate`, `global-scope`, `key-scope`, `datatype-permission`, `path-access`) |

When the log reaches **Max log size**, the file is rotated (`kado-audit.log.1`, `.2`, ...) and older rotations beyond **Retained logs** are deleted.

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

### Path Patterns

Paths in the security scope use glob-style patterns:

| Pattern | Matches | Example |
|---------|---------|---------|
| `**` | **Full vault** — every file and folder | Grant an API key access to the entire vault |
| `Calendar` | Everything inside `Calendar/` and its subfolders | Equivalent to `Calendar/**` |
| `Atlas/202*` | Folders/files in `Atlas/` starting with `202` | `Atlas/202 Notes`, `Atlas/2024 Archive` |

The folder picker includes a `** (Full vault)` entry at the top for convenience. You can also type patterns manually in the text input.

**Note:** The `/` character is not a valid path pattern (Obsidian uses relative paths). To grant access to the entire vault, use `**`. If you have an older configuration with `/` as a path, Kado automatically upgrades it to `**` on load.

**Tip**: When you add a path using the folder picker, just select the folder name (e.g. "Calendar"). The plugin automatically matches all files inside that folder and its subfolders.

### Example: Global Security Tab

A typical configuration with two paths — `allowed/**` has nearly full access, `maybe-allowed/**` is read-only across all data types:

**Access Mode:** `Whitelist` · *Only listed paths and tags are accessible. Everything else is blocked.*

**Paths:**

```
allowed/**             C   R   U   D
  Note                 ✓   ✓   ✓   ✓
  Frontmatter (FM)     ✓   ✓   ✓   ·
  Dataview (DV)        ✓   ✓   ·   ·
  File                 ✓   ✓   ✓   ✓

maybe-allowed/**       C   R   U   D
  Note                 ·   ✓   ·   ·
  Frontmatter (FM)     ·   ✓   ·   ·
  Dataview (DV)        ·   ✓   ·   ·
  File                 ·   ✓   ·   ·
```

Legend: `✓` = permission granted · `·` = permission not granted

**Tags:**

```
#project/alpha    [R]
#status/*         [R]
```

Tags are read-only filters (the `[R]` badge). They restrict which tags are visible in `listTags` and searchable via `byTag`. A pattern like `#status/*` matches `#status/active`, `#status/done`, etc.

### Whitelist ↔ Blacklist: Mode Flip Behavior

Flipping the Access Mode toggle **does not change any permission values**. It only changes how the same config is *interpreted*. This means you can flip the toggle without losing your configuration.

Same config, two interpretations:

| Config value | Whitelist mode | Blacklist mode |
|--------------|----------------|----------------|
| `true` | ✓ — permission is **granted** | empty — permission is **not blocked** |
| `false` | empty — permission is **not granted** | ✕ — permission is **blocked** |
| disabled | greyed (unavailable) | greyed (unavailable) |

**Example** — a path with `Note: C=true, R=true, U=false, D=disabled`:

- **In Whitelist mode**: user can `Create` and `Read` notes. Cannot `Update` (not selected). `Delete` unavailable.
- **In Blacklist mode** (same booleans): `Create` and `Read` are *not blocked* = allowed. `Update` is *explicitly blocked* (✕). `Delete` still unavailable.

**Effective permissions are identical** — the mental model differs. Whitelist is "list what's allowed"; blacklist is "list what's forbidden". Pick whichever reads more naturally for your setup.

### Tags

Tags restrict which tags are visible in search operations (`listTags`, `byTag`). When tags are configured, only matching tags appear in results.

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

### Example: API Key Tab

An API key can only select **from paths that Global Security already allows**. Permissions that are disabled globally appear **greyed out** and cannot be enabled on the key.

**Access Mode:** `Whitelist` (independent of global — each key has its own)

**Paths** — *Only paths defined in Global Security are available. Permissions greyed out = not granted globally.*

Building on the global example above, a restricted key might look like this:

```
allowed/**             C   R   U   D
  Note                 ✓   ✓   ·   ·      ← key selects C,R — global has all 4
  Frontmatter (FM)     ✓   ✓   ·   ░      ← D is greyed (disabled globally)
  Dataview (DV)        ·   ·   ░   ░      ← U,D greyed
  File                 ·   ✓   ·   ·      ← key selects R only

maybe-allowed/**       C   R   U   D
  Note                 ░   ✓   ░   ░      ← only R available globally
  Frontmatter (FM)     ░   ✓   ░   ░
  Dataview (DV)        ░   ✓   ░   ░
  File                 ░   ✓   ░   ░
```

Legend: `✓` = selected · `·` = not selected (still clickable) · `░` = greyed (disabled globally, cannot be enabled)

**Tags:**

```
#project/alpha    [R]
```

The tag picker only offers tags from Global Security. A key can take a subset of the global tag list.

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

### Edge Case: Global Security Changed After Key Config

If you grant a key a permission (e.g. `Note: Update` on `allowed/**`), and later **remove** that permission from Global Security, the key config on disk still contains `update: true`. What happens?

1. **The key's stored config is not rewritten.** Each scope (global and per-key) stores only its own values — cross-referencing happens at render time, not save time.
2. **The UI shows a greyed-out ✓** on the stale permission so you can see "this was granted but is no longer available globally". The cell is not clickable.
3. **At runtime, the enforcement engine denies the request.** Global wins — `key.update=true ∧ global.update=false` → denied at the `datatype-permission` gate.
4. **If you re-enable the permission globally**, the key's previous selection becomes active again automatically (because the value was preserved on disk).

This means you can safely tighten Global Security without touching individual keys — the restrictions propagate immediately at runtime, and loosening global later restores previous key grants.

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

## Enforcement Logic

Kado's guiding principle: **Global defines the ceiling. Keys define the subset.** Every request is evaluated against *both* layers and both must agree. A key can never exceed what global permits — it can only further restrict.

Because global and keys each have an independent `Whitelist` / `Blacklist` toggle, there are four possible combinations. Understanding them helps you reason about why a specific request is allowed or denied.

### The Two-Layer Check

For every incoming MCP request, Kado does this in order:

1. **Authenticate the caller.** The Bearer token must match an enabled API key. If not → denied at gate `authenticate`.
2. **Resolve the global scope for the request path.** The global list mode decides how to interpret the paths list:
   - *Whitelist mode:* find a path entry that matches the request path. If no match → denied at gate `global-scope`. If matched, the entry's permissions become the **global ceiling** for this request.
   - *Blacklist mode:* find a path entry that matches. If no match → the request path is *not listed as forbidden*, so the global ceiling is **full access**. If matched, the entry's permissions are **inverted** and applied as blocks — a `true` value means "this operation is blocked", a `false` value means "not blocked".
3. **Check the global ceiling for the requested data type and operation.** For example, a request to update frontmatter at `allowed/doc.md` checks `global.allowed[FM].update`. If the ceiling says `false` → denied at gate `datatype-permission` (sub-reason: global).
4. **Resolve the key scope for the same path**, using the key's *own* list mode (independent of global). Same rules as step 2, but applied to the key's path list. If the path isn't in the key's scope → denied at gate `key-scope`.
5. **Check the key's permission for the data type and operation.** Same as step 3, but against the key. If the key says `false` → denied at gate `datatype-permission` (sub-reason: key).
6. **Final path-access validation** (traversal, symlink checks, canonicalization) at gate `path-access`.

Only if all gates pass is the request allowed. The result is effectively `global_permission AND key_permission` for every operation — an intersection.

### The Four List-Mode Combinations

**Combo 1 — Global=Whitelist, Key=Whitelist** (most common)

- *Global says:* "Only `allowed/**` with Note:CRUD is accessible."
- *Key says:* "Only `allowed/**` with Note:CR is accessible for this key."
- *Result:* The key can `Create` and `Read` notes in `allowed/**`. Straightforward intersection — whatever is in both lists is allowed.

**Combo 2 — Global=Whitelist, Key=Blacklist**

- *Global says:* "Only `allowed/**` with Note:CRUD is accessible."
- *Key says:* "Within what global allows, block Note:Update on `allowed/**`."
- *Enforcement:* Global whitelist resolves first → only `allowed/**` Note:CRUD is in scope at all. Then the key's blacklist removes `Update` from that scope.
- *Result:* The key can `Create`, `Read`, `Delete` notes in `allowed/**`. `Update` is blocked by the key.

**Combo 3 — Global=Blacklist, Key=Whitelist**

- *Global says:* "Everything is accessible except `secret/**`."
- *Key says:* "Only `allowed/**` with Note:CR is accessible for this key."
- *Enforcement:* Global blacklist resolves first → every path except `secret/**` is eligible. The key's whitelist then narrows that to just `allowed/**` Note:CR.
- *Result:* The key can `Create` and `Read` notes in `allowed/**`. Everything else is denied either by the global blacklist (`secret/**`) or because the key's whitelist doesn't list it.

**Combo 4 — Global=Blacklist, Key=Blacklist**

- *Global says:* "Everything is accessible except `secret/**`."
- *Key says:* "Within what global allows, block Note:Delete on `drafts/**`."
- *Enforcement:* Global blacklist removes `secret/**` entirely. The key's blacklist then additionally removes `Delete` from `drafts/**`.
- *Result:* The key can access everything except `secret/**` (global block) and cannot delete notes in `drafts/**` (key block). Everything else is allowed.

### Key Properties to Remember

- **Global is the ceiling.** A key can never grant itself more than global allows. If you tighten global, every key's effective permissions tighten immediately — no per-key edits needed.
- **The list mode is only a rendering/interpretation choice**, not a stored permission. Flipping the toggle never changes the underlying `true`/`false` values — see *Whitelist ↔ Blacklist: Mode Flip Behavior* above.
- **Both layers are always checked**, regardless of their individual modes. There is no short-circuit where "blacklist means trust everything else" — the key layer still runs on top.
- **Denials include the gate name in the audit log** (`authenticate`, `global-scope`, `key-scope`, `datatype-permission`, `path-access`). This makes it easy to pinpoint *why* a request was rejected when debugging.
- **Default-deny stays default-deny.** If any layer has no matching path in whitelist mode, the request is denied. There is no fallback to "probably fine".
