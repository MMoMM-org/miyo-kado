# Obsidian bug report — Vault cache truncation after `adapter.write()`

> Status: **filed upstream**, workaround in place
> Upstream report: https://forum.obsidian.md/t/vault-cache-truncation-after-adapter-write/113139
> First seen: 2026-04-01 (Kado v1 hardening)
> Affects: Plugin authors who write files via the Vault API and verify on disk
> Workaround location: `src/obsidian/note-adapter.ts:53-61`
> Diagnostic test: `test/diagnostics/diag-truncation.test.ts` (when present)

## Summary

When a plugin writes a file whose new content is **larger** than the previous file size, Obsidian's internal file watcher transiently overwrites the file on disk with stale in-memory cache (truncated to the **previous** file size) before self-correcting in roughly 1–2 seconds.

During the transient window, anything that reads the file from disk (e.g. `node:fs.readFileSync`, an external sync tool, an integration test, or another plugin) sees a truncated copy. `vault.read()` is unaffected because it serves from the in-memory cache, which has the new content the entire time.

The truncation **always self-corrects** without further plugin action — the watcher rereads the disk content and reconciles. But for ~1–2s the on-disk state and the cache state disagree.

## Environment

- **Obsidian version:** *(fill in current desktop version)*
- **OS:** macOS *(also reproduced on Linux via Docker live tests)*
- **Plugin context:** Custom plugin writing markdown notes via `app.vault.adapter.write()` and verifying via `node:fs/promises.readFile()` in an integration test harness running in the same process / vault.

## Reproduction

Minimum reproducible scenario in any plugin:

```typescript
// 1. Create a small file
await app.vault.create('test.md', 'Hello');           // 5 bytes

// 2. Read it back via vault — fine
const cached1 = await app.vault.read(file);            // "Hello"
// readFileSync('test.md') === 'Hello'                 // ✓

// 3. Update with LARGER content
await app.vault.adapter.write('test.md',
  'Dies ist ein deutlich längerer Text');             // 36 bytes

// 4. Read immediately
const cached2 = await app.vault.read(file);            // ✓ correct, 36 bytes
const onDisk = readFileSync('test.md', 'utf-8');       // ❌ "Dies " (5 bytes!)

// 5. Wait ~2 seconds
await sleep(2000);
const onDiskLater = readFileSync('test.md', 'utf-8');  // ✓ correct, 36 bytes
```

### Verified size matrix

| Operation | Disk state immediately | Disk state after ~2s |
|-----------|-----------------------|----------------------|
| Create 5-byte file | `"Hello"` ✓ | unchanged ✓ |
| Update same size (5 → 5 bytes) | correct ✓ | correct ✓ |
| Update smaller (36 → 5 bytes) | correct ✓ | correct ✓ |
| **Update larger (5 → 36 bytes)** | **truncated to 5 bytes** ❌ | **correct, 36 bytes** ✓ |

The trigger is **growing** content with respect to the previous on-disk size. Same-size and shrinking writes are unaffected.

### Why we believe this is a watcher race

- `vault.adapter.write()` writes the correct full bytes via Node's `fs` module — verified by inserting a `readFileSync` call directly between `write()` and the next event loop tick: the bytes are right.
- A few milliseconds later, the file watcher fires and the on-disk content drops back to the **previous** `file.stat.size` worth of bytes.
- ~1–2s later, the watcher fires again and the file is restored to the new full content.

This pattern is consistent with the watcher running its reconciliation path and using a stale `file.stat.size` for an `ftruncate`-like operation, then re-reading and correcting.

## Impact on plugins

| Use case | Affected? |
|----------|-----------|
| User editing notes in the Obsidian editor | No — editor reads from cache |
| Plugin reading via `vault.read()` | No — cache is correct throughout |
| Plugin reading via `vault.adapter.read()` | **Yes** — adapter reads from disk |
| Plugin reading via `node:fs` directly | **Yes** |
| External sync tools (Syncthing, rsync, Git) | **Yes** — may sync truncated state |
| Integration tests verifying writes via `readFileSync` | **Yes** — flaky without delays |
| MCP servers / remote clients reading via the Vault API | No |

## What we tried before settling on the workaround

| Approach | Outcome |
|----------|---------|
| `vault.modify(file, content)` | Same truncation symptom — cache flush uses stale `stat.size` |
| `vault.process(file, fn)` | Same truncation symptom under the same growing-content conditions |
| `adapter.write` followed by `vault.read` to "warm" the cache | Triggers an additional flush, causing a *second* truncation race |
| `adapter.write` only, then read `stat` via `adapter.stat` | **Works** — the file watcher self-corrects, and we never re-touch the cache after the write |

## Current workaround in Kado

`src/obsidian/note-adapter.ts:50-61`:

```typescript
async function updateNote(app: App, request: CoreWriteRequest): Promise<CoreWriteResult> {
    const file = app.vault.getFileByPath(request.path);
    if (!file) throw notFoundError(request.path);
    // Obsidian bug: vault.modify()/process()/read() after adapter.write() can
    // truncate the file back to the previous size. Any vault cache interaction
    // triggers an internal flush with stale stat.size. Workaround: write ONLY
    // via adapter, get stat from adapter, and let Obsidian discover the change
    // through its file watcher (which correctly re-reads the full file).
    await app.vault.adapter.write(file.path, request.content as string);
    const stat = (await app.vault.adapter.stat(file.path)) ?? file.stat;
    return {path: request.path, created: stat.ctime, modified: stat.mtime};
}
```

This violates the Obsidian Plugin Guidelines recommendation *"Prefer the Vault API over the Adapter API"*, but is the only approach we found that consistently produces correct on-disk state without requiring an artificial delay.

We are deliberately **not** doing any of the following after `adapter.write()`, because each one re-triggers the truncation race:
- `vault.read(file)`
- `vault.modify(file, ...)`
- `vault.process(file, ...)`
- `vault.cachedRead(file)`

Reading `app.vault.adapter.stat(path)` is safe — it goes straight to the filesystem and does not touch the cache.

## Expected behaviour (from the plugin author's perspective)

After `await vault.modify(file, content)` (or equivalently `vault.process` / `adapter.write`) resolves:

1. `vault.read(file)` returns `content` — **already true today**
2. `app.vault.adapter.read(file.path)` returns `content` — **currently false in the truncation window**
3. Any external observer reading the file from disk sees `content` — **currently false in the truncation window**

In other words: when an `await`ed write resolves, the file should be persisted in its final state, with no further reconciliation pending.

## Related code paths in Kado

- `src/obsidian/note-adapter.ts:50` — `updateNote()` uses the adapter-only workaround
- `src/obsidian/inline-field-adapter.ts:243` — `writeFields()` uses `vault.process()` because inline-field updates rarely grow content significantly. If the truncation race is reproducible there too, this will need the same workaround. *(Add a note here once verified.)*
- `src/obsidian/file-adapter.ts:70` — `vault.modifyBinary` for binary files. No `processBinary` API exists; behaviour under the truncation race is **unverified**.
- `test/live/mcp-live.test.ts` — live integration tests verify writes via `node:fs.readFileSync`. The current `updateNote` workaround makes these stable; changing the strategy would re-introduce flakiness.

## Suggested upstream fix (priorities, low to high)

1. **Documentation**: clearly state in the Vault API docs that on-disk state may transiently lag the cache state by 1–2s after a write that grows the file. Plugin authors who only read via `vault.read()` are unaffected and don't need to care; everyone else needs to know.
2. **API**: provide a way to await full disk reconciliation, e.g. `await app.vault.flush(file)` or have `vault.modify()` not resolve until the watcher reconciliation has completed.
3. **Bug fix**: have the cache flush use the *current* in-memory content's byte length for `ftruncate`, not the stale `file.stat.size`. This appears to be the root cause: the watcher reconciliation truncates to the previous size before re-reading the new bytes.

## References / prior art

- Obsidian Forum: discussions of `vault.process` and `vault.modify` debounce / race conditions *(link when filing)*
- Templater issue: `vault.modify()` race condition *(silverbullet/templater #1629 — link when filing)*
- Kado MCP Gateway internal diagnostic: `test/diagnostics/diag-truncation.test.ts` (if/when re-added)
- Internal memory: `obsidian_write_timing.md` (Kado AI memory)

## Filing status

Filed on the Obsidian community forum on 2026-04-08:
**https://forum.obsidian.md/t/vault-cache-truncation-after-adapter-write/113139**

(GitHub is not used for Obsidian bug reports — the forum is the official channel.)

Track responses there. When the upstream fix lands or a Vault-API path
is found that doesn't trigger the race, revisit `note-adapter.ts:50` and
remove the workaround.
