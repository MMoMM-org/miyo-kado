# Troubleshooting — Kado
<!-- Known issues and proven fixes. Updated: 2026-04-01 -->
<!-- Format: ## [Issue title] — Status: open/resolved — [fix description] -->
<!-- Resolved entries are archived by /memory-cleanup, not deleted -->

## MCP SDK has no 429 rate-limit handling — Status: open
**Problem**: `@modelcontextprotocol/sdk` `StreamableHTTPClientTransport` throws a plain `StreamableHTTPError` on 429 responses. It does not read `Retry-After` headers or implement automatic backoff. This is an SDK-level gap, not Kado-specific — all MCP servers returning 429 are affected.
**Impact**: MCP clients (Claude, custom agents) that don't add their own retry logic will crash or fail-fast on rate limits instead of waiting and retrying.
**Kado mitigation**: Server sends `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` on every response + `Retry-After` on 429. Clients must read these headers themselves. Reference implementation in `test/live/mcp-live.test.ts` (`probeRetryAfter()` + `callTool()` retry loop).
**Future**: Consider raising/making rate limit configurable, or contributing 429 handling upstream to `@modelcontextprotocol/sdk`.

## Obsidian vault.modify()/process() truncates files when new content is larger — Status: open
**Problem**: `vault.modify()` and `vault.process()` truncate the disk file to the PREVIOUS file size when the new content is larger. Verified by hex dump: a 49-byte file updated with 52 bytes of content → disk shows exactly 49 bytes (old size), losing the final 3 bytes. The in-memory cache (`vault.read()`) has the correct full content, but `readFileSync` on disk is truncated. Root cause appears to be Obsidian using stale `file.stat.size` for `ftruncate` during the internal disk flush.
**Workaround**: Write via `vault.adapter.write()` (correct byte count, direct to disk), then `vault.read()` to refresh Obsidian's in-memory cache from the correctly-written file. Do NOT use `vault.modify()`/`vault.process()` for the actual disk write.
**Sources**: Obsidian Forum debounce thread, Templater #1629 race condition.
**Related**: obsidian-mcp-tools (jacksteamdev) uses external MCP server → bypasses Obsidian's write pipeline entirely.
