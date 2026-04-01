# Test Matrix — Kado

> Auto-generated 2026-04-01. 516 passing, 0 failing.

## Summary

| Layer | Files | Pass | Fail | Total |
|-------|------:|-----:|-----:|------:|
| Plugin lifecycle | 2 | 29 | 0 | 29 |
| Core — config & logging | 3 | 46 | 0 | 46 |
| Core — permission gates | 7 | 95 | 0 | 95 |
| Core — utilities | 3 | 61 | 0 | 61 |
| Core — routing | 1 | 16 | 0 | 16 |
| MCP — transport & auth | 2 | 32 | 0 | 32 |
| MCP — request/response | 2 | 35 | 0 | 35 |
| MCP — tools & audit | 2 | 46 | 0 | 46 |
| Obsidian adapters | 5 | 112 | 0 | 112 |
| Types | 1 | 31 | 0 | 31 |
| Integration | 1 | 13 | 0 | 13 |
| **Total** | **29** | **516** | **0** | **516** |

## Detailed Matrix

### Plugin Lifecycle

| Test file | Source | Describes | P | F |
|-----------|--------|-----------|--:|--:|
| `main.test.ts` | `src/main.ts` | class contract, onload, onunload, loadSettings, saveSettings | 18 | 0 |
| `settings.test.ts` | `src/settings/SettingsTab.ts` | KadoSettingsTab | 11 | 0 |

### Core — Config & Logging

| Test file | Source | Describes | P | F |
|-----------|--------|-----------|--:|--:|
| `core/config-manager.test.ts` | `src/core/config-manager.ts` | default config, load, save, generateApiKey, revokeKey, getKeyById, round-trip | 24 | 0 |
| `core/audit-logger.test.ts` | `src/core/audit-logger.ts` | NDJSON write, required fields, denied/allowed entries, disabled config, rotation, updateConfig, createAuditEntry factory | 15 | 0 |
| `core/console-logging.test.ts` | `src/core/logger.ts` | kadoLog, kadoError | 7 | 0 |

### Core — Permission Gates

| Test file | Source | Describes | P | F |
|-----------|--------|-----------|--:|--:|
| `core/gates/authenticate.test.ts` | `src/core/gates/authenticate.ts` | valid key, missing key, disabled key | 7 | 0 |
| `core/gates/global-scope.test.ts` | `src/core/gates/global-scope.ts` | whitelist allowed/denied, blacklist, search passthrough | 14 | 0 |
| `core/gates/key-scope.test.ts` | `src/core/gates/key-scope.ts` | whitelist allowed/denied, blacklist | 12 | 0 |
| `core/gates/datatype-permission.test.ts` | `src/core/gates/datatype-permission.ts` | read/write/search permissions, scope exclusion, blacklist inversion | 19 | 0 |
| `core/gates/path-access.test.ts` | `src/core/gates/path-access.ts` | allowed paths, traversal attempts, empty paths | 14 | 0 |
| `core/gates/scope-resolver.test.ts` | `src/core/gates/scope-resolver.ts` | createAllPermissions, invertPermissions, intersectPermissions, whitelist/blacklist resolveScope, **directory prefix matching** | 19 | 0 |
| `core/permission-chain.test.ts` | `src/core/permission-chain.ts` | gate ordering, short-circuit denial, createDefaultGateChain | 10 | 0 |

### Core — Utilities

| Test file | Source | Describes | P | F |
|-----------|--------|-----------|--:|--:|
| `core/glob-match.test.ts` | `src/core/glob-match.ts` | literal match, `*`/`**` wildcards, special char escaping, empty pattern, pathMatchesPatterns, **dirCouldContainMatches**, **bare name directory matching** | 32 | 0 |
| `core/tag-utils.test.ts` | `src/core/tag-utils.ts` | normalizeTag, isWildcardTag, matchTag | 22 | 0 |
| `core/concurrency-guard.test.ts` | `src/core/concurrency-guard.ts` | expectedModified match/mismatch, create without mtime, read/search bypass | 7 | 0 |

### Core — Routing

| Test file | Source | Describes | P | F |
|-----------|--------|-----------|--:|--:|
| `core/operation-router.test.ts` | `src/core/operation-router.ts` | read/write/search routing, adapter isolation, invalid operation | 16 | 0 |

### MCP — Transport & Auth

| Test file | Source | Describes | P | F |
|-----------|--------|-----------|--:|--:|
| `mcp/server.test.ts` | `src/mcp/server.ts` | isRunning, start, stop, EADDRINUSE, **sequential authenticated requests (connect() regression)**, CORS, auth middleware, rate limiting (429), concurrency cap (503) | 20 | 0 |
| `mcp/auth.test.ts` | `src/mcp/auth.ts` | valid Bearer, missing header, wrong scheme, unknown token, disabled key | 12 | 0 |

### MCP — Request/Response Mapping

| Test file | Source | Describes | P | F |
|-----------|--------|-----------|--:|--:|
| `mcp/request-mapper.test.ts` | `src/mcp/request-mapper.ts` | mapReadRequest, mapWriteRequest, mapSearchRequest (incl. **listDir path normalization**) | 13 | 0 |
| `mcp/response-mapper.test.ts` | `src/mcp/response-mapper.ts` | mapFileResult, mapWriteResult, mapSearchResult, mapError | 22 | 0 |

### MCP — Tools & Audit Integration

| Test file | Source | Describes | P | F |
|-----------|--------|-----------|--:|--:|
| `mcp/tools.test.ts` | `src/mcp/tools.ts` | registerTools, kado-read/write/search handlers, **scopePatterns injection**, filterResultsByScope, **computeAllowedTags** | 34 | 0 |
| `mcp/audit-integration.test.ts` | `src/mcp/audit-integration.ts` | allowed/denied read/write/search audit, disabled logger, multiple entries | 12 | 0 |

### Obsidian Adapters

| Test file | Source | Describes | P | F |
|-----------|--------|-----------|--:|--:|
| `obsidian/search-adapter.test.ts` | `src/obsidian/search-adapter.ts` | listDir (incl. **path normalization**), byTag (incl. **glob wildcards**, **tag permissions**), byName (incl. **glob wildcards**), listTags (incl. **scope + tag filtering**), byContent, byFrontmatter, pagination, **scope filtering before pagination**, **empty query validation**, **tag permission filtering** | 68 | 0 |
| `obsidian/note-adapter.test.ts` | `src/obsidian/note-adapter.ts` | read, write create, **write update via vault.adapter** | 7 | 0 |
| `obsidian/frontmatter-adapter.test.ts` | `src/obsidian/frontmatter-adapter.ts` | read, write | 9 | 0 |
| `obsidian/file-adapter.test.ts` | `src/obsidian/file-adapter.ts` | read, write create/update | 7 | 0 |
| `obsidian/inline-field-adapter.test.ts` | `src/obsidian/inline-field-adapter.ts` | parseInlineFields, read, **write (bare, bracket, paren fields)** | 21 | 0 |

### Types

| Test file | Source | Describes | P | F |
|-----------|--------|-----------|--:|--:|
| `types/canonical.test.ts` | `src/types/canonical.ts` | default factories, type guards, shape validation for all core types | 31 | 0 |

### Integration

| Test file | Source | Describes | P | F |
|-----------|--------|-----------|--:|--:|
| `integration/tool-roundtrip.test.ts` | end-to-end | Full tool call pipeline through permission chain and routing | 13 | 0 |

### Live (manual, not in CI)

| Test file | Purpose |
|-----------|---------|
| `live/mcp-live.test.ts` | Smoke tests against running Obsidian instance |
| `live/mcp-config-change.test.ts` | Hot-reload config change tests |

## Positive vs Negative Coverage

Each section lists what is tested for **success** (happy path) and **failure/rejection** (error path).

| Area | Positive (pass) | Negative (reject/deny) |
|------|-----------------|----------------------|
| Auth middleware | Valid Bearer accepted | Missing header → 401, wrong scheme → 401, unknown token → 401, disabled key → 401 |
| Gate: authenticate | Known enabled key passes | Missing apiKeyId denied, unknown key denied, disabled key denied |
| Gate: global-scope | Whitelisted path passes, search without path passes | Non-whitelisted path → FORBIDDEN, blacklisted path → FORBIDDEN |
| Gate: key-scope | Key's whitelisted path passes | Path outside key scope → FORBIDDEN |
| Gate: datatype-permission | Correct CRUD permission passes | Wrong CRUD action denied, scope exclusion denied |
| Gate: path-access | Normal paths pass | `../` traversal denied, absolute paths denied |
| Scope resolver | Whitelist match returns perms, blacklist non-match returns all | Whitelist no-match → null, directory without `/` → null |
| Scope resolver (dir prefix) | `allowed/` matches `allowed/**` | `forbidden/` rejected, `allowed` (no slash) → null |
| Glob match | `*`, `**`, literals match correctly | Different root rejected, partial path rejected |
| Glob match (bare name) | `Calendar` matches `Calendar/note.md`, with spaces | Different dir rejected, similar-prefix dir rejected |
| dirCouldContainMatches | `allowed/` under `allowed/**` | Wrong prefix rejected, sibling dir rejected, parent of pattern rejected |
| Concurrency guard | Matching mtime passes, create without mtime passes | Stale mtime → CONFLICT |
| Rate limiting | Under-limit passes, expired window resets | Over-limit → 429 |
| Concurrency cap | Under-limit passes | At MAX_CONCURRENT → 503 |
| Server connect() | Sequential auth requests → 200 | Second request must not → 500 (regression) |
| byName search | Substring match, case-insensitive | No match → empty |
| byName glob | `*` matches, `?` matches, case-insensitive | No match → empty, `?` won't match zero chars |
| byTag search | Exact tag match | Wrong tag → empty, no cache → empty |
| byTag glob | `#project/*` matches nested, case-insensitive | No match → empty, `?` won't match multi-char |
| byTag permissions | Permitted tag succeeds, wildcard allowed permits sub-tags | Empty allowedTags → FORBIDDEN, unpermitted tag → FORBIDDEN, glob with no permitted matches → empty |
| listTags | Tags from in-scope files returned, undefined = no filter | Empty allowedTags → empty, empty scopePatterns → empty, unpermitted tags excluded |
| listTags (both scopes) | Only permitted tags from in-scope files counted | Out-of-scope file's tags excluded from count |
| listDir | Prefix match, nested files, bare name path | Wrong prefix → empty, **normalized path excludes similar prefixes** |
| byContent | Substring in body, case-insensitive, path-scoped | No match → empty |
| byFrontmatter | key=value, key-only, case-insensitive values | Wrong value → empty |
| Empty query validation | listDir/listTags work without query | byName/byTag/byContent/byFrontmatter reject empty → VALIDATION_ERROR |
| Scope filtering + pagination | total/cursor consistent with filtered results, works across byName/byContent/listDir | Empty scopePatterns → no items, undefined skips filter |
| filterResultsByScope | Files within whitelist returned | Files outside scope filtered out |
| computeAllowedTags | Key tags, global tags, intersection | Both empty → [], no intersection → [], unknown key → [] |
| Inline field write | Bare, bracket, paren field updates | NOT_FOUND for missing file, VALIDATION_ERROR for non-Record content |
| Note adapter write | Create via vault.create, update via vault.adapter.write | NOT_FOUND for missing file, CONFLICT for existing on create |

## Changes in this session (2026-04-01)

| Fix | Description |
|-----|-------------|
| MCP connect() crash | Fresh McpServer per request — SDK forbids reusing connected instance |
| Glob wildcards in search | byName and byTag support `*` and `?` patterns |
| Bare name path matching | `"Calendar"` auto-expands to match `"Calendar/**"` |
| Directory path normalization | listDir normalizes paths with trailing `/`; scope gates handle dir prefixes |
| Empty query validation | byName/byTag/byContent/byFrontmatter reject empty queries |
| Scope filtering before pagination | Filter → paginate (not paginate → filter) for consistent total/cursor |
| listTags scoped | Only tags from in-scope files with permitted tag patterns |
| Tag permissions | `allowedTags` enforced on listTags and byTag; `computeAllowedTags` intersects global + key |
| Total reflects filtered count | `total` matches post-filter items, not pre-filter |
| Server version from manifest | MCP initialize returns plugin version, not hardcoded `1.0.0` |
| Hot-reload EADDRINUSE retry | `onunload()` stops server; `start()` retries once on port conflict |
| Inline field write fix | `vault.process()` → `vault.modify()` |
| Note adapter test fix | Test updated to match `vault.adapter.write()` workaround |
| Settings UI path picker | Picker renders below "+ add path" button, not below danger zone |
