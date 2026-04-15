# RETRACTED — Vault cache truncation after `adapter.write()`

> **Status: RETRACTED on 2026-04-15.** The described bug does not exist.
> Upstream report (for reference): https://forum.obsidian.md/t/vault-cache-truncation-after-adapter-write/113139
> Retraction verified by: live MCP test in the Kado test vault + Obsidian-team clean repro in their dev console.

## Why this is retracted

On 2026-04-15 the Obsidian team responded to the forum post and could not reproduce the behaviour. Their dev-console repro:

```js
let file = await app.vault.create('test.md', 'Hello');
console.log(await app.vault.read(file));
await app.vault.adapter.write('test.md', 'Dies ist ein deutlich längerer Text');
console.log(await app.vault.read(file));
console.log(require('fs').readFileSync(app.vault.adapter.basePath + '/test.md', 'utf-8'));
// Hello
// Dies ist ein deutlich längerer Text
// Dies ist ein deutlich längerer Text
```

They also clarified:

- `vault.read` == `adapter.read` == a direct `fs.promises.readFile`. There is no cache layer.
- The file watcher is a *watcher*, not a writer. It does not mutate file contents.
- The 2-second delay we associated with "self-correction" matches Obsidian's editor debounce. If a test target file was open in the editor, the editor's in-memory buffer would flush after 2s and overwrite the disk write with the pre-write state — which is exactly what we saw and misattributed to Obsidian internals.

## Local verification

Re-tested on 2026-04-15 in `test/MiYo-Kado` (only the `hot-reload` community plugin installed, target file NOT open in the editor) by driving the real Kado MCP server over HTTP:

| Step | File size | Content |
|------|-----------|---------|
| `kado-write` create "Hello" (5B) | 5 | "Hello" |
| `kado-write` update to 36B (via adapter.write) | 36 | full text |
| FS read at 0 ms after update | 36 | full text |
| FS read at 500 ms | 36 | full text |
| FS read at 2 s | 36 | full text |
| FS read at 3.5 s | 36 | full text |

No truncation observed at any point. The bug as previously described is not real.

## What the misdiagnosis cost us

- `src/obsidian/note-adapter.ts::updateNote` uses `adapter.write` instead of `vault.process`. Works correctly but violates the "prefer Vault API" guideline. Planned follow-up: switch to `vault.process`.
- Live tests added a 2 s sleep after writes that grow the file. Still produces correct results but adds unnecessary latency.

## If you landed here via a search result

- There is no `adapter.write` truncation bug in current Obsidian.
- If you observe truncation after a write: check whether the target file was open in an editor at the time (editor debounce ~2 s) or whether another installed plugin intercepts vault/adapter calls.
- See also: `docs/ai/memory/troubleshooting.md` (retraction entry), forum thread above.
