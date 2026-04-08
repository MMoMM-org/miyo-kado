# Troubleshooting — Kado
<!-- Known issues and proven fixes. Updated: 2026-04-08 -->
<!-- Format: ## [Issue title] — Status: open/resolved — [fix description] -->
<!-- Resolved entries are archived by /memory-cleanup, not deleted -->

## MCP SDK has no 429 rate-limit handling — Status: open
**Problem**: `@modelcontextprotocol/sdk` `StreamableHTTPClientTransport` throws a plain `StreamableHTTPError` on 429 responses. It does not read `Retry-After` headers or implement automatic backoff. This is an SDK-level gap, not Kado-specific — all MCP servers returning 429 are affected.
**Impact**: MCP clients (Claude, custom agents) that don't add their own retry logic will crash or fail-fast on rate limits instead of waiting and retrying.
**Kado mitigation**: Server sends `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` on every response + `Retry-After` on 429. Clients must read these headers themselves. Reference implementation in `test/live/mcp-live.test.ts` (`probeRetryAfter()` + `callTool()` retry loop).
**Future**: Consider raising/making rate limit configurable, or contributing 429 handling upstream to `@modelcontextprotocol/sdk`.

## Obsidian transient disk truncation after adapter.write() — Status: understood
**Problem**: After `vault.adapter.write()`, Obsidian's file watcher detects the change and briefly overwrites the file with stale in-memory cache content (truncated to previous file size). Within ~1-2 seconds, it corrects itself by re-reading from disk. This is a **transient** state, not permanent data loss.
**Diagnosis**: Create "Hello" (5B) → update to "Dies ist ein komischer Test" (27B) → immediate `readFileSync` shows "Dies " (5B, old size) → after 2s delay shows full 27B content. MCP readback (`vault.read()`) is always correct immediately.
**Workaround**: For filesystem verification in tests, add ~2s delay after writes that increase file size. MCP API consumers are unaffected (they use `vault.read()` which returns correct content instantly).
**Kado approach**: Use `vault.adapter.write()` for disk writes (note-adapter updateNote), `vault.create()` for creates. The transient truncation resolves itself.
**Related**: obsidian-mcp-tools (jacksteamdev) uses external MCP server → bypasses this entirely.

<!-- 2026-04-08 -->
## Settings page stale after plugin reload — Status: open
**Problem**: After a hot-reload of the plugin (dev rebuild), the Obsidian settings tab continues showing the old UI state and old version number (e.g. `0.0.27`) even though the Community Plugins page correctly shows the new version (`0.0.28`). Observed: new picker placement and other UI changes don't appear until the user fully disables and re-enables the plugin.
**Impact**: Dev loop is confusing — changes appear to not land when they actually did. Also affects end users after updates.
**Suspected cause**: Settings tab is constructed once and not re-rendered on plugin reload; references to the previous plugin instance leak into the DOM.
**Workaround**: Disable + re-enable the plugin to force a fresh settings tab construction.
**TODO**: Ensure settings tab is cleanly torn down and rebuilt on plugin lifecycle events; verify no stale closures hold old `this.plugin` references.
