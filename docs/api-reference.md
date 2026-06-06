# Kado API Reference

Kado exposes an MCP (Model Context Protocol) server over Streamable HTTP transport. Clients send JSON-RPC requests to a single endpoint and authenticate with Bearer tokens. Five tools are available: `kado-read`, `kado-write`, `kado-delete`, `kado-search`, and `kado-open-notes`.

---

## Transport

| Property | Value |
|---|---|
| Protocol | MCP over Streamable HTTP |
| Endpoint | `POST /mcp` (tool calls), `GET /mcp` (server-sent events) |
| Content-Type | `application/json` |
| Body limit | 1 MB |
| Session mode | Stateless (no session IDs) |
| CORS | Disabled (`origin: false`) |
| DELETE /mcp | Returns `405` — session termination not supported |

---

## Authentication

Every request must include a Bearer token in the `Authorization` header. Tokens are UUIDs prefixed with `kado_`.

```
Authorization: Bearer kado_a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

The token must match an enabled API key in the plugin configuration. Validation uses constant-time comparison to prevent timing attacks.

**Failure response** (HTTP 401):

```json
{"error": "Missing or invalid authorization"}
```

---

## Rate Limiting

Per-IP, sliding-window rate limiting. Every response includes rate-limit headers.

| Header | Description |
|---|---|
| `RateLimit-Limit` | Max requests per window (200) |
| `RateLimit-Remaining` | Requests remaining in current window |
| `RateLimit-Reset` | Seconds until the window resets |
| `Retry-After` | Seconds to wait (only on 429) |

**Limits:** 200 requests per 60-second window per IP address.

**Exceeded response** (HTTP 429):

```json
{"error": "Too many requests"}
```

---

## Concurrency

Maximum 10 concurrent requests are processed at any time. When the limit is reached, the server responds immediately.

**Exceeded response** (HTTP 503):

```json
{"error": "Server busy"}
```

---

## Tool: kado-read

Read content from the Obsidian vault. Returns content along with file metadata. Use the `modified` timestamp from the response as `expectedModified` when writing updates.

### Operations

| Operation | Returns |
|---|---|
| `note` | Full markdown content as string |
| `frontmatter` | YAML metadata parsed as JSON object |
| `file` | Binary file content as base64 string |
| `dataview-inline-field` | Dataview inline fields as JSON object |

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `operation` | `"note" \| "frontmatter" \| "file" \| "dataview-inline-field"` | Yes | What to read |
| `path` | `string` | Yes | Vault-relative path, e.g. `"Calendar/2026-03-31.md"` |

### Response Format

All read responses return a JSON object with:

| Field | Type | Description |
|---|---|---|
| `path` | `string` | Vault-relative path of the file |
| `content` | `string \| object` | File content (format depends on operation) |
| `created` | `number` | File creation timestamp (Unix ms) |
| `modified` | `number` | File modification timestamp (Unix ms) |
| `size` | `number` | File size in bytes |

### Examples

**Read a note:**

```json
// Request
{
  "method": "tools/call",
  "params": {
    "name": "kado-read",
    "arguments": {
      "operation": "note",
      "path": "Calendar/2026-03-31.md"
    }
  }
}

// Response content
{
  "path": "Calendar/2026-03-31.md",
  "content": "# March 31, 2026\n\nToday's notes...",
  "created": 1743379200000,
  "modified": 1743379500000,
  "size": 142
}
```

**Read frontmatter:**

```json
// Request arguments
{
  "operation": "frontmatter",
  "path": "Projects/kado.md"
}

// Response content
{
  "path": "Projects/kado.md",
  "content": {
    "title": "Kado Plugin",
    "tags": ["project", "obsidian"],
    "status": "active"
  },
  "created": 1743379200000,
  "modified": 1743379500000,
  "size": 2048
}
```

**Read a binary file:**

```json
// Request arguments
{
  "operation": "file",
  "path": "Attachments/diagram.png"
}

// Response content
{
  "path": "Attachments/diagram.png",
  "content": "iVBORw0KGgoAAAANSUhEUg...",
  "created": 1743379200000,
  "modified": 1743379500000,
  "size": 34521
}
```

**Read inline fields:**

```json
// Request arguments
{
  "operation": "dataview-inline-field",
  "path": "Tasks/review.md"
}

// Response content
{
  "path": "Tasks/review.md",
  "content": {
    "due": "2026-04-01",
    "priority": "high",
    "assignee": "alice"
  },
  "created": 1743379200000,
  "modified": 1743379500000,
  "size": 512
}
```

---

## Tool: kado-write

Write content to the Obsidian vault. Supports creating new files and updating existing files with optimistic concurrency control.

### Operations

| Operation | Content type | Description |
|---|---|---|
| `note` | `string` | Full markdown body |
| `frontmatter` | `object` | JSON object merged into YAML front matter |
| `file` | `string` | Base64-encoded binary data |
| `dataview-inline-field` | `object` | JSON object of key-value pairs |

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `operation` | `"note" \| "frontmatter" \| "file" \| "dataview-inline-field"` | Yes | What to write |
| `path` | `string` | Yes | Vault-relative path, e.g. `"100 Inbox/new-note.md"` |
| `content` | `string \| object` | Yes | Content to write (see content format below) |
| `expectedModified` | `number` | Conditional | Required for updates. Omit only for creates. |
| `mode` | `"merge" \| "replace"` | No | Only honoured for `operation="frontmatter"` (ignored otherwise). Defaults to `"merge"`. See [Frontmatter Write Modes](#frontmatter-write-modes). |

### Content Format and Coercion

- **`note`** and **`file`**: content must be a string.
- **`frontmatter`** and **`dataview-inline-field`**: content should be a JSON object. If a JSON string is passed instead, Kado automatically parses it into an object (coercion). Prototype-pollution keys (`__proto__`, `constructor`, `prototype`) are stripped.

### Frontmatter Write Modes

The `mode` parameter controls how `operation="frontmatter"` reconciles the supplied object with what is already on the file. In both modes the markdown **body is byte-identical** before and after the write — only the YAML block changes.

| Mode | Behaviour |
|---|---|
| `"merge"` (default) | Deep-merge supplied keys with existing frontmatter. Plain objects recurse, arrays **replace** (no concat), scalars replace. Keys not present in the supplied object are preserved. |
| `"replace"` | Clear the existing frontmatter block entirely, then write the supplied object as-is. Keys absent from the supplied object are gone. |

**Why `merge` is the default:** lifecycle-style updates (e.g. flipping a single `state` field) are the dominant use case. `merge` lets callers express *"set these fields, leave the rest alone"* without round-tripping the full frontmatter. Use `replace` only when you genuinely want to overwrite the block — e.g. resetting a doc to a clean schema.

**Array semantics:** arrays always replace, never concatenate. `["#a", "#b"]` written over `["#x", "#y"]` results in `["#a", "#b"]`, not `["#x", "#y", "#a", "#b"]`. This matches the dominant use case where tag lists and similar arrays are intended as the new full value, not as additions. Perform set arithmetic client-side if you need additive behaviour.

**Concurrency:** the `expectedModified` requirement is unchanged — frontmatter updates still need a fresh read first.

**Audit log:** frontmatter writes are marked `bodyTouched: false` in audit entries so auditors can distinguish metadata-only writes from content writes.

### Path and Filename Restrictions

The `path` parameter is validated in two layers. Non-LLM callers (scripts, Python clients, etc.) must handle both — the second layer returns a generic `INTERNAL_ERROR` without explaining which character caused the failure.

**Layer 1 — Kado path validator (returns `VALIDATION_ERROR` with an explicit message):**

| Rule | Example of rejected input |
|---|---|
| Path must not be empty | `""` |
| Path must not contain null bytes | `"note\0.md"` (literal NUL), `"note%00.md"` (URL-encoded) |
| Path must not contain traversal segments | `"../secrets.md"`, `"a/../b.md"`, `"%2e%2e/b.md"` |

Leading `/` and duplicate `/` are normalized away silently (they are not errors).

**Layer 2 — Obsidian / OS filesystem (surfaces as `INTERNAL_ERROR` with message `"An unexpected error occurred"`):**

Obsidian rejects the following characters anywhere in a filename, on every platform, for vault portability:

```
\  :  *  ?  "  <  >  |
```

Additional platform and markdown-link caveats:

- `/` is always the path separator, never a literal character in a name segment.
- `#`, `^`, `[`, `]` are technically accepted on disk but break internal `[[wikilinks]]` and tag lookups — avoid them.
- Trailing spaces and trailing dots in a name segment are rejected or silently stripped by Windows filesystems.
- Reserved Windows device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`) are rejected even on macOS/Linux vaults that sync to Windows.

**Practical guidance for callers without an LLM in the loop:**

- Replace `:` in timestamps with `-` before calling `kado-write` (e.g. `"2026-04-20 11:48:29"` → `"2026-04-20 11-48-29"`).
- Strip or substitute any of `\ : * ? " < > |` from user-supplied filenames before sending the request.
- Treat an `INTERNAL_ERROR` on a create request as "probably an illegal filename character" and retry with a sanitized name.

### Create vs Update Flow

Kado uses the `expectedModified` parameter to distinguish creates from updates and to prevent lost-update conflicts.

| Scenario | `expectedModified` | File exists | Result |
|---|---|---|---|
| Create new file | Omitted | No | File created |
| Create new file | Omitted | Yes | **CONFLICT** — must read first |
| Update existing | Set to `modified` from prior read | Yes, mtime matches | File updated |
| Update existing | Set to `modified` from prior read | Yes, mtime differs | **CONFLICT** — re-read required |

**Recommended workflow:**

1. Call `kado-read` to get the current file content and `modified` timestamp.
2. Call `kado-write` with `expectedModified` set to the `modified` value from step 1.
3. If you receive a `CONFLICT` error, re-read and retry.

### Response Format

| Field | Type | Description |
|---|---|---|
| `path` | `string` | Vault-relative path of the written file |
| `created` | `number` | File creation timestamp (Unix ms) |
| `modified` | `number` | New modification timestamp (Unix ms) |

### Examples

**Create a new note:**

```json
// Request arguments
{
  "operation": "note",
  "path": "100 Inbox/new-idea.md",
  "content": "# New Idea\n\nCapture this thought..."
}

// Response content
{
  "path": "100 Inbox/new-idea.md",
  "created": 1743380000000,
  "modified": 1743380000000
}
```

**Update frontmatter (with concurrency guard, default merge mode):**

```json
// Existing frontmatter on disk:
//   status: pending
//   owner: marcus
//   tags: [#project/kado]
//
// Request arguments
{
  "operation": "frontmatter",
  "path": "Projects/kado.md",
  "content": {"status": "complete", "completedAt": "2026-04-01"},
  "expectedModified": 1743379500000
}
//
// Resulting frontmatter on disk (mode defaults to "merge"):
//   status: complete                ← updated
//   owner: marcus                   ← preserved (not in request)
//   tags: [#project/kado]           ← preserved (not in request)
//   completedAt: 2026-04-01         ← added

// Response content
{
  "path": "Projects/kado.md",
  "created": 1743379200000,
  "modified": 1743380100000
}
```

**Reset frontmatter to a clean schema (mode="replace"):**

```json
// Request arguments
{
  "operation": "frontmatter",
  "path": "Projects/kado.md",
  "content": {"status": "archived", "archivedAt": "2026-04-01"},
  "expectedModified": 1743380100000,
  "mode": "replace"
}
//
// Resulting frontmatter on disk:
//   status: archived
//   archivedAt: 2026-04-01
//   (all previously-present keys are gone)
```

**CONFLICT error (mtime mismatch):**

```json
{
  "code": "CONFLICT",
  "message": "File was updated in the background. Re-read before retrying."
}
```

**CONFLICT error (update without expectedModified):**

```json
{
  "code": "CONFLICT",
  "message": "expectedModified is required when updating an existing file. Read the file first to get the current modified timestamp."
}
```

---

## Tool: kado-delete

Remove content from the Obsidian vault. Notes and files are moved to the user's configured trash (respects the Obsidian "Deleted files" setting — system trash, `.trash/` folder, or permanent). Frontmatter delete removes specific keys from YAML metadata using the JavaScript `delete` operator (removes the property, not set-to-null). `expectedModified` is always required for optimistic concurrency — deletes are irreversible, so a stale state guard is non-optional.

### Operations

| Operation | Behavior |
|---|---|
| `note` | Trash the markdown file via `fileManager.trashFile` |
| `file` | Trash the binary file via `fileManager.trashFile` |
| `frontmatter` | Remove specified keys from YAML frontmatter (requires `keys` array) |
| `dataview-inline-field` | **Not supported** — returns `VALIDATION_ERROR`. Regex-based line removal is too risky for a destructive operation; use `kado-write` with the field removed instead. |

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `operation` | `"note" \| "file" \| "frontmatter" \| "dataview-inline-field"` | Yes | What to delete. `dataview-inline-field` is rejected with `VALIDATION_ERROR`. |
| `path` | `string` | Yes | Vault-relative path |
| `expectedModified` | `number` | **Yes (always)** | The `modified` timestamp from a prior read. CONFLICT if the file has changed since. |
| `keys` | `string[]` | Conditional | Required and non-empty when `operation: "frontmatter"`. Array of frontmatter keys to remove. Ignored for `note` and `file`. |

### Response Format

| Field | Type | When set | Description |
|---|---|---|---|
| `path` | `string` | Always | Vault-relative path of the deleted target |
| `modified` | `number` | Only for `frontmatter` | New `modified` timestamp of the file after key removal. Omitted for `note`/`file` deletes (file no longer exists). |

### Delete Flow

1. Call `kado-read` to get the current `modified` timestamp.
2. Call `kado-delete` with `expectedModified` set to that value.
3. On `CONFLICT`, re-read and retry (the file was modified between your read and delete).
4. On `NOT_FOUND`, the target doesn't exist — nothing to delete.

### Examples

**Delete a note:**

```json
// Request arguments
{
  "operation": "note",
  "path": "100 Inbox/stale-draft.md",
  "expectedModified": 1743379500000
}

// Response content
{
  "path": "100 Inbox/stale-draft.md"
}
```

**Delete a binary file:**

```json
// Request arguments
{
  "operation": "file",
  "path": "Attachments/old-screenshot.png",
  "expectedModified": 1743379500000
}

// Response content
{
  "path": "Attachments/old-screenshot.png"
}
```

**Delete frontmatter keys (other keys preserved):**

```json
// Request arguments
{
  "operation": "frontmatter",
  "path": "Projects/kado.md",
  "expectedModified": 1743379500000,
  "keys": ["draft", "obsolete-field"]
}

// Response content
{
  "path": "Projects/kado.md",
  "modified": 1743380200000
}
```

**VALIDATION_ERROR — dataview-inline-field not supported:**

```json
// Request arguments
{
  "operation": "dataview-inline-field",
  "path": "Tasks/review.md",
  "expectedModified": 1743379500000
}

// Response content
{
  "code": "VALIDATION_ERROR",
  "message": "mapDeleteRequest: operation must be one of note|frontmatter|file (got 'dataview-inline-field')"
}
```

**VALIDATION_ERROR — frontmatter delete without keys:**

```json
// Request arguments
{
  "operation": "frontmatter",
  "path": "Projects/kado.md",
  "expectedModified": 1743379500000
}

// Response content
{
  "code": "VALIDATION_ERROR",
  "message": "mapDeleteRequest: frontmatter delete requires a non-empty \"keys\" array"
}
```

**CONFLICT — stale expectedModified:**

```json
{
  "code": "CONFLICT",
  "message": "File was updated in the background. Re-read before deleting."
}
```

**NOT_FOUND — target does not exist:**

```json
{
  "code": "NOT_FOUND",
  "message": "File not found: 100 Inbox/already-deleted.md"
}
```

### Trash Behavior

Delete uses `app.fileManager.trashFile()`, which respects the user's Obsidian setting **Settings → Files and Links → Deleted files**:

- **Move to system trash** (default on desktop) — file goes to OS trash (`~/.Trash` on macOS, Recycle Bin on Windows)
- **Move to Obsidian trash** — file goes to `.trash/` at the vault root
- **Permanently delete** — file is unrecoverable

This gives the user — not the AI — final control over deletion recoverability.

---

## Tool: kado-search

Search the Obsidian vault. Results are scoped to the calling key's permissions and paginated.

### Operations

| Operation | Description | Requires `query` | Requires `path` |
|---|---|---|---|
| `byName` | Find files by name substring or glob pattern | Yes | No |
| `byTag` | Find files with a specific tag (exact or glob) | Yes | No |
| `byContent` | Find files containing a substring in the note body | Yes | No |
| `byFrontmatter` | Find files by frontmatter key=value or key-only. Supports dot-notation for nested keys (`tomo.state=pending-approval`). | Yes | No |
| `listDir` | List contents of a folder | No | Yes |
| `listTags` | List all permitted tags with counts | No | No |

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `operation` | `"byName" \| "byTag" \| "byContent" \| "byFrontmatter" \| "listDir" \| "listTags"` | Yes | Search operation type |
| `query` | `string` | Conditional | Search query (required except for `listDir` and `listTags`) |
| `path` | `string` | Conditional | Folder path for `listDir` only. `"/"` is the vault root. |
| `cursor` | `string` | No | Pagination cursor from a previous response |
| `limit` | `integer` | No | Items per page. Default: 50, min: 1, max: 500 |
| `depth` | `integer` | No | Walk depth for `listDir`. Omit for unlimited. `depth=1` returns direct children only. |
| `filter` | `object` | No | Universal cross-operation filter (see below) |

### Filter Object

The optional `filter` parameter narrows results for any operation. All filter fields are AND-combined.

| Field | Type | Description |
|---|---|---|
| `filter.path` | `string` | Folder prefix -- only items whose path starts with this value. Normalized to end with `/`. Max 512 chars. |
| `filter.tags` | `string[]` | Tag filter -- item must carry at least one matching tag. Supports `*` and `?` glob wildcards. Ignored by `listDir`. Max 128 chars per entry. |
| `filter.frontmatter` | `string` | Frontmatter filter -- `key=value` (match value) or `key` (key exists). Dot-notation traverses nested keys (`tomo.state=pending-approval`). Same syntax as `byFrontmatter` query. Ignored by `listDir`. |
| `filter.modifiedAfter` | `number` | Inclusive lower bound on file mtime (Unix milliseconds). Drops folder items. |
| `filter.modifiedBefore` | `number` | Inclusive upper bound on file mtime (Unix milliseconds). Drops folder items. |
| `filter.createdAfter` | `number` | Inclusive lower bound on file ctime (Unix milliseconds). Drops folder items. |
| `filter.createdBefore` | `number` | Inclusive upper bound on file ctime (Unix milliseconds). Drops folder items. |

**Security:** `filter.tags` patterns are validated against the key's allowed tags. Patterns not permitted by the key's tag scope are silently dropped. `filter.path` is validated against path traversal attacks (`..`, null bytes, encoded traversal).

**Performance:** For `byContent`, `filter.path` is applied as a pre-filter before reading file contents, avoiding unnecessary disk reads. Time-range filters use the result item's `created`/`modified` (already populated from `TFile.stat`), so they cost no extra I/O — narrow large vaults to recent files without reading content.

**Time-range semantics:**
- Bounds are inclusive on both ends. A file with `modified == filter.modifiedAfter` is included.
- Folder items (returned by `listDir`) carry placeholder `created=0`/`modified=0` and are always excluded when any time bound is set.
- `listTags` ignores time bounds (it returns aggregated tag counts, not per-file items).
- Reversed ranges (`After > Before`) are rejected with `VALIDATION_ERROR` at the mapper boundary. Non-numeric, non-finite, or negative values are rejected the same way.

**Examples:**

```json
// byName narrowed to a folder, only files tagged #project
{
  "operation": "byName",
  "query": "*.md",
  "filter": { "path": "notes/", "tags": ["project"] }
}

// byContent narrowed by frontmatter status
{
  "operation": "byContent",
  "query": "implementation plan",
  "filter": { "frontmatter": "status=active" }
}

// Files in 100 Inbox/ modified in the last 7 days
// (Date.now() - 7 * 86400000 evaluated client-side)
{
  "operation": "listDir",
  "path": "100 Inbox/",
  "filter": { "modifiedAfter": 1747161000000 }
}

// Notes in a specific lifecycle state, touched in the last 24h —
// the optimal pre-step for a metadata-only frontmatter write.
{
  "operation": "byFrontmatter",
  "query": "tomo.state=pending-approval",
  "filter": {
    "path": "100 Inbox/",
    "modifiedAfter": 1747679400000
  }
}

// listTags only from files in a specific folder
{
  "operation": "listTags",
  "filter": { "path": "Projects/" }
}
```

### Query Formats

| Operation | Query format | Examples |
|---|---|---|
| `byName` | Substring or glob with `*` and `?` wildcards | `"meeting"`, `"2026-03-*"`, `"*.canvas"` |
| `byTag` | Exact tag or glob pattern (include `#`) | `"#project"`, `"#project/*"` |
| `byContent` | Substring search in note body | `"TODO"`, `"implementation plan"` |
| `byFrontmatter` | `key=value` pair or key-only. Dot-notation traverses nested keys. | `"status=active"`, `"tags"`, `"tomo.state=pending-approval"` |
| `listDir` | Not used | N/A |
| `listTags` | Not used | N/A |

### Pagination

Results are cursor-based. When more results exist, the response includes a `cursor` value. Pass it back in the next request to get the next page.

### Response Format

| Field | Type | Description |
|---|---|---|
| `items` | `array` | Array of search result items |
| `cursor` | `string \| undefined` | Pagination cursor for next page, absent if no more results |
| `total` | `number \| undefined` | Total number of matching items |

Each item in `items`:

| Field | Type | Description |
|---|---|---|
| `path` | `string` | Vault-relative file path |
| `name` | `string` | File name |
| `created` | `number` | Creation timestamp (Unix ms) |
| `modified` | `number` | Modification timestamp (Unix ms) |
| `size` | `number` | File size in bytes |
| `tags` | `string[] \| undefined` | Tags on the file (when relevant) |
| `frontmatter` | `object \| undefined` | Frontmatter metadata (when relevant) |

### Scope Filtering

Search results are filtered to only include items within the calling key's permitted path scope. Both the global security scope and the key-specific scope are applied:

- **Whitelist mode**: only items matching at least one permitted path pattern are returned.
- **Blacklist mode**: items matching any blocked path pattern are excluded.

For `listDir`, both files and folders are scope-filtered. Folders appear if they could contain in-scope items; files appear only if they directly match a scope pattern. Use `**` as the scope pattern for full vault access.

For `listTags` and `byTag`, results also respect the key's allowed tags (the intersection of global and key-level tag lists).

### Examples

**Search by name (glob):**

```json
// Request arguments
{
  "operation": "byName",
  "query": "2026-03-*"
}

// Response content
{
  "items": [
    {
      "path": "Calendar/2026-03-30.md",
      "name": "2026-03-30.md",
      "created": 1743292800000,
      "modified": 1743379500000,
      "size": 1024
    },
    {
      "path": "Calendar/2026-03-31.md",
      "name": "2026-03-31.md",
      "created": 1743379200000,
      "modified": 1743379500000,
      "size": 512
    }
  ],
  "total": 2
}
```

**Search by tag:**

```json
// Request arguments
{
  "operation": "byTag",
  "query": "#project"
}

// Response content
{
  "items": [
    {
      "path": "Projects/kado.md",
      "name": "kado.md",
      "created": 1743379200000,
      "modified": 1743379500000,
      "size": 2048,
      "tags": ["#project", "#obsidian"]
    }
  ],
  "total": 1
}
```

**Search by content:**

```json
// Request arguments
{
  "operation": "byContent",
  "query": "TODO",
  "path": "Projects",
  "limit": 10
}

// Response content
{
  "items": [
    {
      "path": "Projects/kado.md",
      "name": "kado.md",
      "created": 1743379200000,
      "modified": 1743379500000,
      "size": 2048
    }
  ],
  "total": 1
}
```

**Search by frontmatter:**

```json
// Request arguments
{
  "operation": "byFrontmatter",
  "query": "status=active"
}

// Response content
{
  "items": [
    {
      "path": "Projects/kado.md",
      "name": "kado.md",
      "created": 1743379200000,
      "modified": 1743379500000,
      "size": 2048,
      "frontmatter": {"status": "active", "title": "Kado Plugin"}
    }
  ],
  "total": 1
}
```

**List directory (shallow scan — depth: 1):**

Returns only direct children of the target folder. Folder items appear before file items (folders-first sort, alphabetical within each group using locale-independent comparison).

```json
// Request arguments
{
  "operation": "listDir",
  "path": "Atlas/202 Notes/",
  "depth": 1
}

// Response content
{
  "items": [
    {
      "path": "Atlas/202 Notes/Concepts",
      "name": "Concepts",
      "type": "folder",
      "childCount": 14,
      "created": 0,
      "modified": 0,
      "size": 0
    },
    {
      "path": "Atlas/202 Notes/Figures",
      "name": "Figures",
      "type": "folder",
      "childCount": 22,
      "created": 0,
      "modified": 0,
      "size": 0
    },
    {
      "path": "Atlas/202 Notes/Methods",
      "name": "Methods",
      "type": "folder",
      "childCount": 9,
      "created": 0,
      "modified": 0,
      "size": 0
    },
    {
      "path": "Atlas/202 Notes/Projects",
      "name": "Projects",
      "type": "folder",
      "childCount": 31,
      "created": 0,
      "modified": 0,
      "size": 0
    },
    {
      "path": "Atlas/202 Notes/Sources",
      "name": "Sources",
      "type": "folder",
      "childCount": 47,
      "created": 0,
      "modified": 0,
      "size": 0
    },
    {
      "path": "Atlas/202 Notes/Topics",
      "name": "Topics",
      "type": "folder",
      "childCount": 0,
      "created": 0,
      "modified": 0,
      "size": 0
    },
    {
      "path": "Atlas/202 Notes/MOC.md",
      "name": "MOC.md",
      "type": "file",
      "created": 1743292800000,
      "modified": 1743379500000,
      "size": 3841
    },
    {
      "path": "Atlas/202 Notes/README.md",
      "name": "README.md",
      "type": "file",
      "created": 1743100000000,
      "modified": 1743200000000,
      "size": 512
    }
  ],
  "total": 8
}
```

**List directory (unlimited recursive walk):**

Omit `depth` to recurse into all descendants. The result is sorted folders-first at every level, then files, alphabetically within each group.

```json
// Request arguments
{
  "operation": "listDir",
  "path": "Atlas/"
}

// Response content (excerpt — full response continues)
{
  "items": [
    {
      "path": "Atlas/202 Notes",
      "name": "202 Notes",
      "type": "folder",
      "childCount": 8,
      "created": 0,
      "modified": 0,
      "size": 0
    },
    {
      "path": "Atlas/202 Notes/Concepts",
      "name": "Concepts",
      "type": "folder",
      "childCount": 14,
      "created": 0,
      "modified": 0,
      "size": 0
    },
    {
      "path": "Atlas/202 Notes/Concepts/abstraction.md",
      "name": "abstraction.md",
      "type": "file",
      "created": 1743292800000,
      "modified": 1743379500000,
      "size": 924
    },
    {
      "path": "Atlas/202 Notes/MOC.md",
      "name": "MOC.md",
      "type": "file",
      "created": 1743292800000,
      "modified": 1743379500000,
      "size": 3841
    }
  ],
  "cursor": "eyJvZmZzZXQiOjUwfQ==",
  "total": 281
}
```

#### listDir Parameters

In addition to the common search parameters (`cursor`, `limit`), `listDir` accepts:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | `string` | Yes | Folder to list. `"/"` is the canonical vault-root marker. Trailing slashes are accepted (`"Atlas/202 Notes/"` is equivalent to `"Atlas/202 Notes"`). Empty string `""` is rejected with `VALIDATION_ERROR`. Non-existent paths return `NOT_FOUND`. Paths that resolve to a file return `VALIDATION_ERROR`. |
| `depth` | `integer` | No | Walk depth. Positive integer: walk at most N levels below the target (`depth: 1` returns only direct children). Omit for unlimited recursion. Zero, negative, non-integer, or non-number values return `VALIDATION_ERROR`. |

#### listDir Response Items

Every item in a `listDir` response carries a `type` discriminator. The `type` field is not present on items from other operations (`byName`, `byTag`, `byContent`, `byFrontmatter`, `listTags`).

| Field | Type | Files | Folders | Description |
|---|---|---|---|---|
| `path` | `string` | Always | Always | Vault-relative path |
| `name` | `string` | Always | Always | Entry name |
| `type` | `'file' \| 'folder'` | `'file'` | `'folder'` | Entry type discriminator |
| `childCount` | `number` | — | Always | Filtered count of visible direct children (hidden and out-of-scope children excluded) |
| `created` | `number` | Real stat (Unix ms) | `0` (placeholder) | Creation timestamp |
| `modified` | `number` | Real stat (Unix ms) | `0` (placeholder) | Modification timestamp |
| `size` | `number` | Real size in bytes | `0` (placeholder) | File size |

#### listDir Error Codes

| Code | When |
|---|---|
| `NOT_FOUND` | Path does not exist in the vault, OR any segment of the path starts with `.` (hidden target — existence is not confirmed) |
| `VALIDATION_ERROR` | Path resolves to a file instead of a folder, OR `depth` is invalid (zero, negative, non-integer), OR `path` is an empty string |

#### listDir Hidden Entries

Files and folders whose name starts with `.` (e.g., `.obsidian/`, `.trash/`) are never included in `listDir` responses. They are also excluded from the `childCount` of any parent folder item. A direct request for a hidden path returns `NOT_FOUND` (not `VALIDATION_ERROR`) to avoid confirming the entry's existence.

#### Migration from 0.1.x

- **Folder entries now appear in responses.** Callers that previously iterated items assuming all entries were files must add a `type` guard (`if (item.type === 'file') { ... }`). Folder items have `size: 0`, `created: 0`, `modified: 0`.
- **`childCount` is a filtered count.** It reflects only visible (non-hidden, in-scope) direct children. It does not equal the raw child count of the folder.
- **Non-existent and file-targeted paths now return explicit errors.** Previously, `listDir` on a missing or file path could return an empty `items` array. Now it returns `NOT_FOUND` or `VALIDATION_ERROR` respectively. Callers that treated an empty list as "path not found" must handle the error code instead.
- **`"/"` is the canonical vault-root marker.** Passing `path: "/"` lists the vault root. Omitting `path` continues to work and is equivalent. Empty string `""` is now rejected. Note: `"/"` is a *listDir path parameter*, not a scope pattern. To grant full vault access in the security config, use `**`.
- **File-level scope filtering.** Both files and folders are now filtered by the key's scope patterns. Previously only folders were scope-checked during directory walks; files at the walk root could appear regardless of scope.
- **Sort order changed.** Folders appear before files in the response. Within each group items are sorted alphabetically using locale-independent comparison.

**List tags:**

```json
// Request arguments
{
  "operation": "listTags"
}

// Response content
{
  "items": [
    {
      "path": "#project",
      "name": "#project",
      "created": 0,
      "modified": 0,
      "size": 5
    },
    {
      "path": "#obsidian",
      "name": "#obsidian",
      "created": 0,
      "modified": 0,
      "size": 3
    }
  ],
  "total": 2
}
```

**Paginated request:**

```json
// Request arguments
{
  "operation": "byName",
  "query": "*.md",
  "limit": 50,
  "cursor": "eyJvZmZzZXQiOjUwfQ=="
}
```

---

## Tool: kado-open-notes

Enumerate the notes currently open in the Obsidian workspace. Read-only — does not modify workspace state. Gated by **per-capability feature flags** (`allowActiveNote`, `allowOtherNotes`) layered on top of the standard per-path ACL. Both flags default to `false` at every layer, so this tool returns `FORBIDDEN` until the user explicitly opts in at both the global security level and the per-key level.

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `scope` | `"active" \| "other" \| "all"` | No | Which category of open notes to return. Defaults to `"all"` when omitted. |

### Scopes

| Scope | Returns | Denial behaviour |
|---|---|---|
| `active` | The currently focused leaf only | `FORBIDDEN` (gate=`feature-gate`) if either global or key `allowActiveNote` is off |
| `other` | Open notes other than the focused leaf | `FORBIDDEN` (gate=`feature-gate`) if either global or key `allowOtherNotes` is off |
| `all` (default) | Both categories | Silently filters the off category when only one flag pair is on (partial result, no error). Denies only when **both** pairs are off. |

### Response Format

| Field | Type | Description |
|---|---|---|
| `notes` | `OpenNote[]` | Permitted open notes (may be empty). One entry per unique vault path — linked panes showing the same file collapse into a single entry. |

**`OpenNote` shape:**

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Obsidian `TFile.basename` — filename without the extension |
| `path` | `string` | Vault-relative path, e.g. `"Calendar/2026-03-31.md"` |
| `active` | `boolean` | `true` when this entry is (or includes) the currently focused leaf |
| `type` | `string` | Workspace view type. Known values: `"markdown"`, `"canvas"`, `"pdf"`, `"image"`. Unknown view types pass through as-is. |

### Feature Gate Model

The feature flags live on **both** the global `SecurityConfig` and every `ApiKeyConfig`:

```typescript
SecurityConfig.allowActiveNote   // global opt-in for focused-note enumeration
SecurityConfig.allowOtherNotes   // global opt-in for other-open-notes enumeration
ApiKeyConfig.allowActiveNote     // per-key opt-in for focused-note enumeration
ApiKeyConfig.allowOtherNotes     // per-key opt-in for other-open-notes enumeration
```

Both layers are **AND-combined with no inheritance**. A category is accessible only when both the global flag and the key flag are `true`. Every flag defaults to `false`, including for keys migrated from pre-0.7.0 configs — the tool is default-deny end-to-end.

The feature gate runs as a standalone evaluation **before** the per-path ACL. Clients should treat a `FORBIDDEN` with `gate: 'feature-gate'` as permanent-for-this-key: the flags do not depend on the requested path, so retrying with a different path cannot succeed.

### Path ACL — Silent Filtering

After the feature gate allows a scope, each resulting descriptor is checked against the standard global AND key per-path ACL. **Descriptors whose path is not in the permitted scope are silently filtered out** of the response with no per-note error.

This is a deliberate privacy invariant (ADR-4 in spec 006): per-note denial messages would leak the existence of private notes through a side channel. An empty `notes: []` is always a valid success response — it indicates either no permitted files are open, or every open file was silently filtered by the ACL.

### Enumerated View Types

Only leaves of these Obsidian view types are inspected:

- `markdown`
- `canvas`
- `pdf`
- `image`

Leaves of other view types (custom plugin views, graph view, etc.) are ignored. Leaves whose view object does not expose a real `TFile` (e.g. plugin-injected views that fake a `.path` property) are also dropped — only genuine vault files may produce descriptors.

### Examples

**List every permitted open note (default scope):**

```json
// Request arguments
{}

// Response content
{
  "notes": [
    {
      "name": "2026-03-31",
      "path": "Calendar/2026-03-31.md",
      "active": true,
      "type": "markdown"
    },
    {
      "name": "Project Roadmap",
      "path": "Projects/roadmap.md",
      "active": false,
      "type": "markdown"
    }
  ]
}
```

**Ask for the focused leaf only:**

```json
// Request arguments
{ "scope": "active" }

// Response content
{
  "notes": [
    {
      "name": "2026-03-31",
      "path": "Calendar/2026-03-31.md",
      "active": true,
      "type": "markdown"
    }
  ]
}
```

**Ask for everything except the focused leaf:**

```json
// Request arguments
{ "scope": "other" }

// Response content
{
  "notes": [
    {
      "name": "Project Roadmap",
      "path": "Projects/roadmap.md",
      "active": false,
      "type": "markdown"
    }
  ]
}
```

**Feature gate denies — requested scope is off:**

```json
// Request arguments
{ "scope": "active" }

// Response content
{
  "code": "FORBIDDEN",
  "message": "global allowActiveNote is off; key allowActiveNote is off"
}
```

The `message` names the off layer(s) so the user can fix the right setting. `gate` is always `"feature-gate"` for this denial class.

**Partial result on `scope: "all"` — only the other-notes flag is on:**

```json
// Request arguments
{ "scope": "all" }

// Response content (active category silently filtered — no error)
{
  "notes": [
    {
      "name": "Project Roadmap",
      "path": "Projects/roadmap.md",
      "active": false,
      "type": "markdown"
    }
  ]
}
```

**Empty result — all open notes were silently filtered by the path ACL:**

```json
// Response content (success, no error)
{
  "notes": []
}
```

### Audit

Audit log entries for `kado-open-notes` carry the scope and a `permittedCount` integer only. **Individual note paths never appear in the audit trail** for this tool — emitting them would defeat the privacy invariant that silent ACL filtering exists to preserve.

---

## Error Reference

All errors are returned as MCP tool results with `isError: true` and a JSON body containing `code` and `message`.

| Code | HTTP Equivalent | When it occurs | Example message |
|---|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or invalid Bearer token | `"Missing authentication token"` |
| `FORBIDDEN` | 403 | Permission denied by any gate in the chain | `"Path not in scope"` |
| `NOT_FOUND` | 404 | Requested file does not exist in the vault | `"File not found: Calendar/missing.md"` |
| `CONFLICT` | 409 | `expectedModified` mismatch or missing on update | `"File was updated in the background. Re-read before retrying."` |
| `VALIDATION_ERROR` | 400 | Invalid parameters or missing required fields | `"mapReadRequest: missing required field \"path\""` |
| `INTERNAL_ERROR` | 500 | Unexpected server-side failure | *(varies)* |

**Error response shape:**

```json
{
  "code": "CONFLICT",
  "message": "File was updated in the background. Re-read before retrying."
}
```

---

## Security Model

Every request passes through a 5-gate permission chain. Gates are evaluated in order; the first denial short-circuits the chain.

| # | Gate | What it checks |
|---|---|---|
| 0 | **authenticate** | Token exists and matches an enabled API key |
| 1 | **global-scope** | File path is within the global security scope (whitelist/blacklist) |
| 2 | **key-scope** | File path is within the API key's own scope (whitelist/blacklist) |
| 3 | **datatype-permission** | The operation's data type + CRUD action is permitted for the matched path rule |
| 4 | **path-access** | Final path-level access check against the resolved permission set |

### Scope Modes

Both global security and per-key scopes support two modes:

- **Whitelist**: only paths matching a listed pattern are accessible. Everything else is denied.
- **Blacklist**: all paths are accessible except those matching a listed pattern.

### CRUD Permissions

Each path rule specifies independent Create/Read/Update/Delete flags for each data type:

- `note` — markdown content
- `frontmatter` — YAML metadata
- `file` — binary files
- `dataviewInlineField` — Dataview inline fields

Some flags are inert because no adapter path reaches them:

- `frontmatter.create` and `dataviewInlineField.create` — values are written by **updating** the
  existing note (there is no standalone create); use `update` instead.
- `dataviewInlineField.delete` — deleting individual inline fields is intentionally unsupported.

See [Configuration Guide -- Permission semantics per data type](configuration.md#permission-semantics-per-data-type)
for the full per-type breakdown.

### Tag Restrictions

Tag-based search operations (`byTag`, `listTags`) respect the intersection of global and key-level tag lists. If neither level has tags configured, all tags are accessible. If both have tags, only the intersection is permitted.
