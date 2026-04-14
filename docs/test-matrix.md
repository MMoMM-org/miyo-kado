# TestVault — Live Test Matrix

> Quick-reference matrix: what each API key can and cannot do, per operation and location.
>
> Config source of truth: `test/fixtures/live-test-config.json`
> Full coverage details: `docs/test-coverage.md`


## API Key Overview

| Property | Key1 (Full Access) | Key2 (No Access) | Key3 (Read Only) |
|---|---|---|---|
| **Label** | Key1 Full Access | Key2 No Access | Key3 Read Only |
| **listMode** | whitelist | whitelist | whitelist |
| **Paths** | `allowed/**`, `maybe-allowed/**`, `listdir-fixtures/**` | _(none)_ | `allowed/**` |
| **Tags** | `engineering`, `project/*`, `miyo/kado`, `finance` | _(none)_ | `engineering` |

### Key1 — Detailed Permissions

| Path | note | frontmatter | file | dataviewInlineField |
|---|---|---|---|---|
| `allowed/**` | C R U D | C R U D | C R U D | C R U D |
| `maybe-allowed/**` | ~~C~~ R ~~U~~ ~~D~~ | ~~C~~ R U ~~D~~ | C R U D | ~~C~~ R ~~U~~ ~~D~~ |
| `listdir-fixtures/**` | ~~C~~ R ~~U~~ ~~D~~ | ~~C~~ R ~~U~~ ~~D~~ | ~~C~~ R ~~U~~ ~~D~~ | ~~C~~ R ~~U~~ ~~D~~ |

### Key3 — Detailed Permissions

| Path | note | frontmatter | file | dataviewInlineField |
|---|---|---|---|---|
| `allowed/**` | ~~C~~ R ~~U~~ ~~D~~ | ~~C~~ R ~~U~~ ~~D~~ | ~~C~~ R ~~U~~ ~~D~~ | ~~C~~ R ~~U~~ ~~D~~ |

### Global Security (constrains all keys)

| Path | note | frontmatter | file | dataviewInlineField |
|---|---|---|---|---|
| `allowed/**` | C R U D | C R U D | C R U D | C R U D |
| `maybe-allowed/**` | C R U D | ~~C~~ R U ~~D~~ | C R U D | C R U D |
| `listdir-fixtures/**` | ~~C~~ R ~~U~~ ~~D~~ | ~~C~~ R ~~U~~ ~~D~~ | ~~C~~ R ~~U~~ ~~D~~ | ~~C~~ R ~~U~~ ~~D~~ |
| `nope/` | _not listed — denied for all keys_ | | | |
| Root-level | _not listed — denied for all keys_ | | | |

**Global tags:** `engineering`, `project/*`, `miyo/kado`, `finance`

---

## TestVault Content

| Path | Purpose |
|---|---|
| `allowed/Project Alpha.md` | Primary read target (frontmatter, inline fields, tags: project, engineering, #miyo/kado) |
| `allowed/Meeting Notes 2026-03-28.md` | Secondary read target, content search ("Sprint Planning") |
| `allowed/Tagging Examples.md` | Tag test fixtures (#project/alpha, #project/alpha/phase-2) |
| `allowed/Daily Note 2026-03-31.md` | Additional note |
| `allowed/API Design Draft.md` | Additional note (#engineering, #api) |
| `allowed/sub/Nested Note.md` | Glob subdirectory test (`allowed/**` depth, #project/alpha) |
| `allowed/test-image.png` | Binary read (PNG magic bytes) |
| `allowed/test-document.pdf` | Binary read (PDF header) |
| `allowed/test-large.bin` | Large binary (150 KB roundtrip) |
| `maybe-allowed/Budget 2026.md` | Partial-access tests, inline fields (bracket + list-item), #finance |
| `maybe-allowed/Quarterly Review.md` | Additional partial-access note |
| `maybe-allowed/Vendor Evaluation.md` | Additional partial-access note |
| `nope/Credentials.md` | Restricted area (contains "hunter2" for leak tests) |
| `nope/Incident Report.md` | Restricted area |
| `Welcome.md` | Root-level (outside all paths) |
| `listdir-fixtures/` | Directory listing depth/structure tests (empty dir, deep nesting, hidden files) |

---

## Legend

- 🟢 = Allowed (tested)
- 🔴 = Denied (tested)
- 🟡 = Allowed (not yet tested)
- 🟠 = Denied (not yet tested)
- ⚪ = Not applicable (path not in key scope, implicitly denied)

---

## kado-read — Note

| Location | Key1 | Key2 | Key3 |
|---|---|---|---|
| `allowed/Project Alpha.md` | 🟢 | 🔴 | 🟢 |
| `allowed/Meeting Notes 2026-03-28.md` | 🟢 | ⚪ | 🟡 |
| `allowed/sub/Nested Note.md` | 🟢 | ⚪ | 🟡 |
| `maybe-allowed/Budget 2026.md` | 🟢 | 🔴 | 🔴 |
| `nope/Credentials.md` | 🔴 | 🔴 | 🔴 |
| `Welcome.md` (root) | 🔴 | ⚪ | 🟠 |

## kado-read — Frontmatter

| Location | Key1 | Key2 | Key3 |
|---|---|---|---|
| `allowed/Project Alpha.md` | 🟢 | ⚪ | 🟢 |
| `maybe-allowed/Budget 2026.md` | 🟡 | ⚪ | 🟠 |
| `nope/Incident Report.md` | 🔴 | ⚪ | 🟠 |

## kado-read — Dataview Inline Field

| Location | Key1 | Key2 | Key3 |
|---|---|---|---|
| `allowed/Project Alpha.md` | 🟢 | ⚪ | 🟢 |
| `maybe-allowed/Budget 2026.md` | 🟢 | ⚪ | 🟠 |

## kado-read — File (binary)

| Location | Key1 | Key2 | Key3 |
|---|---|---|---|
| `allowed/test-image.png` | 🟢 | 🔴 | 🟢 |
| `allowed/test-document.pdf` | 🟢 | ⚪ | 🟡 |
| `allowed/test-large.bin` (150 KB) | 🟢 | ⚪ | 🟡 |
| `nope/Credentials.md` (as file) | 🔴 | ⚪ | 🟠 |

---

## kado-write — Note

| Operation | Location | Key1 | Key2 | Key3 |
|---|---|---|---|---|
| Create | `allowed/_scratch.md` | 🟢 | 🔴 | 🔴 |
| Create (duplicate) | `allowed/_scratch.md` | 🟢 (CONFLICT) | ⚪ | ⚪ |
| Update (with expectedModified) | `allowed/_scratch.md` | 🟢 | ⚪ | 🔴 |
| Update (stale timestamp) | `allowed/_scratch.md` | 🟢 (CONFLICT) | ⚪ | ⚪ |
| Update (chained) | `allowed/_scratch.md` | 🟢 | ⚪ | ⚪ |
| Create | `maybe-allowed/_test.md` | 🔴 | ⚪ | ⚪ |
| Update | `maybe-allowed/Budget 2026.md` | 🔴 | ⚪ | ⚪ |
| Create | `nope/_test.md` | 🔴 | ⚪ | ⚪ |

## kado-write — Frontmatter

| Operation | Location | Key1 | Key2 | Key3 |
|---|---|---|---|---|
| Create keys | `allowed/_scratch.md` | 🟢 | ⚪ | 🔴 |
| Update keys | `allowed/_scratch.md` | 🟢 | ⚪ | 🔴 |
| Merge (add new key) | `allowed/_scratch.md` | 🟢 | ⚪ | ⚪ |
| Write keys | `maybe-allowed/` | 🔴 | ⚪ | ⚪ |

## kado-write — Dataview Inline Field

| Operation | Location | Key1 | Key2 | Key3 |
|---|---|---|---|---|
| Update bracket field | `allowed/_scratch.md` | 🟢 | ⚪ | 🔴 |
| Update numeric field | `allowed/_scratch.md` | 🟢 | ⚪ | ⚪ |
| Update | `maybe-allowed/` | 🔴 | ⚪ | ⚪ |
| Create | `maybe-allowed/` | 🔴 | ⚪ | ⚪ |

## kado-write — File (binary)

| Operation | Location | Key1 | Key2 | Key3 |
|---|---|---|---|---|
| Create | `allowed/_scratch.bin` | 🟢 | ⚪ | 🔴 |
| Update (with expectedModified) | `allowed/_scratch.bin` | 🟢 | ⚪ | ⚪ |

---

## kado-delete

All delete operations require `expectedModified` (optimistic concurrency). Notes/files go to the user's configured trash (system/Obsidian/permanent per Obsidian settings). Frontmatter delete removes specific keys via `processFrontMatter`. Dataview inline fields are intentionally not supported.

| Operation | Location | Key1 | Key2 | Key3 |
|---|---|---|---|---|
| Delete note (trash) | `allowed/_scratch.md` | 🟢 | ⚪ | 🔴 |
| Delete note | `maybe-allowed/*` | 🔴 | ⚪ | ⚪ |
| Delete note | `nope/*` | 🔴 | ⚪ | ⚪ |
| Delete file (trash) | `allowed/_scratch.bin` | 🟢 | ⚪ | ⚪ |
| Delete frontmatter keys | `allowed/_scratch.md` | 🟢 | ⚪ | 🔴 |
| Delete frontmatter keys | `maybe-allowed/*` | 🔴 | ⚪ | ⚪ |
| Delete `dataview-inline-field` (rejected) | any | 🔴 (VALIDATION_ERROR) | ⚪ | ⚪ |
| Delete without `keys` for frontmatter | any | 🔴 (VALIDATION_ERROR) | ⚪ | ⚪ |
| Delete with stale `expectedModified` | any | 🔴 (CONFLICT) | ⚪ | ⚪ |
| Delete non-existent file | any | 🔴 (NOT_FOUND) | ⚪ | ⚪ |

---

## kado-search

| Operation | Query / Path | Key1 | Key2 | Key3 |
|---|---|---|---|---|
| byTag | `#engineering` | 🟢 | 🔴 | 🟡 |
| byTag | `#finance` (maybe-allowed only) | 🟢 | ⚪ | ⚪ |
| byTag | `#miyo/tomo` (not in whitelist) | 🔴 | ⚪ | ⚪ |
| byName | "Budget" | 🟢 | 🟡 | 🟡 |
| byName | "Project" | 🟡 | 🔴 | 🟢 |
| byName | "Report" (scope leak check) | 🟢 | ⚪ | 🟡 |
| listDir | `allowed/` | 🟢 | 🔴 | 🟢 |
| listDir | `allowed/` depth:1 | 🟢 | ⚪ | ⚪ |
| listDir | `allowed/` limit:2 (pagination) | 🟢 | ⚪ | ⚪ |
| listDir | `allowed/` cursor page 2+ | 🟢 | ⚪ | ⚪ |
| listDir | `allowed/` paginate to exhaustion | 🟢 | ⚪ | ⚪ |
| listDir | `nope/` | 🔴 | ⚪ | 🟡 |
| listDir | `maybe-allowed/` | 🟡 | 🟡 | 🔴 |
| listDir | `listdir-fixtures/EmptyFolder/` | 🟢 | ⚪ | ⚪ |
| listDir | `listdir-fixtures/` (deep nesting) | 🟢 | ⚪ | ⚪ |
| listDir | `listdir-fixtures/` depth:1 | 🟢 | ⚪ | ⚪ |
| listDir | `listdir-fixtures/` (hidden files filtered) | 🟢 | ⚪ | ⚪ |
| listTags | — | 🟢 | 🟡 | 🟡 |
| byContent | "Sprint Planning" | 🟢 | 🔴 | 🟢 |
| byContent | "hunter2" (scope leak) | 🟢 | ⚪ | 🟡 |
| byContent | "Budget" (scope boundary) | 🟡 | 🟡 | 🔴 |
| byFrontmatter | `status=active` | 🟢 | 🔴 | 🟡 |
| byFrontmatter | `tags=finance` (array match, scope boundary) | 🟢 | ⚪ | 🔴 |

---

## Authentication & Security

| Scenario | Status |
|---|---|
| Invalid API key | 🟢 |
| Empty authorization | 🟢 |
| Disabled API key (enabled=false) | 🟠 |
| Path traversal `../` | 🟢 |
| Path traversal `../../` | 🟢 |
| Null byte in path | 🟢 |
| Absolute path `/etc/passwd` | 🟢 |
| URL-encoded traversal `%2e%2e` | 🟢 |
| Double-encoded `%252e%252e` | 🟢 |
| Unicode filename roundtrip | 🟢 |

## Audit Log

| Scenario | Status |
|---|---|
| NDJSON format valid | 🟢 |
| Allowed read logged (Key1) | 🟢 |
| Denied read logged with gate (Key1) | 🟢 |
| Search logged (Key1) | 🟢 |
| Write logged (Key1) | 🟢 |
| Denied request logged (Key2) | 🟢 |
| Allowed read logged (Key3) | 🟢 |

## Rate Limiting

| Scenario | Status |
|---|---|
| RateLimit headers present | 🟢 |
| 429 with Retry-After on burst | 🟢 |
