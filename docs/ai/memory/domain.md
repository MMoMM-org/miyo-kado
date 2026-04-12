# Domain — Kado
<!-- Business rules, data models, entities, domain language. Updated: 2026-03-30 -->
<!-- What goes here: what X means in this codebase, business rules that drive code decisions -->
<!-- Entries that appear frequently may be promotable → run /memory-promote -->

<!-- 2026-04-08 -->
## Access mode is per-key, not inherited from global
Each API key has its own access mode (whitelist/blacklist) configured independently. There is no inheritance from a global default — the access mode toggle shown per key is authoritative, not read-only. When implementing permission enforcement, resolve the mode from the key's own config, never fall back to a global setting.

<!-- 2026-04-12 -->
## Full vault access pattern is `**`
The glob pattern `**` means "full vault access" — it matches every file and folder. It is the only supported way to grant unrestricted scope. The `/` character is NOT a valid scope pattern (Obsidian paths are relative, never start with `/`). Legacy configs with `/` are silently migrated to `**` on load. In the settings UI, the folder picker includes `** (Full vault)` as the first entry. Note: `/` in the `listDir` path parameter is a different concept — it's the vault-root marker for directory listing, not a scope pattern.
