# Troubleshooting Archive — 2026-06

<!-- Resolved entries moved out of docs/ai/memory/troubleshooting.md by /memory-cleanup. -->
<!-- Not loaded at session start. Kept for history. -->

<!-- archived 2026-06-15 (was 2026-04-14) -->
## byFrontmatter does not match against array values — Status: resolved
**Problem**: `kado-search byFrontmatter query=<key>=<value>` did only a scalar string comparison. When the value was an array (`tags: [finance, planning]` or list-form), queries like `tags=finance` returned no results — failing for the most common Obsidian tag formats documented at https://obsidian.md/help/tags.
**Fix (2026-04-14)**: Added `frontmatterValueMatches()` in `src/obsidian/search-adapter.ts` that supports all three valid Obsidian frontmatter tag formats:
  - Arrays (from list-form or inline `[a, b]`) → case-insensitive element membership
  - Comma-separated strings (`tags: a, b`) → case-insensitive element check after split/trim
  - Scalars → case-insensitive equality (unchanged)
**Tests**: 5 new unit tests in `test/obsidian/search-adapter.test.ts` cover array/list/comma/case-insensitive/non-member. Live test `T-SCOPE.1` in `test/live/mcp-live.test.ts` validates end-to-end with `tags=finance`.

<!-- archived 2026-06-15 (was 2026-04-14, resolved 2026-04-15) -->
## T9.3 blacklist permission semantic inconsistency — Status: resolved ([#8](https://github.com/MMoMM-org/miyo-kado/issues/8))
**Problem**: With Key in blacklist mode and entry `maybe-allowed/** → {note: {create: false, read: true, update: true, delete: true}}`, reads were denied even though `note.read: true` should allow them.
**Root cause**: `resolveScope()` called `invertPermissions(match.permissions)` on any matched blacklist entry. That meant a flag of `true` was interpreted as "blocked" (design said "flags represent what is BLOCKED"). The UI and config mental model is the opposite: `true` = allowed, same as whitelist. So the inversion was the bug.
**Fix (2026-04-15)**: `resolveScope` now returns the matched entry's permissions literally for both modes. The only difference between modes is the default for unlisted paths: whitelist → null (no access), blacklist → `createAllPermissions()` (full access).
**Verification**: live MCP test with the T9.3 config (key in blacklist, maybe-allowed/** with `note.create=false, note.read=true`):
- read `maybe-allowed/Budget 2026.md` → ALLOWED ✓
- create `maybe-allowed/new-file.md` → FORBIDDEN with `Key does not have 'create' permission for data type 'note'` ✓
**Unit tests**: `test/core/gates/scope-resolver.test.ts` and `test/core/gates/datatype-permission.test.ts` rewritten for the literal semantic; added a direct T9.3 repro + literal-flag-per-CRUD coverage.
**Cleanup (2026-06-13, [#66](https://github.com/MMoMM-org/miyo-kado/issues/66))**: `invertPermissions` removed from `scope-resolver.ts` along with its direct tests — it had no production caller after the literal-semantics fix.

<!-- archived 2026-06-15 (was RETRACTED 2026-04-15); follow-up "switch to vault.process" since COMPLETED — note-adapter.ts::updateNote now uses vault.process -->
## Obsidian transient disk truncation after adapter.write() — Status: RETRACTED ([#10](https://github.com/MMoMM-org/miyo-kado/issues/10))
**2026-04-15 retraction**: the "transient truncation" was a misdiagnosis on our side. It does not exist in current Obsidian.
**Obsidian team response**: `vault.read` == `adapter.read` == direct `fs.promises.readFile` (no cache). The file watcher is a watcher, not a writer. Their clean repro in the dev console showed the on-disk file at the new full length immediately after `adapter.write()`.
**Our re-verification (2026-04-15, via MCP on the real Kado server in `test/MiYo-Kado`, only `hot-reload` plugin installed, target file not open in editor)**: Create 5B → Update to 36B → disk size 36B at 0 ms / 500 ms / 2 s / 3.5 s. No truncation.
**Probable original cause**: the test file was open in the Obsidian editor at the time. The ~2 s delay we associated with "self-correction" matches exactly the editor's debounce window — the editor flushed its stale in-memory buffer onto disk, overwriting our write. That is editor behaviour, not a file-watcher race.
**Follow-up (COMPLETED)**: `note-adapter.ts::updateNote` was migrated from the legacy `adapter.write` workaround to `app.vault.process` — verified in `src/obsidian/note-adapter.ts`.
**Docs**: `docs/upstream-bugs/vault-cache-truncation.md` carries the full retraction notice.
