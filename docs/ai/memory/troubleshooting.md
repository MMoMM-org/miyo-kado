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

## MCP SDK has no 429 rate-limit handling — Status: upstream-tracked (closed in Kado)
**Problem**: `@modelcontextprotocol/sdk` `StreamableHTTPClientTransport` surfaces a plain `SdkError` (formerly `StreamableHTTPError`) on 429 responses. It does not read `Retry-After` or `RateLimit-*` headers and does not implement automatic backoff. This is an SDK-level gap, not Kado-specific — every MCP server returning 429 is affected.
**Impact**: MCP clients (Claude, custom agents) that don't add their own retry logic fail-fast on rate limits instead of waiting and retrying.
**Kado server-side**: emits `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` on every response and `Retry-After` on 429 — all headers the SDK would need are already there.
**Client workaround**: `test/live/mcp-live.test.ts` (`probeRetryAfter()` + `callTool()` retry loop) is the reference implementation users can copy until the SDK ships this natively.
**Upstream**: filed 2026-04-15 as [modelcontextprotocol/typescript-sdk#1892](https://github.com/modelcontextprotocol/typescript-sdk/issues/1892). Verified beforehand: no existing upstream issue or PR on the topic, and the transport-spec files (2024-11-05 → draft) don't mention rate limiting at all.
**Kado tracking**: [#11](https://github.com/MMoMM-org/miyo-kado/issues/11) closed — nothing else actionable on our side until upstream moves. If #11 reappears downstream, reference the upstream issue first.

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

<!-- 2026-04-14, resolved 2026-04-15 -->
## T9.3 blacklist permission semantic inconsistency — Status: resolved ([#8](https://github.com/MMoMM-org/miyo-kado/issues/8))
**Problem**: With Key in blacklist mode and entry `maybe-allowed/** → {note: {create: false, read: true, update: true, delete: true}}`, reads were denied even though `note.read: true` should allow them.
**Root cause**: `resolveScope()` called `invertPermissions(match.permissions)` on any matched blacklist entry. That meant a flag of `true` was interpreted as "blocked" (design said "flags represent what is BLOCKED"). The UI and config mental model is the opposite: `true` = allowed, same as whitelist. So the inversion was the bug.
**Fix (2026-04-15)**: `resolveScope` now returns the matched entry's permissions literally for both modes. The only difference between modes is the default for unlisted paths: whitelist → null (no access), blacklist → `createAllPermissions()` (full access).
**Verification**: live MCP test with the T9.3 config (key in blacklist, maybe-allowed/** with `note.create=false, note.read=true`):
- read `maybe-allowed/Budget 2026.md` → ALLOWED ✓
- create `maybe-allowed/new-file.md` → FORBIDDEN with `Key does not have 'create' permission for data type 'note'` ✓
**Unit tests**: `test/core/gates/scope-resolver.test.ts` and `test/core/gates/datatype-permission.test.ts` rewritten for the literal semantic; added a direct T9.3 repro + literal-flag-per-CRUD coverage.
**Note for future**: `invertPermissions` is still exported from `scope-resolver.ts` as an unused utility; remove in a later cleanup.

## Live test state isolation — Status: known
**Problem**: Config-change tests mutate `data.json` + plugin in-memory state. A test failure before `writeConfig(fixtureConfig)` leaks the broken config into subsequent tests. Adding `beforeEach` to restore fixture + trigger reload is fragile: the hot-reload timing varies (some tests need >5s reload-settle, causing 3s waits to miss), and restore-then-reload without waiting for the MCP probe can race with the next test's early calls.
**Observed**: T9.3 (pre-existing bug) leaked into T10.1, which then skipped. Adding beforeEach with 3s wait broke T9.1 and T9.2 instead (cascading).
**Workaround**: Keep one-shot `afterAll` restore + accept that pre-existing failures (T9.3) leave state for the next test. Each test should self-restore after its own assertions. Pre-run manual touch on `main.js` if tests were previously interrupted mid-config-change.
**Root cause**: Live tests against a stateful external system (Obsidian) cannot be fully isolated without an MCP probe + bounded-wait "ready" check between every test, which would add 5s × N tests overhead.
**TODO**: If flakiness recurs, consider a `waitForMcpProbe(canary, timeoutMs)` utility that runs after every state-changing test and polls until the fixture baseline is verified.
