# Troubleshooting — Kado
<!-- Known issues and proven fixes. Updated: 2026-06-15 -->
<!-- Format: ## [Issue title] — Status: open/resolved — [fix description] -->
<!-- Resolved entries are archived by /memory-cleanup, not deleted -->

## MCP SDK has no 429 rate-limit handling — Status: upstream-tracked (closed in Kado)
**Problem**: `@modelcontextprotocol/sdk` `StreamableHTTPClientTransport` surfaces a plain `SdkError` (formerly `StreamableHTTPError`) on 429 responses. It does not read `Retry-After` or `RateLimit-*` headers and does not implement automatic backoff. This is an SDK-level gap, not Kado-specific — every MCP server returning 429 is affected.
**Impact**: MCP clients (Claude, custom agents) that don't add their own retry logic fail-fast on rate limits instead of waiting and retrying.
**Kado server-side**: emits `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` on every response and `Retry-After` on 429 — all headers the SDK would need are already there.
**Client workaround**: `test/live/mcp-live.test.ts` (`probeRetryAfter()` + `callTool()` retry loop) is the reference implementation users can copy until the SDK ships this natively.
**Upstream**: filed 2026-04-15 as [modelcontextprotocol/typescript-sdk#1892](https://github.com/modelcontextprotocol/typescript-sdk/issues/1892) — still OPEN as of 2026-06-15. Verified beforehand: no existing upstream issue or PR on the topic, and the transport-spec files (2024-11-05 → draft) don't mention rate limiting at all.
**Kado tracking**: [#11](https://github.com/MMoMM-org/miyo-kado/issues/11) closed — nothing else actionable on our side until upstream moves. If #11 reappears downstream, reference the upstream issue first.

<!-- 2026-04-08, updated 2026-04-15 -->
## Settings page stale after plugin reload — Status: deferred ([#9](https://github.com/MMoMM-org/miyo-kado/issues/9))
**Problem**: After a hot-reload of the plugin (dev rebuild via `npm run build`), the Obsidian settings tab continues showing the old UI and old version number. The Community Plugins page itself also shows the stale version until the user manually refreshes it; only disable/enable fully refreshes the plugin page.
**2026-04-15 finding**: This is NOT a Kado bug. Reproduced on 0.5.0, then cross-checked against **BRAT** in the same vault — BRAT behaves correctly. The difference: the **hot-reload** community plugin (used for dev loop) does not drive the same notification path that Obsidian's own "Check for updates" / official plugin-store update uses. Plugin code reloads, but Obsidian's settings & community-plugins views don't invalidate their cached DOM/version.
**What works**: a `touch data.json` triggers `onExternalSettingsChange`, which correctly re-runs `this.settingsTab.display()` and reflects changes immediately. So our lifecycle wiring is correct — the missing piece is upstream in the hot-reload plugin / Obsidian.
**Decision**: defer. Revisit after Kado is officially published in the community plugin store and can be validated through the real update path. Close issue as "cannot reproduce via official update path" until then.
**Workaround**: disable + enable the plugin in the Community Plugins page, or `touch data.json` to force an external-change refresh.

<!-- 2026-06-18 -->
## Dirty-editor guard false-positive on property notes — Status: resolved
**Problem**: Every assistant write to a note that has YAML frontmatter (properties) was rejected with CONFLICT + the "Kado wanted to modify … pause typing" Notice, even with zero edits — and cmd+s, switching notes, or typing elsewhere never cleared it.
**Root cause**: `isFileOpenAndDirty` (`src/obsidian/note-adapter.ts`) decided "dirty" via a raw byte compare `view.getViewData() !== await vault.cachedRead(file)`. Obsidian's Properties widget re-serializes frontmatter in canonical form (key order, quoting, empty-array style), so `getViewData()` never byte-matches the on-disk YAML for a property note. cmd+s can't fix it: Obsidian sees no user edit, so the save is a no-op and the normalized buffer is never flushed. The guard only inspects the target file's leaf (kept open in its tab), so what you type elsewhere is irrelevant.
**Fix**: `contentsEquivalent` — compare body verbatim, frontmatter semantically (`parseYaml` both sides + key-sorted JSON canonicalize). Only flag dirty on a real body or frontmatter-value change. Defensive: non-string cachedRead → treat as dirty (no throw).
**Invisible to tests**: the obsidian mock's `getLeavesOfType` returns `[]` by default, so the guard never fired — same class as the renameFile live-only bug. New tests stub a leaf + `cachedRead` explicitly.

## Live test state isolation — Status: known
**Problem**: Config-change tests mutate `data.json` + plugin in-memory state. A test failure before `writeConfig(fixtureConfig)` leaks the broken config into subsequent tests. Adding `beforeEach` to restore fixture + trigger reload is fragile: the hot-reload timing varies (some tests need >5s reload-settle, causing 3s waits to miss), and restore-then-reload without waiting for the MCP probe can race with the next test's early calls.
**Observed**: T9.3 (pre-existing bug) leaked into T10.1, which then skipped. Adding beforeEach with 3s wait broke T9.1 and T9.2 instead (cascading).
**Workaround**: Keep one-shot `afterAll` restore + accept that pre-existing failures (T9.3) leave state for the next test. Each test should self-restore after its own assertions. Pre-run manual touch on `main.js` if tests were previously interrupted mid-config-change.
**Root cause**: Live tests against a stateful external system (Obsidian) cannot be fully isolated without an MCP probe + bounded-wait "ready" check between every test, which would add 5s × N tests overhead.
**TODO**: If flakiness recurs, consider a `waitForMcpProbe(canary, timeoutMs)` utility that runs after every state-changing test and polls until the fixture baseline is verified.
