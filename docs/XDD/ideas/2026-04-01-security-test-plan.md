# Security Test Plan — Kado MCP Gateway

> Comprehensive security test plan for the permission enforcement pipeline.
> Tests run against a live Obsidian instance with the test vault.

## Test Environment

### Vault: `test/MiYo-Kado/`

```
allowed/           ← Global: full CRUD all types
maybe-allowed/     ← Global: full CRUD except frontmatter create/delete
nope/              ← Not in global security → denied
Welcome.md         ← Root file, not in any path → denied
```
**Note:** we probably need some more files and directories to test the full feature set.
also the files must be more diverse.. wildcard search, different dataview, frontmatter etc.


### Keys

| Key | Label | ListMode | Paths | Tags |
|-----|-------|----------|-------|------|
| Key1 | `kado_9e1d...` | whitelist | `allowed/**` (note.delete=false), `maybe-allowed/**` (restricted) | `inlinetag/yes` |
| Key2 | `kado_e8ff...` | whitelist | (none) | (none) |

### Permission Matrix Summary

**Global Security** (whitelist):

| Path | Note | Frontmatter | File | DataviewInlineField |
|------|------|-------------|------|---------------------|
| `allowed/**` | CRUD | CRUD | CRUD | CRUD |
| `maybe-allowed/**` | CRUD | _R_U_ | CRUD | CRUD |

**Key1** (whitelist):

| Path | Note | Frontmatter | File | DataviewInlineField |
|------|------|-------------|------|---------------------|
| `allowed/**` | CR_U_ | CRUD | CRUD | CRUD |
| `maybe-allowed/**` | _R___ | _R_U_ | CRUD | _R___ |

**Key2** (whitelist): no paths → all denied.

**Effective Key1** (intersection of global AND key):

| Path | Note | FM | File | DV |
|------|------|----|------|----|
| `allowed/**` | C=✓ R=✓ U=✓ D=✗(key) | CRUD | CRUD | CRUD |
| `maybe-allowed/**` | R only(key) | R=✓ U=✓(both) C=✗(global) D=✗(global) | CRUD | R only(key) |

**Note:** added a third key
but we need to figure out the correct scoping for this keys to simulate the full feature set.

---

## Test Categories

### T1 — Key1: Permitted Operations (expect SUCCESS)

| # | Test | Tool | Path | Operation | Why allowed |
|---|------|------|------|-----------|-------------|
| T1.1 | Read note from allowed/ | kado-read | `allowed/Project Alpha.md` | note | Key1 has note.read=true |
| T1.2 | Read frontmatter from allowed/ | kado-read | `allowed/Project Alpha.md` | frontmatter | Key1 has fm.read=true |
| T1.3 | Read dataview fields from allowed/ | kado-read | `allowed/Daily Note 2026-03-31.md` | dataview-inline-field | Key1 has dv.read=true |
| T1.4 | Create note in allowed/ | kado-write | `allowed/_test-create.md` | note (no expectedModified) | Key1 has note.create=true |
| T1.5 | Update note in allowed/ | kado-write | `allowed/_test-create.md` | note (with expectedModified) | Key1 has note.update=true |
| T1.6 | Read note from maybe-allowed/ | kado-read | `maybe-allowed/Budget 2026.md` | note | Key1 has note.read=true |
| T1.7 | Read frontmatter from maybe-allowed/ | kado-read | `maybe-allowed/Budget 2026.md` | frontmatter | Key1 has fm.read=true |
| T1.8 | Update frontmatter in maybe-allowed/ | kado-write | `maybe-allowed/Budget 2026.md` | frontmatter (with expectedModified) | Key1 fm.update=true AND global fm.update=true |
| T1.9 | Search by tag (byTag) | kado-search | — | byTag: `engineering` | Key1 has note.read on allowed/ |
| T1.10 | Search by name (byName) | kado-search | — | byName: `Project` | Key1 has paths |
| T1.11 | List directory contents | kado-search | `allowed/` | listDir | Key1 has path |

### T2 — Key1: Denied Operations (expect FORBIDDEN)

| # | Test | Tool | Path | Operation | Why denied |
|---|------|------|------|-----------|------------|
| T2.1 | Delete note from allowed/ | kado-write(?) | `allowed/Project Alpha.md` | note delete | Key1 note.delete=false |
| T2.2 | Create note in maybe-allowed/ | kado-write | `maybe-allowed/_test-deny.md` | note (no expectedModified) | Key1 note.create=false for this path |
| T2.3 | Update note in maybe-allowed/ | kado-write | `maybe-allowed/Budget 2026.md` | note (with expectedModified) | Key1 note.update=false for this path |
| T2.4 | Create frontmatter in maybe-allowed/ | kado-write | `maybe-allowed/_test-fm.md` | frontmatter (no expectedModified) | Global fm.create=false for this path |
| T2.5 | Read note from nope/ | kado-read | `nope/Credentials.md` | note | Path not in global security |
| T2.6 | Read note from root | kado-read | `Welcome.md` | note | Path not in global security |
| T2.7 | Write to nope/ | kado-write | `nope/_test-nope.md` | note | Path not in global security |
| T2.8 | Create dataview in maybe-allowed/ | kado-write | `maybe-allowed/Budget 2026.md` | dataview-inline-field | Key1 dv.create=false for this path |

### T3 — Key2: Full Denial (expect FORBIDDEN on everything)

| # | Test | Tool | Path | Operation | Why denied |
|---|------|------|------|-----------|------------|
| T3.1 | Read note from allowed/ | kado-read | `allowed/Project Alpha.md` | note | Key2 has no paths |
| T3.2 | Read note from maybe-allowed/ | kado-read | `maybe-allowed/Budget 2026.md` | note | Key2 has no paths |
| T3.3 | Read note from nope/ | kado-read | `nope/Credentials.md` | note | Key2 has no paths |
| T3.4 | Write to allowed/ | kado-write | `allowed/_test-key2.md` | note | Key2 has no paths |
| T3.5 | Search by tag | kado-search | — | byTag: `engineering` | Key2 has no paths |
| T3.6 | List directory | kado-search | `allowed/` | listDir | Key2 has no paths |

### T4 — Authentication Edge Cases

| # | Test | Expected |
|---|------|----------|
| T4.1 | No Authorization header | 401 UNAUTHORIZED |
| T4.2 | Invalid key (random UUID) | 401 UNAUTHORIZED |
| T4.3 | Disabled key (if testable) | 401 UNAUTHORIZED |
| T4.4 | Empty Bearer token | 401 UNAUTHORIZED |

**Note:** t4.3 we don't have disabled keys, add this feature as a future todo

### T5 — Path Security

| # | Test | Expected |
|---|------|----------|
| T5.1 | Path traversal `../nope/Credentials.md` | VALIDATION_ERROR |
| T5.2 | Path traversal `allowed/../../nope/Credentials.md` | VALIDATION_ERROR |
| T5.3 | Null byte in path `allowed/test%00.md` | VALIDATION_ERROR |
| T5.4 | Absolute path `/etc/passwd` | VALIDATION_ERROR |

### T6 — Audit Log Verification

| # | Test | Expected |
|---|------|----------|
| T6.1 | After T1.1 (allowed read): entry exists with decision=allowed | Audit entry with ISO 8601 timestamp |
| T6.2 | After T2.5 (denied read): entry exists with decision=denied | Audit entry with gate info |
| T6.3 | Timestamps are ISO 8601 with timezone | Matches `YYYY-MM-DDTHH:mm:ss.SSS±HH:MM` |
| T6.4 | No note content leaked in audit log | Entry contains path, operation, decision — NOT file content |

### T7 — Search Scope Isolation

| # | Test | Expected |
|---|------|----------|
| T7.1 | Key1 byName search: results only from allowed/ and maybe-allowed/ | No items from nope/ |
| T7.2 | Key1 listDir on nope/: denied | FORBIDDEN |
| T7.3 | Key2 byName search: empty results | Key2 has no scope |
| T7.4 | Key1 byContent search: results filtered to permitted paths | No content from nope/ |

### T8 — Config Change Verification

These tests modify the config and verify behavior changes. Requires plugin reload between changes.

| # | Test | Config Change | Before | After |
|---|------|--------------|--------|-------|
| T8.1 | Grant Key2 access to allowed/ | Add `allowed/**` path with note.read to Key2 | T3.1 = FORBIDDEN | T3.1-retry = SUCCESS |
| T8.2 | Revoke Key1 access to maybe-allowed/ | Remove `maybe-allowed/**` from Key1 | T1.6 = SUCCESS | T1.6-retry = FORBIDDEN |
| T8.3 | Switch global to blacklist, add nope/ | `security.listMode=blacklist`, paths=[`nope/**`] | nope/ denied | allowed/ + maybe-allowed/ still work, nope/ denied via blacklist |
| T8.4 | Disable Key1 | Set Key1 `enabled=false` | T1.1 = SUCCESS | T1.1-retry = UNAUTHORIZED |

**Note:** atm we need to do this manually..
- update the config for the test
- let the user know to disable/enable plugin
- wait for the confirmation
- do the test
- switch the config back to the original
- let the user know to disable / enable plugin
- wait for the confirmation
this hopefully change when we have seigyo, but don't hold your horses


### T9 — Mixed ListMode Combinations (WL/BL, BL/WL)

These are the untested enforcement edge cases from the validation.

| # | Global ListMode | Key ListMode | Scenario | Expected |
|---|----------------|-------------|----------|----------|
| T9.1 | whitelist | blacklist | Key blacklists `allowed/**` note.update | Read OK, update FORBIDDEN |
| T9.2 | blacklist | whitelist | Global blacklists `nope/**`, Key whitelists `allowed/**` | allowed/ OK, nope/ denied |
| T9.3 | blacklist | blacklist | Global blacklists `nope/**`, Key blacklists `maybe-allowed/**` note.create | allowed/ full, maybe-allowed/ no note create, nope/ denied |

**Note:** atm we need to do this manually
- tell the user what to do
- wait for confirmation
- test
- tell the user what to do
- test etc
- roll back the config when you are done

### T10 — Write Contract (Optimistic Concurrency)

| # | Test | Expected |
|---|------|----------|
| T10.1 | Create new file (no expectedModified) | SUCCESS |
| T10.2 | Create existing file (no expectedModified) | ERROR (file exists) |
| T10.3 | Update with fresh timestamp | SUCCESS |
| T10.4 | Update with stale timestamp | CONFLICT |
| T10.5 | Update non-existent file (with expectedModified) | NOT_FOUND or CONFLICT |

---

## Implementation Notes

### Existing Live Tests

`test/live/mcp-live.test.ts` uses the **old data model** (`globalAreas`, `areas`, `areaId`). Must be migrated to the new model before these tests can run.

### Two-Key Testing

The `.mcp.json` should have two server entries pointing to the same URL but with different Bearer tokens:

```json
{
  "mcpServers": {
    "kado-key1": {
      "type": "url",
      "url": "http://127.0.0.1:23026/mcp",
      "headers": { "Authorization": "Bearer kado_9e1d88c0-4838-47b3-968d-855c77cf86bd" }
    },
    "kado-key2": {
      "type": "url",
      "url": "http://127.0.0.1:23026/mcp",
      "headers": { "Authorization": "Bearer kado_e8ffd8c0-c6b6-4402-bacc-abd04bdba330" }
    }
  }
}
```

The test runner reads both keys and creates two MCP clients.

### Config Change Tests (T8, T9)

These tests modify `data.json`, require a plugin reload, and restore the original config afterward. Options:
1. **Manual**: document as a manual test checklist
2. **Automated**: test writes config, waits for reload, runs assertions, restores backup
   - Risk: Obsidian may overwrite data.json on its own schedule
   - Mitigation: backup + restore in beforeAll/afterAll

### Cleanup

Write tests (T1.4, T1.5, T2.2, T2.7, T3.4, T10.x) create temp files. These must be cleaned up:
- `allowed/_test-create.md`
- `maybe-allowed/_test-deny.md` (should fail to create, but cleanup anyway)
- `maybe-allowed/_test-fm.md` (should fail)
- `nope/_test-nope.md` (should fail)
- `allowed/_test-key2.md` (should fail, then succeed after T8.1)

Use filesystem `unlinkSync` in afterAll (no kado-delete tool exists).

### Priority

1. **T1–T3** (core access control) — implement first, these are the foundation
2. **T4–T5** (auth + path security) — mostly exist in current live tests, migrate
3. **T6** (audit) — verify ISO timestamps work end-to-end
4. **T7** (search scope) — important for data leakage prevention
5. **T8** (config changes) — verifies runtime behavior after security changes
6. **T9** (mixed listMode) — covers the enforcement gap from validation
7. **T10** (write contract) — mostly exists, migrate
