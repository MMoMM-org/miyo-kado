# Troubleshooting — Kado
<!-- Known issues and proven fixes. Updated: 2026-04-14 -->
<!-- Format: ## [Issue title] — Status: open/resolved — [fix description] -->
<!-- Resolved entries are archived by /memory-cleanup, not deleted -->

<!-- 2026-04-14 -->
## byFrontmatter does not match against array values — Status: resolved
**Problem**: `kado-search byFrontmatter query=<key>=<value>` did only a scalar string comparison. When the value was an array (`tags: [finance, planning]` or list-form), queries like `tags=finance` returned no results — failing for the most common Obsidian tag formats documented at https://obsidian.md/help/tags.
**Fix (2026-04-14)**: Added `frontmatterValueMatches()` in `src/obsidian/search-adapter.ts` that supports all three valid Obsidian frontmatter tag formats:
  - Arrays (from list-form or inline `[a, b]`) → case-insensitive element membership
  - Comma-separated strings (`tags: a, b`) → case-insensitive element check after split/trim
  - Scalars → case-insensitive equality (unchanged)
**Tests**: 5 new unit tests in `test/obsidian/search-adapter.test.ts` cover array/list/comma/case-insensitive/non-member. Live test `T-SCOPE.1` in `test/live/mcp-live.test.ts` validates end-to-end with `tags=finance`.

## MCP SDK has no 429 rate-limit handling — Status: open ([#11](https://github.com/MMoMM-org/miyo-kado/issues/11))
**Problem**: `@modelcontextprotocol/sdk` `StreamableHTTPClientTransport` throws a plain `StreamableHTTPError` on 429 responses. It does not read `Retry-After` headers or implement automatic backoff. This is an SDK-level gap, not Kado-specific — all MCP servers returning 429 are affected.
**Impact**: MCP clients (Claude, custom agents) that don't add their own retry logic will crash or fail-fast on rate limits instead of waiting and retrying.
**Kado mitigation**: Server sends `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` on every response + `Retry-After` on 429. Clients must read these headers themselves. Reference implementation in `test/live/mcp-live.test.ts` (`probeRetryAfter()` + `callTool()` retry loop).
**Future**: Consider raising/making rate limit configurable, or contributing 429 handling upstream to `@modelcontextprotocol/sdk`.

## Obsidian transient disk truncation after adapter.write() — Status: understood ([#10](https://github.com/MMoMM-org/miyo-kado/issues/10))
**Problem**: After `vault.adapter.write()`, Obsidian's file watcher detects the change and briefly overwrites the file with stale in-memory cache content (truncated to previous file size). Within ~1-2 seconds, it corrects itself by re-reading from disk. This is a **transient** state, not permanent data loss.
**Diagnosis**: Create "Hello" (5B) → update to "Dies ist ein komischer Test" (27B) → immediate `readFileSync` shows "Dies " (5B, old size) → after 2s delay shows full 27B content. MCP readback (`vault.read()`) is always correct immediately.
**Workaround**: For filesystem verification in tests, add ~2s delay after writes that increase file size. MCP API consumers are unaffected (they use `vault.read()` which returns correct content instantly).
**Kado approach**: Use `vault.adapter.write()` for disk writes (note-adapter updateNote), `vault.create()` for creates. The transient truncation resolves itself.
**Related**: obsidian-mcp-tools (jacksteamdev) uses external MCP server → bypasses this entirely.

<!-- 2026-04-08 -->
## Settings page stale after plugin reload — Status: open ([#9](https://github.com/MMoMM-org/miyo-kado/issues/9))
**Problem**: After a hot-reload of the plugin (dev rebuild), the Obsidian settings tab continues showing the old UI state and old version number (e.g. `0.0.27`) even though the Community Plugins page correctly shows the new version (`0.0.28`). Observed: new picker placement and other UI changes don't appear until the user fully disables and re-enables the plugin.
**Impact**: Dev loop is confusing — changes appear to not land when they actually did. Also affects end users after updates.
**Suspected cause**: Settings tab is constructed once and not re-rendered on plugin reload; references to the previous plugin instance leak into the DOM.
**Workaround**: Disable + re-enable the plugin to force a fresh settings tab construction.
**TODO**: Ensure settings tab is cleanly torn down and rebuilt on plugin lifecycle events; verify no stale closures hold old `this.plugin` references.

<!-- 2026-04-14 -->
## T9.3 blacklist permission semantic inconsistency — Status: open ([#8](https://github.com/MMoMM-org/miyo-kado/issues/8))
**Problem**: The `mcp-config-change.test.ts` test T9.3 fails reproducibly. Config: Global=blacklist(nope/**), Key1=blacklist(maybe-allowed/** with `note: {create: false, read: true, update: true, delete: true}`). The test expects reading `maybe-allowed/Budget 2026.md` to succeed (because only note.create is blocked), but the permission gate returns FORBIDDEN for the read as well.
**Impact**: Blacklist-mode permission flags are inconsistently interpreted — the distinction between "listed as blocked" (true) and "not listed" (false) isn't applied uniformly per CRUD action. Breaks the documented blacklist semantics.
**Suspected cause**: `datatype-permission.ts` intersectPermissions or resolveScope treats whitelist and blacklist symmetrically when computing effective permissions. Blacklist likely needs to invert the flag check per action.
**Workaround**: None — feature bug. Tests skip or fail visibly.
**TODO**: Audit `src/core/gates/scope-resolver.ts` and `datatype-permission.ts` for blacklist-inversion logic. Add unit tests with all 16 combinations of (whitelist/blacklist × CRUD flag true/false).

## Live test state isolation — Status: known
**Problem**: Config-change tests mutate `data.json` + plugin in-memory state. A test failure before `writeConfig(fixtureConfig)` leaks the broken config into subsequent tests. Adding `beforeEach` to restore fixture + trigger reload is fragile: the hot-reload timing varies (some tests need >5s reload-settle, causing 3s waits to miss), and restore-then-reload without waiting for the MCP probe can race with the next test's early calls.
**Observed**: T9.3 (pre-existing bug) leaked into T10.1, which then skipped. Adding beforeEach with 3s wait broke T9.1 and T9.2 instead (cascading).
**Workaround**: Keep one-shot `afterAll` restore + accept that pre-existing failures (T9.3) leave state for the next test. Each test should self-restore after its own assertions. Pre-run manual touch on `main.js` if tests were previously interrupted mid-config-change.
**Root cause**: Live tests against a stateful external system (Obsidian) cannot be fully isolated without an MCP probe + bounded-wait "ready" check between every test, which would add 5s × N tests overhead.
**TODO**: If flakiness recurs, consider a `waitForMcpProbe(canary, timeoutMs)` utility that runs after every state-changing test and polls until the fixture baseline is verified.
