# TestVault — Live Test Coverage

> Detailed test-by-test coverage for `test/live/mcp-live.test.ts` against the TestVault (`test/MiYo-Kado/`).
>
> Config source of truth: `test/fixtures/live-test-config.json`
> Quick-reference matrix: `docs/test-matrix.md`

---

## Permission Model

Kado's security promise rests on a multi-gate permission chain: **authenticate → global-scope → key-scope → datatype-permission → path-access**. This section proves the chain correctly grants operations the key is authorized for and denies everything else. Three keys exercise the full permission spectrum: full CRUD (Key1), empty scope (Key2), read-only (Key3).

### Key1 — Allowed Operations

Key1 has full CRUD on `allowed/**` and limited access on `maybe-allowed/**` (read-only for notes, no delete for frontmatter). These tests prove the positive case — operations the key is allowed to perform actually succeed.

| Test ID | Tool | Operation | Path | Assertion |
|---|---|---|---|---|
| — | kado-read | note | `allowed/Project Alpha.md` | Content contains "# Project Alpha" |
| — | kado-read | frontmatter | `allowed/Project Alpha.md` | Returns structured object {title, status, priority} |
| — | kado-read | dataview-inline-field | `allowed/Project Alpha.md` | Has completion, estimate, category |
| — | kado-read | dataview-inline-field | `maybe-allowed/Budget 2026.md` | List-item fields (amount, code, "to improve") |
| — | kado-read | dataview-inline-field | `maybe-allowed/Budget 2026.md` | Both bracket + list-item fields |
| — | kado-read | note | `allowed/Meeting Notes 2026-03-28.md` | Contains "Sprint Planning" |

### Key1 — Denied Operations

Key1 has specific deny cases: restricted write in `maybe-allowed/**` (no note.create/update, no frontmatter.create/delete, no dv.create/update), no access to `nope/` or root, no delete in `maybe-allowed/**`. These tests prove the permission chain correctly denies unauthorized operations.

| Test ID | Tool | Operation | Path | Expected |
|---|---|---|---|---|
| T2.1 | kado-write | note (create) | `maybe-allowed/_test-deny-create.md` | FORBIDDEN (note.create=false) |
| T2.2 | kado-write | note (update) | `maybe-allowed/Budget 2026.md` | FORBIDDEN (note.update=false) |
| T2.3 | kado-write | dataview-inline-field | `maybe-allowed/_test-dv.md` | FORBIDDEN (dv.create=false) |
| T2.4 | kado-read | note | `nope/Credentials.md` | FORBIDDEN (not in global scope) |
| T2.5 | kado-read | note | `Welcome.md` | FORBIDDEN (not in any path) |
| T2.6 | kado-write | note | `nope/_test-nope.md` | FORBIDDEN (not in global scope) |
| T2.8 | kado-write | frontmatter | `maybe-allowed/Budget 2026.md` | FORBIDDEN (frontmatter.create=false) |
| T2.9 | kado-write | dataview-inline-field | `maybe-allowed/Budget 2026.md` | FORBIDDEN (dv.update=false) |

### Key2 — No Access (Default Deny)

Key2 has no paths and no tags — the "revoked" or "suspended" scenario. Every operation must be denied. This proves the default-deny behaviour when a key has an empty scope.

| Test ID | Tool | Operation | Path | Expected |
|---|---|---|---|---|
| T3.1 | kado-read | note | `allowed/Project Alpha.md` | FORBIDDEN |
| T3.2 | kado-read | note | `maybe-allowed/Budget 2026.md` | FORBIDDEN |
| T3.3 | kado-read | note | `nope/Credentials.md` | FORBIDDEN |
| T3.4 | kado-write | note | `allowed/_test-key2.md` | FORBIDDEN |
| T3.5 | kado-search | byName | "Project" | FORBIDDEN or empty |
| T3.6 | kado-search | listDir | `allowed/` | FORBIDDEN or empty |
| T3.7 | kado-search | byTag | `#engineering` | FORBIDDEN or empty |
| T3.8 | kado-search | byContent | "Sprint Planning" | FORBIDDEN or empty |
| T3.9 | kado-search | byFrontmatter | `status=active` | FORBIDDEN or empty |

### Key3 — Read Only

Key3 has read-only access on `allowed/**` — the "read-only integration" scenario (e.g. a search index or analytics consumer). All reads succeed, all writes are denied, no access outside `allowed/**`.

| Test ID | Tool | Operation | Path | Expected |
|---|---|---|---|---|
| T-Key3.1 | kado-read | note | `allowed/Project Alpha.md` | Content readable |
| T-Key3.2 | kado-read | frontmatter | `allowed/Project Alpha.md` | Frontmatter readable |
| T-Key3.3 | kado-read | dataview-inline-field | `allowed/Project Alpha.md` | Inline fields readable |
| T-Key3.4 | kado-write | note (create) | `allowed/_test-key3.md` | FORBIDDEN |
| T-Key3.5 | kado-write | note (update) | `allowed/Project Alpha.md` | FORBIDDEN |
| T-Key3.6 | kado-read | note | `maybe-allowed/Budget 2026.md` | FORBIDDEN (not in key3 paths) |
| T-Key3.7 | kado-read | note | `nope/Credentials.md` | FORBIDDEN |
| T-Key3.8 | kado-write | frontmatter | `allowed/Project Alpha.md` | FORBIDDEN (frontmatter.create=false) |
| T-Key3.9 | kado-write | dataview-inline-field | `allowed/Project Alpha.md` | FORBIDDEN (dv.create=false) |
| T-Key3.10 | kado-search | byName "Project" | `allowed/` | Results include Project Alpha |
| T-Key3.11 | kado-search | listDir | `allowed/` | Directory listing works |
| T-Key3.12 | kado-search | byContent "Sprint Planning" | `allowed/` | Results found |
| T-Key3.13 | kado-search | listDir | `maybe-allowed/` | FORBIDDEN or empty |

---

## Data Operations

CRUD semantics across all supported data types (note, frontmatter, dataview inline field, binary file). These tests prove the write contract — optimistic concurrency via `expectedModified`, CONFLICT on stale timestamps, merge semantics for frontmatter, regex-based replacement for inline fields.

### Note Write — Optimistic Concurrency

The core contract for notes: create without `expectedModified` (must not exist), update with `expectedModified` from a prior read (CONFLICT if stale). Chained updates require fresh timestamps between writes.

| Test ID | Scenario | Assertion |
|---|---|---|
| — | Create: writes a new file (no expectedModified) | File created, timestamps returned |
| — | Create: rejects when file already exists | File content unchanged |
| — | Read→update: full optimistic concurrency flow | New content persisted, new timestamp |
| — | Update: rejects stale timestamp | CONFLICT, file untouched |
| — | Update: second write needs fresh timestamp | Chained updates work with re-reads |

### Frontmatter CRUD (Key1)

Frontmatter writes use `processFrontMatter` with `Object.assign` semantics — merge, not replace. These tests prove new keys can be added, existing keys updated, and that merges preserve unrelated fields.

| Test ID | Operation | Path | Expected |
|---|---|---|---|
| T-FM.0 | Create scratch note for tests | `allowed/_fm-crud-scratch.md` | Scratch file ready |
| T-FM.1 | Write new frontmatter keys | `allowed/_fm-crud-scratch.md` | Keys created, readable |
| T-FM.2 | Update existing key | `allowed/_fm-crud-scratch.md` | Merge semantics (other keys preserved) |
| T-FM.3 | Add new field | `allowed/_fm-crud-scratch.md` | All keys present (Object.assign) |

### Inline Field CRUD (Key1)

Dataview inline fields are updated via regex replacement on `[key:: value]` patterns. These tests prove updates work for bracket and numeric variants on a controlled scratch file.

| Test ID | Operation | Path | Expected |
|---|---|---|---|
| T-DV.0 | Create scratch note with inline fields | `allowed/_dv-crud-scratch.md` | Scratch file ready |
| T-DV.1 | Update bracket field `[status:: draft]` | `allowed/_dv-crud-scratch.md` | Updated to "published" |
| T-DV.2 | Update numeric field `[progress:: 0]` | `allowed/_dv-crud-scratch.md` | Updated to "100" |

### Delete (kado-delete)

Delete is the fourth CRUD operation and the first irreversible one. Notes and files are moved to the user's configured trash via `fileManager.trashFile()` — respects Obsidian's "Deleted files" setting (system trash / `.trash` folder / permanent). Frontmatter delete removes specific keys from YAML via `processFrontMatter` with the JS `delete` operator — not set-to-null. Dataview inline fields are deliberately NOT supported (regex-based line removal too risky). All delete operations require `expectedModified` for optimistic concurrency.

| Test ID | Operation | Path | Expected |
|---|---|---|---|
| T-DEL.1 | Delete note (trash) | `allowed/_del-note-scratch.md` | File gone from disk after trashFile flush |
| T-DEL.2 | Delete binary file (trash) | `allowed/_del-bin-scratch.bin` | Binary file removed |
| T-DEL.3 | Delete frontmatter keys | `allowed/_del-fm-scratch.md` | Specified keys removed, others preserved |
| T-DEL.4 | Stale `expectedModified` | any | CONFLICT, file untouched |
| T-DEL.5 | Non-existent target | `allowed/_does-not-exist.md` | NOT_FOUND |
| T-DEL.6 | operation='dataview-inline-field' | any | VALIDATION_ERROR (unsupported) |
| T-DEL.7 | Frontmatter delete without `keys` | any | VALIDATION_ERROR |
| T2.10 | Key1 delete note in `maybe-allowed/` | Budget 2026.md | FORBIDDEN (note.delete=false) |
| T2.11 | Key1 delete frontmatter in `maybe-allowed/` | Budget 2026.md | FORBIDDEN (frontmatter.delete=false) |
| T2.12 | Key1 delete note in `nope/` | Credentials.md | FORBIDDEN (outside global scope) |
| T-Key3.14 | Key3 delete note | Project Alpha.md | FORBIDDEN (note.delete=false) |
| T-Key3.15 | Key3 delete frontmatter key | Project Alpha.md | FORBIDDEN (frontmatter.delete=false) |

### Binary File Operations

Binary files flow as base64-encoded strings. These tests prove roundtrip integrity for PNG/PDF/large (150 KB) files, base64 decode on write, and that binary operations respect the same permission model as notes.

| Test ID | Tool | Key | Path | Expected |
|---|---|---|---|---|
| T11.1 | kado-read | Key1 | `allowed/test-image.png` | Valid PNG header (base64) |
| T11.2 | kado-read | Key1 | `allowed/test-document.pdf` | Valid PDF header (base64) |
| T11.3 | kado-write | Key1 | `allowed/_test-binary-scratch.bin` | Creates binary from base64 |
| T11.4 | kado-write | Key1 | `allowed/_test-binary-scratch.bin` | Update with expectedModified |
| T11.5 | kado-read | Key1 | `nope/Credentials.md` | FORBIDDEN (file op) |
| T11.6 | kado-read | Key2 | `allowed/test-image.png` | FORBIDDEN |
| T11.7 | kado-read | Key3 | `allowed/test-image.png` | Reads OK (file.read=true) |
| T11.8 | kado-write | Key3 | `allowed/_test-key3-bin.bin` | FORBIDDEN (file.create=false) |
| T11.9 | kado-read | Key1 | `allowed/test-large.bin` | 150 KB base64 roundtrip intact |

---

## Search & Scope

Search operations must respect the permission model — results are scope-filtered before pagination, tag queries honour the key's tag whitelist, and content searches never leak data from denied areas. These tests prove search enforces scope at the result level, not just at directory enumeration.

### Basic Search Operations

Smoke tests for each search operation, using Key1's broad access to verify the happy path. Every operation type (`byTag`, `byName`, `listDir`, `listTags`, `byContent`, `byFrontmatter`) has at least one passing case.

| Test ID | Operation | Query / Path | Assertion |
|---|---|---|---|
| — | byTag | `#engineering` | Finds `allowed/Project Alpha.md` |
| — | byName | "Budget" | Finds matching note name |
| — | listDir | `allowed/` | Returns 4+ items |
| — | listDir (depth:1) | `allowed/` | Direct children only, folders sorted first |
| — | listTags | — | Returns all vault tags |
| — | byContent | "Sprint Planning" | Finds `allowed/Meeting Notes...` |
| — | byFrontmatter | `status=active` | Finds active notes |

### Cursor Pagination

Pagination uses base64-encoded offset cursors. These tests prove multi-page navigation works and that cursor exhaustion matches the reported total count.

| Test ID | Scenario | Assertion |
|---|---|---|
| — | `limit:2` returns ≤2 items | Basic limit enforcement |
| T-PAG.1 | Cursor page 2 with different items | No duplicates between pages |
| T-PAG.2 | Paginate to exhaustion | Collected count matches `total` field |

### Scope Isolation

The hardest search property: a key must never see results from paths outside its scope, even when the matching content exists in a denied area. These tests prove both path and tag-based scope boundaries.

| Test ID | Scenario | Expected |
|---|---|---|
| T7.1 | byName "Report" (matches `nope/Incident Report.md`) | `nope/` paths not in results |
| T7.2 | byContent "hunter2" (only in `nope/Credentials.md`) | Zero results |
| T7.3 | listDir on `nope/` | FORBIDDEN |
| T7.4 | Read `allowed/sub/Nested Note.md` | Not FORBIDDEN (glob matches subdirs) |
| T-TAG.1 | byTag `#finance` (Key1) | Finds `maybe-allowed/Budget 2026.md` |
| T-TAG.2 | byTag `#miyo/tomo` (not in whitelist) | Empty or FORBIDDEN |
| T-SCOPE.1 | byFrontmatter `tags=finance` (Key1 vs Key3) | Key1 finds it, Key3 does not (array match) |
| T-SCOPE.2 | Key3 byContent "Budget" | Zero results (maybe-allowed outside Key3 scope) |

### listDir Edge Cases

Directory listings have several edge cases: empty dirs, deep nesting, hidden files. These tests use the dedicated `listdir-fixtures/` tree (read-only, available to Key1) to prove each edge case.

| Test ID | Scenario | Expected |
|---|---|---|
| T-LD.1 | Empty directory (`listdir-fixtures/L0/EmptyFolder/`) | Zero items (hidden `.gitkeep` filtered) |
| T-LD.2 | Unlimited depth traversal | Deep file `L0/L1/L2/L3/deep-file.md` appears |
| T-LD.3 | `depth:1` direct children only | No grandchildren |
| T-LD.4 | Hidden files excluded | `.hidden-root.md` not in results |

---

## Security

Hard security boundaries: authentication rejects invalid credentials, path handling rejects traversal attacks and encoding tricks, unicode is handled correctly. These tests prove Kado cannot be bypassed via malformed input.

### Authentication

Bearer-token auth middleware rejects invalid and missing credentials before any permission chain runs.

| Test ID | Scenario | Expected |
|---|---|---|
| — | Invalid API key | 401 / transport error |
| — | Empty authorization | 401 / transport error |

### Path Traversal & Encoding

Path-access gate rejects `..` traversal, null bytes, absolute paths, and URL-encoded bypass attempts. These tests prove there is no way to escape the vault via crafted paths.

| Test ID | Path | Expected |
|---|---|---|
| T5.1 | `../nope/Credentials.md` | VALIDATION_ERROR or FORBIDDEN |
| T5.2 | `allowed/../../nope/Credentials.md` | VALIDATION_ERROR or FORBIDDEN |
| T5.3 | `allowed/test\0.md` (null byte) | VALIDATION_ERROR or FORBIDDEN |
| T5.4 | `/etc/passwd` (absolute) | VALIDATION_ERROR or FORBIDDEN |
| T5.5 | `allowed/%2e%2e/nope/Credentials.md` | Rejected |
| T5.6 | `allowed/%252e%252e/nope/Credentials.md` | Rejected |
| T5.7 | Unicode filename create/read roundtrip | Content intact |

---

## Observability

Every operation — allowed or denied — must produce an audit entry with the correct fields. Rate limiting is enforced via HTTP 429 with standard `RateLimit-*` and `Retry-After` headers so clients can back off gracefully.

### Audit Log

Audit entries are NDJSON, one per operation, flushed asynchronously. These tests prove the log contains all required fields for allowed and denied flows, and that each key's requests are attributed to its own `apiKeyId`.

| Test ID | Scenario | Expected |
|---|---|---|
| — | File exists at configured path | `logs/kado-audit.log` exists |
| — | NDJSON format valid | Every entry has timestamp, apiKeyId, operation, decision |
| — | Allowed read logged (Key1) | operation, dataType, path, durationMs present |
| — | Denied read logged (Key1) | `gate` name included |
| — | Search logged (Key1) | `listDir` decision=allowed |
| — | Write logged (Key1) | `note` write decision=allowed |
| T-AUD.1 | Key2 denied request | Audit entry has Key2's apiKeyId |
| T-AUD.2 | Key3 allowed read | Audit entry has Key3's apiKeyId |

### Rate Limiting

Standard `RateLimit-*` headers on every response, HTTP 429 with `Retry-After` when burst exceeds the limit. The live test's `callTool()` retry loop is the reference client implementation.

| Test ID | Scenario | Expected |
|---|---|---|
| — | Normal response headers | `RateLimit-Limit`, `-Remaining`, `-Reset` present |
| — | Burst 250 requests | At least some return 429 with `Retry-After` |

---

## Configuration Lifecycle

Config changes (e.g. granting/revoking a key) must take effect after a plugin reload without requiring a server restart. These tests live in a separate file (`mcp-config-change.test.ts`) because they physically modify `data.json` and require a hot-reload cycle between assertions.

### Hot-reload Config Changes

| Scenario | Expected |
|---|---|
| Grant Key2 read access mid-session | Previously denied reads now succeed |
| Revoke Key1 path mid-session | Previously allowed reads now denied |
| Switch global to blacklist | `nope/**` blocked, others unblocked |
| Disable a key | UNAUTHORIZED on next request |
| Combined global + key list modes | Intersection enforced correctly |

---

## Remaining Gaps

Items not yet covered by live tests. All high-priority items from the original gap analysis have been implemented.

### Medium Priority — Still Open

| Category | Scenario | Why |
|---|---|---|
| Concurrency | Parallel writes to same file | Optimistic locking under contention |
| Auth | Disabled API key (enabled=false) | Only tested in unit tests, not live |
| Audit | Audit log rotation (maxSizeBytes) | Config exists but rotation not triggered |
| Edge cases | Empty file read (0-byte .md) | No empty fixture file yet |
| Edge cases | Very long path names | Path near filesystem limits |
| Edge cases | Frontmatter edge cases | Empty frontmatter, invalid YAML, nested objects |
| Read | Key1 frontmatter read from maybe-allowed | Allowed but not exercised |

### Low Priority — Still Open

| Category | Scenario | Why |
|---|---|---|
| Binary | File size limits (>1 MB) | No large fixture beyond 150 KB |
| Read | Key3 file read from maybe-allowed | FORBIDDEN expected, not verified |
