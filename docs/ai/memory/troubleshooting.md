# Troubleshooting — Kado
<!-- Known issues and proven fixes. Updated: 2026-04-01 -->
<!-- Format: ## [Issue title] — Status: open/resolved — [fix description] -->
<!-- Resolved entries are archived by /memory-cleanup, not deleted -->

## MCP SDK has no 429 rate-limit handling — Status: open
**Problem**: `@modelcontextprotocol/sdk` `StreamableHTTPClientTransport` throws a plain `StreamableHTTPError` on 429 responses. It does not read `Retry-After` headers or implement automatic backoff. This is an SDK-level gap, not Kado-specific — all MCP servers returning 429 are affected.
**Impact**: MCP clients (Claude, custom agents) that don't add their own retry logic will crash or fail-fast on rate limits instead of waiting and retrying.
**Kado mitigation**: Server sends `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` on every response + `Retry-After` on 429. Clients must read these headers themselves. Reference implementation in `test/live/mcp-live.test.ts` (`probeRetryAfter()` + `callTool()` retry loop).
**Future**: Consider raising/making rate limit configurable, or contributing 429 handling upstream to `@modelcontextprotocol/sdk`.

## Obsidian vault.modify() + adapter.write() double-write truncation — Status: resolved
**Problem**: Calling `vault.modify(file, content)` followed by `vault.adapter.write(path, content)` causes a race condition. Obsidian's internal flush from `modify()` uses `string.length` (character count) for file truncation, but UTF-8 multi-byte characters (e.g. `→` = 3 bytes, 1 char) make the byte length larger. The internal flush overwrites the adapter's correct write, truncating exactly N bytes where N = total extra UTF-8 bytes from multi-byte chars.
**Fix**: Use ONE write mechanism only. `vault.process()` for atomic updates, `vault.modify()` alone for simple writes, `vault.create()` alone for creates. Never combine `vault.modify()` with `adapter.write()`.
**Sources**: Obsidian Forum debounce thread, Templater #1629 race condition, Obsidian Linter single-write pattern.
**Related**: obsidian-mcp-tools (jacksteamdev) uses external MCP server → bypasses this entirely.
