# Domain — Kado
<!-- Business rules, data models, entities, domain language. Updated: 2026-04-15 -->
<!-- What goes here: what X means in this codebase, business rules that drive code decisions -->
<!-- Entries that appear frequently may be promotable → run /memory-promote -->

<!-- 2026-04-15 -->
## kado-read operation='tags' semantics
Returns all tags of a note as `{frontmatter: string[], inline: string[], all: string[]}` (JSON-stringified in the MCP response). All tags are stored without the leading `#`.
- `frontmatter` comes from `metadataCache.getFileCache(file)?.frontmatter?.tags`. Accepts both YAML list (`tags: [a, b]`) and string (`tags: "a b, c"`) — strings are split at whitespace and commas, then normalized.
- `inline` comes from `extractInlineTags(body)` after stripping the leading YAML frontmatter block. Skips fenced code blocks, inline code spans, URL fragments, and markdown link anchors. `#` must not be preceded by a word character.
- `all` is the deduplicated union preserving frontmatter-then-inline order.
- Permission: requires `note.read` on the target path (DataTypePermissionGate maps `'tags'` → `'note'` key). Writes/deletes never accept `'tags'`.
- Type model: `ReadDataType = DataType | 'tags'`. `CoreReadRequest.operation: ReadDataType`. `DataType` (the 4 CRUD-capable types) is unchanged — no permission flag, Zod enum entry, or registry key added for `'tags'`.

<!-- 2026-04-14 -->
## kado-delete semantics
`kado-delete` is the fourth MCP tool (alongside read/write/search). It supports 3 data types: `note`, `file`, `frontmatter`. Inline fields are intentionally excluded (regex-based line removal too risky).
- `note` / `file` → `app.fileManager.trashFile()` — respects user's Obsidian "Deleted files" setting (system trash / `.trash/` folder / permanent).
- `frontmatter` → `app.fileManager.processFrontMatter()` with JS `delete fm[key]` for each key in the `keys` array. Removes the property, not sets to null.
- `expectedModified` is always required (no optional form — prevents deleting stale state).
- `keys` is required when `operation='frontmatter'` (non-empty string array).
- Permission gate uses `delete: true/false` from CrudFlags — same mechanism as read/write/update.
- Router discriminates via explicit `kind: 'delete'` marker on CoreDeleteRequest (other request types don't have a `kind` field).

<!-- 2026-04-08 -->
## Access mode is per-key, not inherited from global
Each API key has its own access mode (whitelist/blacklist) configured independently. There is no inheritance from a global default — the access mode toggle shown per key is authoritative, not read-only. When implementing permission enforcement, resolve the mode from the key's own config, never fall back to a global setting.

<!-- 2026-04-12 -->
## Full vault access pattern is `**`
The glob pattern `**` means "full vault access" — it matches every file and folder. It is the only supported way to grant unrestricted scope. The `/` character is NOT a valid scope pattern (Obsidian paths are relative, never start with `/`). Legacy configs with `/` are silently migrated to `**` on load. In the settings UI, the folder picker includes `** (Full vault)` as the first entry. Note: `/` in the `listDir` path parameter is a different concept — it's the vault-root marker for directory listing, not a scope pattern.
