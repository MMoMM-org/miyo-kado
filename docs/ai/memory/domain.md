# Domain — Kado
<!-- Business rules, data models, entities, domain language. Updated: 2026-04-15 -->
<!-- What goes here: what X means in this codebase, business rules that drive code decisions -->
<!-- Entries that appear frequently may be promotable → run /memory-promote -->

<!-- 2026-06-04 -->
## kado-search operation='listNotes' semantics
Notes-only flat listing with an opt-in body-derived projection, sourced entirely from `metadataCache` (no `vault.read`). Built for bulk metadata indexing (Tomo F-34: index every atomic note in one recursive call). Sibling to `listDir` but distinct: `listDir` is a directory tree (folders + files + `childCount`); `listNotes` returns markdown notes only, never folders.
- **Selection** mirrors `listDir`: `path` is the walk root (`'/'` = vault root; omitted = root), `depth` bounds recursion (omit = unlimited, `depth=1` = direct children). Plus the universal `filter` (tags / frontmatter / time / path) narrows *within* the subtree — so "all notes under `Atlas/` with tag `Y`" is one call. `filter.tags` runs through `enforceTagPermissions` (respects the key's `allowedTags`).
- **Markdown only** — non-`.md` files (pdf, png, `.canvas`) are excluded; folders are dropped.
- **`fields` projection** (opt-in; omit ⇒ base stat item only): `links`, `headings`, `tags`. Each enriches per note from `getFileCache`:
  - `links: {target, kind: 'link'|'embed'}[]` — `cache.links` (`[[x]]`) + `cache.embeds` (`![[x]]`) folded together, `target` is the raw written string.
  - `headings: {heading, level}[]` — `cache.headings` outline.
  - `tags: string[]` — `getFileTags` (inline + frontmatter, `#`-prefixed, deduped).
  - Unindexed note (`getFileCache` null) ⇒ empty arrays, not an error.
- **Permission**: a `SearchOperation`, so it inherits the search `note.read` gate (`evaluateSearchPermission`); `scopePatterns` clip results to the key's paths at walk time. No new gate branch.
- **Disclosure boundary** (see decisions.md 2026-06-04): link targets and a note's own tags are source-note content the key may already read via `operation='note'`, so they are returned **raw, including targets outside the key's scope**. The adapter reads `getFileCache` only for in-scope source notes and never resolves targets / never uses `resolvedLinks`.
- Implementation: `src/obsidian/search-adapter.ts` (`listNotes`, `readLinks`, `readHeadings`, reuses `walk`/`resolveFolder`/`getFileTags`). Types: `CoreSearchRequest.fields`, `CoreSearchItem.links/headings`, `CoreLinkRef`, `CoreHeadingRef`.

<!-- 2026-04-15 -->
## kado-read operation='tags' semantics
Returns tags of a note as `{frontmatter: string[], inline: string[], all: string[], returnedTags: 'All' | 'FrontmatterOnly'}` (JSON-stringified in the MCP response). All tags stored without the leading `#`.
- `frontmatter` comes from `metadataCache.getFileCache(file)?.frontmatter?.tags`. Accepts both YAML list (`tags: [a, b]`) and string (`tags: "a b, c"`) — strings are split at whitespace and commas, then normalized.
- `inline` comes from `extractInlineTags(body)` after stripping the leading YAML frontmatter block. Skips fenced code blocks, inline code spans, URL fragments, and markdown link anchors. `#` must not be preceded by a word character.
- `all` is the deduplicated union preserving frontmatter-then-inline order.
- Permission model (DataTypePermissionGate, special-cased via `evaluateTagsPermission`):
  - `note.read=true` on the resolved path → `returnedTags: 'All'`, full result (frontmatter + inline). Rationale: if the caller can read the note body they already see every inline tag, so denying frontmatter.read separately would be pointless.
  - `note.read=false, frontmatter.read=true` → `returnedTags: 'FrontmatterOnly'`, `inline: []`. Signals that more tags may exist but require `note.read`. No count/length leak — just a bool-level discriminator.
  - both false → FORBIDDEN.
  - Gate attaches the resolved scope to `request.tagsReturnScope` for the adapter.
- Adapter skips `vault.read()` entirely in `frontmatter-only` scope (no disk I/O beyond metadataCache).
- Type model: `ReadDataType = DataType | 'tags'`. `CoreReadRequest.operation: ReadDataType`. Writes/deletes stay on `DataType` — 'tags' is unreachable on those code paths by construction. Router uses `resolveReadAdapter()` which maps 'tags' to the note adapter uniformly.

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
