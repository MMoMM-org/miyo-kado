# How It Works

## Architecture

Kado follows a four-layer architecture with clean boundaries. No layer imports from the one above it.

```
MCP Client -> [MCP API Handler] -> [Kado Core] -> [Obsidian Interface] -> Vault
```

| Layer | Responsibility | Imports |
|-------|---------------|---------|
| **MCP API Handler** | HTTP transport, auth, rate limiting, request/response mapping | MCP SDK, Express |
| **Kado Core** | Permission gates, routing, concurrency guard | Nothing external |
| **Obsidian Interface** | Vault adapters for notes, frontmatter, files, inline fields, search | Obsidian API |
| **Types** | Canonical request/result/error types shared across layers | Nothing |

The core layer has zero dependencies on Obsidian or the MCP SDK. This means the entire permission model can be tested without either runtime.

## Security Model

Every request passes through five gates in order. The first denial stops the chain.

| # | Gate | Purpose |
|---|------|---------|
| 0 | `authenticate` | Bearer token must match an enabled API key |
| 1 | `global-scope` | Path must be inside the global whitelist (or outside the blacklist) |
| 2 | `key-scope` | Path must be inside the key's own scope |
| 3 | `datatype-permission` | Key must have the required CRUD flag for the data type |
| 4 | `path-access` | Final path-traversal and validation check |

Global security and each API key independently configure **whitelist** or **blacklist** mode. Both scopes can use **tags** for search operations.

## Enforcement Logic

Kado's guiding principle: **Global defines the ceiling. Keys define the subset.** Every request is evaluated against *both* layers and both must agree. A key can never exceed what global permits -- it can only further restrict.

### The Two-Layer Check

For every incoming MCP request, Kado does this in order:

1. **Authenticate the caller.** The Bearer token must match an enabled API key. If not -> denied at gate `authenticate`.
2. **Resolve the global scope for the request path.** The global list mode decides how to interpret the paths list:
   - *Whitelist mode:* find a path entry that matches the request path. If no match -> denied at gate `global-scope`. If matched, the entry's permissions become the **global ceiling** for this request.
   - *Blacklist mode:* find a path entry that matches. If no match -> the request path is *not listed as forbidden*, so the global ceiling is **full access**. If matched, the entry's permissions are **inverted** and applied as blocks -- a `true` value means "this operation is blocked", a `false` value means "not blocked".
3. **Check the global ceiling for the requested data type and operation.** For example, a request to update frontmatter at `allowed/doc.md` checks `global.allowed[FM].update`. If the ceiling says `false` -> denied at gate `datatype-permission` (sub-reason: global).
4. **Resolve the key scope for the same path**, using the key's *own* list mode (independent of global). Same rules as step 2, but applied to the key's path list. If the path isn't in the key's scope -> denied at gate `key-scope`.
5. **Check the key's permission for the data type and operation.** Same as step 3, but against the key. If the key says `false` -> denied at gate `datatype-permission` (sub-reason: key).
6. **Final path-access validation** (traversal checks, canonicalization) at gate `path-access`.

Only if all gates pass is the request allowed. The result is effectively `global_permission AND key_permission` for every operation -- an intersection.

### The Four List-Mode Combinations

Because global and keys each have an independent whitelist/blacklist toggle, there are four possible combinations.

**Combo 1 -- Global=Whitelist, Key=Whitelist** (most common)

- *Global says:* "Only `allowed/**` with Note:CRUD is accessible."
- *Key says:* "Only `allowed/**` with Note:CR is accessible for this key."
- *Result:* The key can `Create` and `Read` notes in `allowed/**`. Straightforward intersection -- whatever is in both lists is allowed.

**Combo 2 -- Global=Whitelist, Key=Blacklist**

- *Global says:* "Only `allowed/**` with Note:CRUD is accessible."
- *Key says:* "Within what global allows, block Note:Update on `allowed/**`."
- *Enforcement:* Global whitelist resolves first -> only `allowed/**` Note:CRUD is in scope at all. Then the key's blacklist removes `Update` from that scope.
- *Result:* The key can `Create`, `Read`, `Delete` notes in `allowed/**`. `Update` is blocked by the key.

**Combo 3 -- Global=Blacklist, Key=Whitelist**

- *Global says:* "Everything is accessible except `secret/**`."
- *Key says:* "Only `allowed/**` with Note:CR is accessible for this key."
- *Enforcement:* Global blacklist resolves first -> every path except `secret/**` is eligible. The key's whitelist then narrows that to just `allowed/**` Note:CR.
- *Result:* The key can `Create` and `Read` notes in `allowed/**`. Everything else is denied either by the global blacklist (`secret/**`) or because the key's whitelist doesn't list it.

**Combo 4 -- Global=Blacklist, Key=Blacklist**

- *Global says:* "Everything is accessible except `secret/**`."
- *Key says:* "Within what global allows, block Note:Delete on `drafts/**`."
- *Enforcement:* Global blacklist removes `secret/**` entirely. The key's blacklist then additionally removes `Delete` from `drafts/**`.
- *Result:* The key can access everything except `secret/**` (global block) and cannot delete notes in `drafts/**` (key block). Everything else is allowed.

## Whitelist / Blacklist Mode Flip

Flipping the Access Mode toggle **does not change any permission values**. It only changes how the same config is *interpreted*. This means you can flip the toggle without losing your configuration.

Same config, two interpretations:

| Config value | Whitelist mode | Blacklist mode |
|--------------|----------------|----------------|
| `true` | Permission is **granted** | Permission is **not blocked** |
| `false` | Permission is **not granted** | Permission is **blocked** |

**Example** -- a path with `Note: C=true, R=true, U=false, D=disabled`:

- **In Whitelist mode**: user can `Create` and `Read` notes. Cannot `Update` (not selected). `Delete` unavailable.
- **In Blacklist mode** (same booleans): `Create` and `Read` are *not blocked* = allowed. `Update` is *explicitly blocked*. `Delete` still unavailable.

Effective permissions are identical -- the mental model differs. Whitelist is "list what's allowed"; blacklist is "list what's forbidden". Pick whichever reads more naturally for your setup.

## Scope Intersection

A request must pass **both** the global scope and the key scope. The effective permission is the intersection:

```
Global: Calendar (Read only)
Key:    Calendar (Read + Write)
Result: Calendar (Read only)  -- global wins
```

```
Global: Calendar, Atlas, 100 Inbox
Key:    Calendar only
Result: Calendar only  -- key restricts further
```

### Edge Case: Global Security Changed After Key Config

If you grant a key a permission (e.g. `Note: Update` on `allowed/**`), and later **remove** that permission from Global Security:

1. **The key's stored config is not rewritten.** Each scope stores only its own values -- cross-referencing happens at render time.
2. **The UI shows a greyed-out checkbox** on the stale permission so you can see it was granted but is no longer available globally.
3. **At runtime, the enforcement engine denies the request.** Global wins -- `key.update=true AND global.update=false` -> denied.
4. **If you re-enable the permission globally**, the key's previous selection becomes active again automatically.

You can safely tighten Global Security without touching individual keys -- restrictions propagate immediately at runtime.

## Key Properties to Remember

- **Global is the ceiling.** A key can never grant itself more than global allows.
- **The list mode is only a rendering/interpretation choice**, not a stored permission. Flipping the toggle never changes the underlying boolean values.
- **Both layers are always checked**, regardless of their individual modes.
- **Denials include the gate name in the audit log** (`authenticate`, `global-scope`, `key-scope`, `datatype-permission`, `path-access`).
- **Default-deny stays default-deny.** If any layer has no matching path in whitelist mode, the request is denied. There is no fallback.

## Audit Log

Kado writes one JSON object per line (NDJSON) to `<log-directory>/kado-audit.log`. Every request gets one entry -- allowed or denied. **Content is never logged**: only metadata (who, what, where, decision).

Example lines:

```json
{"timestamp":"2026-03-31T14:29:06.365+02:00","apiKeyId":"kado_9e1d...","operation":"read","dataType":"note","path":"Projects/doc.md","decision":"allowed"}
{"timestamp":"2026-03-31T14:29:07.100+02:00","apiKeyId":"kado_9e1d...","operation":"update","dataType":"frontmatter","path":"Projects/doc.md","decision":"denied","gate":"datatype-permission"}
```

| Field | Description |
|-------|-------------|
| `timestamp` | ISO 8601 with local timezone offset |
| `apiKeyId` | Truncated key ID of the caller |
| `operation` | `read` / `create` / `update` / `delete` / `search` |
| `dataType` | `note` / `frontmatter` / `dataview-inline-field` / `file` |
| `path` | Vault-relative path (or search query descriptor for search ops) |
| `decision` | `allowed` or `denied` |
| `gate` | On denial only: which permission gate rejected the request |

When the log reaches **Max log size** (configured in the General tab), the file is rotated (`kado-audit.log.1`, `.2`, ...) and older rotations beyond **Retained logs** are deleted.

## Known Edge Cases

### Editing a note the AI wants access to

- **Edit-while-reading gap.** If you're actively typing in a note and your AI assistant reads it via Kado at the same moment, the assistant may see the version from up to 2 seconds ago -- Obsidian saves your edits to disk on a ~2 second pause. Pause briefly (or press Cmd/Ctrl+S) before asking the AI about your most recent sentence.
- **Write while the same note is open and dirty.** If an AI tries to write to a note you are currently editing with unsaved keystrokes, Kado refuses the write with a `CONFLICT` error and shows a Notice ("Kado wanted to modify *\<note\>* ..."). Your typing always wins. The AI client sees the same conflict signal used for any concurrent change and is expected to re-read and retry, so once you pause typing (about 2 s for Obsidian autosave) and it retries, its write is applied on top of your latest edits.
