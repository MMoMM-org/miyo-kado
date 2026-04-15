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

## Obsidian transient disk truncation after adapter.write() — Status: RETRACTED ([#10](https://github.com/MMoMM-org/miyo-kado/issues/10))
**2026-04-15 retraction**: the "transient truncation" was a misdiagnosis on our side. It does not exist in current Obsidian.
**Obsidian team response**: `vault.read` == `adapter.read` == direct `fs.promises.readFile` (no cache). The file watcher is a watcher, not a writer. Their clean repro in the dev console showed the on-disk file at the new full length immediately after `adapter.write()`.
**Our re-verification (2026-04-15, via MCP on the real Kado server in `test/MiYo-Kado`, only `hot-reload` plugin installed, target file not open in editor)**: Create 5B → Update to 36B → disk size 36B at 0 ms / 500 ms / 2 s / 3.5 s. No truncation.
**Probable original cause**: the test file was open in the Obsidian editor at the time. The ~2 s delay we associated with "self-correction" matches exactly the editor's debounce window — the editor flushed its stale in-memory buffer onto disk, overwriting our write. That is editor behaviour, not a file-watcher race.
**Current Kado code**: `src/obsidian/note-adapter.ts::updateNote` still uses `adapter.write` as the legacy "workaround". It works correctly but bypasses the Vault API. Follow-up: switch to `vault.process`.
**Docs**: `docs/upstream-bugs/vault-cache-truncation.md` carries the full retraction notice.

<!-- 2026-04-08, updated 2026-04-15 -->
## Settings page stale after plugin reload — Status: deferred ([#9](https://github.com/MMoMM-org/miyo-kado/issues/9))
**Problem**: After a hot-reload of the plugin (dev rebuild via `npm run build`), the Obsidian settings tab continues showing the old UI and old version number. The Community Plugins page itself also shows the stale version until the user manually refreshes it; only disable/enable fully refreshes the plugin page.
**2026-04-15 finding**: This is NOT a Kado bug. Reproduced on 0.5.0, then cross-checked against **BRAT** in the same vault — BRAT behaves correctly. The difference: the **hot-reload** community plugin (used for dev loop) does not drive the same notification path that Obsidian's own "Check for updates" / official plugin-store update uses. Plugin code reloads, but Obsidian's settings & community-plugins views don't invalidate their cached DOM/version.
**What works**: a `touch data.json` triggers `onExternalSettingsChange`, which correctly re-runs `this.settingsTab.display()` and reflects changes immediately. So our lifecycle wiring is correct — the missing piece is upstream in the hot-reload plugin / Obsidian.
**Decision**: defer. Revisit after Kado is officially published in the community plugin store and can be validated through the real update path. Close issue as "cannot reproduce via official update path" until then.
**Workaround**: disable + enable the plugin in the Community Plugins page, or `touch data.json` to force an external-change refresh.

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
