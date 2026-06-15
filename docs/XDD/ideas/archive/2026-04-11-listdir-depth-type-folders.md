# listDir — depth parameter, folder entries, type field, and related bug fixes

**Status:** Draft spec, ready for `/xdd`
**Date:** 2026-04-11
**Origin:** Consolidates two inbox handoffs — `_inbox/from-kokoro/2026-04-09_kokoro-to-kado_listdir-depth-and-folder-items.md` and `_inbox/from-tomo/2026-04-11_tomo-to-kado_listdir-api-gaps.md`.

## Problem

`kado-search listDir` today uses `app.vault.getFiles()` (see `src/obsidian/search-adapter.ts:111-114`) which returns a flat, fully recursive list of `TFile` entries filtered by path prefix. This has four observed issues consumers hit in practice:

1. **No folder entries.** The response shape defined at `src/obsidian/search-adapter.ts:30-38` has no way to represent a folder. Clients cannot detect subdirectories or distinguish files from folders without parsing file paths.
2. **No depth control.** Every `listDir` call returns all descendants. Building a shallow tree map (direct children only) requires fetching the entire recursive list and post-processing.
3. **Trailing-slash path rejected as HTTP 406.** Tomo observed that `path: "100 Inbox/"` returns HTTP 406 while `path: "100 Inbox"` works. The mapper at `src/mcp/request-mapper.ts:90-94` already normalizes trailing slashes, so the root cause is in a layer not yet isolated.
4. **No canonical vault-root marker and unhelpful empty-path error.** `src/core/gates/path-access.ts:37-40` returns `'Path must not be empty'` for `path === ""`. A client cannot intuitively pass `""` to list the vault root. The obvious alternative — `/` — is also rejected today because the gate's `normalizePath` strips leading slashes (`path-access.ts:19-21`), turning `/` into `""` which then fails the same validation. The result is that the only way to list the vault root is to **omit** the `path` arg entirely, which is an undocumented convention. We need a canonical root marker (`/`) and a helpful error message when an empty string is passed.

Both Kokoro (spec context) and Tomo (integration context) independently landed on roughly the same root problem: `listDir` needs structural awareness (folders, depth, type) plus two small bug fixes. This spec addresses all four points in a single change.

## Goals

- `listDir` can return files **and** folders.
- Callers can control depth: unlimited recursion (current default) or limited to N levels.
- Response items carry a `type: 'file' | 'folder'` discriminator and folder items carry a `childCount`.
- Trailing-slash paths succeed.
- `/` is the canonical vault-root marker and is accepted wherever a folder path is expected.
- An empty-string path is rejected with a helpful `VALIDATION_ERROR` that points the caller at `/`.
- Non-existent paths and file targets for `listDir` return explicit errors instead of silent empty lists.
- Backward compatibility at the MCP layer: consumers are LLMs reading the tool schema — the schema update is the migration.

## Non-Goals

- Adding `type` / `childCount` to other search operations (`byName`, `byTag`, `byContent`, `byFrontmatter`, `listTags`). Only `listDir` needs structural awareness.
- A separate `listChildren` operation. One operation with a depth parameter is sufficient.
- Folder `mtime` / `ctime` via `app.vault.adapter.stat()`. No known use case.
- Feature flags or migration shims. MCP schema is the contract.

## Design

### §1 — `depth` parameter semantics

New optional parameter on `CoreSearchRequest` and the MCP `kadoSearchShape`:

```typescript
depth?: number
```

| Value | Behavior |
|-------|----------|
| omitted / `undefined` | Unlimited recursive walk. Returns all files **and** folders under `path`. |
| `N` (positive integer) | Walk up to N levels below `path`. `depth: 1` returns only direct children. |
| `0`, negative, non-integer, non-number | Rejected at the request-mapper with `VALIDATION_ERROR: "depth must be a positive integer"`. |

**Semantics clarification:** `depth: 1` returns the **direct children** of `path`; `path` itself is never returned as an item. For a vault-root listing (`path` omitted) with `depth: 1`, the result is the direct children of `vault.getRoot()`.

The default (unlimited) matches the current recursive behavior in spirit: no depth → scan everything. The difference is that folders are now included alongside files.

### §2 — Response item shape

`CoreSearchItem` in `src/types/canonical.ts:88-96` gains two optional fields, matching the existing optional-field pattern (`tags?`, `frontmatter?`):

```typescript
export interface CoreSearchItem {
  path: string;
  name: string;
  created: number;
  modified: number;
  size: number;
  tags?: string[];
  frontmatter?: Record<string, unknown>;
  type?: 'file' | 'folder';    // NEW — populated only by listDir
  childCount?: number;          // NEW — populated only on folder items
}
```

**Population rules:**
- `listDir` always sets `type` on every item it returns.
- `listDir` sets `childCount` on folder items only. Value is the count of **direct children** (files + folders combined), not recursive.
- Other search operations (`byName`, `byTag`, `byContent`, `byFrontmatter`, `listTags`) never set `type` or `childCount`. Existing call sites do not need modification — the fields are optional.
- **Pre-existing quirk, unchanged by this spec:** `listTags` repurposes the `size` field to hold tag occurrence count (`src/obsidian/search-adapter.ts:218-225`). This spec does not touch that behavior. The zero-valued `size` on folder items is unrelated and does not interact with the `listTags` convention.


**Folder item values:**
- `size`: `0` (no I/O to compute folder size)
- `created`: `0` (TFolder has no stat; no I/O to fetch it)
- `modified`: `0` (same)

The zero values are documented in the MCP tool description so clients know folder timestamps are placeholders.

### §3 — Ordering and pagination

- **Sort order: folders first, then files.** Within each group items are sorted alphabetically by `path` using `a.path.localeCompare(b.path, undefined, {sensitivity: 'variant'})` for deterministic case-sensitive ordering independent of runtime default locale. Rationale: with paginated results, a consumer needs to know when it has seen the complete folder set. With folders first, the client can stop looking for folders as soon as the first file appears in the stream — or, if all folders don't fit in one page, the client knows any additional folders come on the next page before any files. Interleaved alphabetical order would force the client to fetch every page before it can be sure no more folders will appear.
- **Pagination:** the existing base64 offset cursor (`encodeOffset` / `decodeOffset` at `search-adapter.ts:21-28`) is unchanged. Folder items count toward `limit` like file items.
- **Cursor stability:** cursors are only valid when the same request parameters are replayed. Changing `depth`, `path`, or `operation` between paginated calls invalidates the cursor. This is documented in the tool description; no runtime enforcement.
- **Path resolves to a file:** return `VALIDATION_ERROR` with message `"listDir target must be a folder, got file: {path}"`. The request is semantically malformed — the caller asked to list a file, which has no children.
- **Path does not resolve:** return `NOT_FOUND` with message `"Path not found: {path}"`. This distinguishes "typo or stale reference" from "exists but wrong type" so the caller can react appropriately.
- **Root listing:** `path` omitted OR `path === "/"` → `app.vault.getRoot()` as the walk starting point. Empty-string `""` is rejected at the mapper (see §5) and never reaches the adapter.

### §4 — Permission gates and scope filtering

Folder entries must participate in scope filtering. A folder item is visible to a key iff **at least one of the key's scope patterns could match a child of that folder**.

**Integration point:** the existing `filterItemsByScope` function (`src/obsidian/search-adapter.ts:85-88`) is extended with folder awareness. Today it calls `matchGlob(p, item.path)` on every item regardless of type. The modified function discriminates on `item.type`:

```typescript
function filterItemsByScope(items: CoreSearchItem[], patterns: string[]): CoreSearchItem[] {
  if (patterns.length === 0) return [];
  return items.filter((item) => {
    if (item.type === 'folder') return folderInScope(item.path, patterns);
    return patterns.some((p) => matchGlob(p, item.path));
  });
}

function folderInScope(folderPath: string, patterns: string[]): boolean {
  const prefix = folderPath.endsWith('/') ? folderPath : folderPath + '/';
  return patterns.some((p) =>
    p.startsWith(prefix)                      // pattern is rooted inside this folder (e.g. "Atlas/**" for folder "Atlas")
    || matchGlob(p, prefix + '__probe__.md'), // pattern could match a file inside (e.g. "**/*.md" for any folder)
  );
}
```

The existing call site at `search-adapter.ts:274-276` (inside `createSearchAdapter`) remains unchanged — it still calls `filterItemsByScope` post-walk for all non-`listTags` operations. No new call sites are introduced. File items keep their current matching rule exactly; folder items use the new `folderInScope` rule.

This matches user intuition: "I see the `Atlas` folder because I can read notes inside it." It avoids the footgun of hiding folders whose file children are accessible.

**Hidden entries:** any file or folder whose name starts with `.` (e.g. `.obsidian`, `.trash`, `.git`, `.gitignore`, `.DS_Store`) is skipped during the walk and never appears in results. For folders, recursion does not descend into them at all. This matches the Obsidian File Explorer's default behavior and prevents exposing plugin internals to LLM consumers.

### §5 — Canonical root marker `/` and empty-path error (Tomo #4)

**Fix location:** `src/mcp/request-mapper.ts:mapSearchRequest` (lines 102-113).

**Two changes:**

1. **`"/"` is the canonical vault-root marker.** When `args['path'] === "/"`, the mapper normalizes it to `undefined` — identical to omitting `path` entirely. Both forms mean "list the vault root". This eliminates the undocumented "omit to mean root" convention and gives clients an explicit, documentable root path.

2. **Empty string is a validation error with a helpful message.** When `args['path'] === ""`, the mapper throws a validation error whose message points the caller at the canonical form: `"path must not be empty. Use '/' to list the vault root."`. This is surfaced as a `VALIDATION_ERROR` to the MCP client, not a silent normalization.

```typescript
// Before
if (typeof args['path'] === 'string') result.path = normalizeDirPath(args['path'], operation);

// After
if (typeof args['path'] === 'string') {
  if (args['path'] === '') {
    throw new Error("mapSearchRequest: path must not be empty. Use '/' to list the vault root.");
  }
  if (args['path'] === '/') {
    // leave result.path undefined — canonical vault-root marker
  } else {
    result.path = normalizeDirPath(args['path'], operation);
  }
}
```

**Scope of the fix:** applies to `mapSearchRequest` globally. Both `/` and `""` are handled uniformly across all search operations that carry a `path` argument — there is no per-operation asymmetry.

**Effect on `byContent`:** `byContent` uses `request.path ?? ''` as a prefix filter (`search-adapter.ts:164`, `allFiles` computation). Before the fix, `path: ""` reached `byContent` and `''.startsWith('')` matched all files. After the fix, `path: ""` returns a `VALIDATION_ERROR` at the mapper boundary and never reaches `byContent`. For a client that previously called `byContent` with `path: ""` expecting whole-vault search, the new valid form is either to omit `path` or pass `path: "/"`, both of which resolve to `request.path === undefined`, and `undefined ?? ''` is still `''` — whole-vault search preserved. **Callers passing `""` see a new error; callers using omit or `/` see identical behavior.** This is covered by tests in `test/mcp/request-mapper.test.ts` and an integration test that calls `byContent` with `path: "/"` and verifies it matches the omit-path result set.

**Effect on `byName`, `byTag`, `byFrontmatter`, `listTags`:** these operations do not use `request.path` in their current implementation (`search-adapter.ts:116-226`). The mapper-level rejection of `""` is consistent across all ops but has no downstream effect on these.

**Why at the mapper, not the gate:** the mapper is the ACL boundary; root-marker normalization and empty-string rejection are natural mapper responsibilities. Keeping the gate untouched minimizes blast radius on security-critical code. The existing `normalizePath` stripping of leading slashes in `path-access.ts:19-21` remains — it handles internal path hygiene for non-root paths like `"/Atlas/Notes"` that legitimately start with a slash.

### §6 — Bug fix: trailing-slash HTTP 406 (Tomo #1)

**Root cause: unknown.** The request-mapper's `normalizeDirPath` (lines 90-94) already appends `/` when missing, and the path-access gate's `normalizePath` handles leading slashes but leaves trailing slashes intact — neither should produce a 406. The error likely originates in the MCP transport layer, a Zod schema validation path not yet isolated, or a gate evaluating the normalized path against a pattern that assumes no trailing slash.

**Implementation task:**
1. Write a failing integration test at the MCP-tool level that replays `kado-search operation="listDir" path="100 Inbox/"` against a test vault fixture.
2. Run the test, capture the stack trace / error origin.
3. Fix at the root-cause layer. Do not paper over it with an additional normalization step.
4. Document the root cause in the fix commit.

**Contingency:** if the root cause turns out to be deep in the MCP SDK and out of our control, the fallback is to strip trailing slashes in `mapSearchRequest` so the downstream layers never see them. This is a workaround, not the preferred outcome.

`normalizeDirPath` in the mapper is **retained** regardless of the fix — `byContent` still depends on trailing-slash normalization for its prefix-match filter. The new `listDir` implementation (see §7) does not rely on prefix matching, so the normalization is a no-op for `listDir` but still needed for `byContent`.

### §7 — Implementation sketch for the new listDir

```typescript
import {TFile, TFolder} from 'obsidian';
import type {App} from 'obsidian';

type ResolveResult =
  | {kind: 'folder'; folder: TFolder}
  | {kind: 'file'}       // path points to a TFile — VALIDATION_ERROR
  | {kind: 'missing'};   // path does not resolve — NOT_FOUND

function resolveFolder(app: App, path: string | undefined): ResolveResult {
  // "/" and "" have both been normalized to undefined at the mapper.
  if (path === undefined) return {kind: 'folder', folder: app.vault.getRoot()};
  const clean = path.replace(/\/$/, '');
  const target = app.vault.getAbstractFileByPath(clean);
  if (target === null) return {kind: 'missing'};
  if (target instanceof TFolder) return {kind: 'folder', folder: target};
  return {kind: 'file'};
}

function mapFolderToItem(folder: TFolder): CoreSearchItem {
  return {
    path: folder.path,
    name: folder.name,
    type: 'folder',
    created: 0,
    modified: 0,
    size: 0,
    childCount: folder.children.length,
  };
}

function listDir(app: App, request: CoreSearchRequest): CoreSearchItem[] | CoreError {
  const resolved = resolveFolder(app, request.path);
  if (resolved.kind === 'missing') {
    return {code: 'NOT_FOUND', message: `Path not found: ${request.path}`};
  }
  if (resolved.kind === 'file') {
    return {code: 'VALIDATION_ERROR', message: `listDir target must be a folder, got file: ${request.path}`};
  }
  const items: CoreSearchItem[] = [];
  walk(resolved.folder, 0, request.depth, items);
  items.sort(compareListDirItems);
  return items;
}

function compareListDirItems(a: CoreSearchItem, b: CoreSearchItem): number {
  // Folders first, files second. Within each group, alphabetical by path.
  const aIsFolder = a.type === 'folder';
  const bIsFolder = b.type === 'folder';
  if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
  return a.path.localeCompare(b.path, undefined, {sensitivity: 'variant'});
}

function walk(folder: TFolder, currentDepth: number, maxDepth: number | undefined, out: CoreSearchItem[]): void {
  for (const child of folder.children) {
    if (child.name.startsWith('.')) continue; // skip hidden entries (files and folders)
    if (child instanceof TFolder) {
      out.push(mapFolderToItem(child));
      const shouldRecurse = maxDepth === undefined || currentDepth + 1 < maxDepth;
      if (shouldRecurse) walk(child, currentDepth + 1, maxDepth, out);
    } else if (child instanceof TFile) {
      out.push({
        path: child.path,
        name: child.name,
        type: 'file',
        created: child.stat.ctime,
        modified: child.stat.mtime,
        size: child.stat.size,
      });
    }
  }
}
```

**Switch-case update in `createSearchAdapter.search`** (`src/obsidian/search-adapter.ts:249-251`). The new `listDir` returns `CoreSearchItem[] | CoreError` and its switch case must gate on the error branch using the same pattern already used by `byTag` at lines 252-257:

```typescript
// Before
case 'listDir':
    items = listDir(app, request);
    break;

// After
case 'listDir': {
    const listResult = listDir(app, request);
    if ('code' in listResult) return listResult;
    items = listResult;
    break;
}
```

The early `return listResult` propagates the error past `filterItemsByScope` and `paginate` — both of which still take `CoreSearchItem[]` and must never see the union type. This mirrors the existing `byTag` pattern exactly.

Notes:
- The old `vault.getFiles()` + prefix-filter code path is **deleted** for `listDir` — replaced wholesale by the TFolder walk. `vault.getFiles()` remains in use for other operations (`byName`, `byContent`, etc.).
- Validation of `depth` happens at the request-mapper, not the adapter. The adapter trusts it has a valid value (or `undefined`).
- Sorting with `compareListDirItems` places folders before files; within each group items are alphabetically sorted by full path via `localeCompare`. Sorting is done on the fully-collected list before pagination slices it, so cursors remain stable within identical-parameter requests.
- The listDir walk inlines the file mapping (sets `type: 'file'` directly). The shared `mapFileToItem` helper used by other operations (`byName`, `byTag`, etc.) is **not** modified — those operations continue to produce items without the `type` field.
- `TFile` and `TFolder` are imported as runtime values (not just type-only) so `instanceof` works. The existing `import type {App, TFile}` at `search-adapter.ts:9` is replaced with separate type and value imports.

**Depth recursion trace — worked example for `depth: 2`:**

Given a tree:
```
Atlas/           (level 0, the request target)
├── People/      (level 1, folder)
│   └── Alice.md (level 2, file)
├── 202 Notes/   (level 1, folder)
│   ├── Note1.md (level 2, file)
│   └── Sub/     (level 2, folder)
│       └── Deep.md (level 3, file)
└── README.md    (level 1, file)
```

Trace for `listDir({path: "Atlas", depth: 2})`:
1. `walk(Atlas, currentDepth=0, maxDepth=2, out)`
2. Iterates `Atlas.children = [People, 202 Notes, README.md]`
3. Pushes `People` (folder, level 1). Recurse? `0 + 1 < 2` → true. Recurse into `People` with `currentDepth=1`.
4. `walk(People, 1, 2, out)` pushes `Alice.md` (level 2). Recurse? Alice is a file, skip.
5. Back in root walk, pushes `202 Notes` (folder, level 1). Recurse? `0 + 1 < 2` → true. Recurse with `currentDepth=1`.
6. `walk(202 Notes, 1, 2, out)` pushes `Note1.md` (level 2, file), pushes `Sub` (level 2, folder). Recurse into `Sub`? `1 + 1 < 2` → false. Do **not** recurse. `Deep.md` at level 3 is **not** collected. ✓
7. Back in root walk, pushes `README.md` (level 1, file).

Collected set for `depth: 2` (walk order, using full vault-relative paths):
```
Atlas/People             (folder, level 1)
Atlas/People/Alice.md    (file,   level 2)
Atlas/202 Notes          (folder, level 1)
Atlas/202 Notes/Note1.md (file,   level 2)
Atlas/202 Notes/Sub      (folder, level 2)  ← collected, but NOT recursed into
Atlas/README.md          (file,   level 1)
```
`Atlas/202 Notes/Sub/Deep.md` at level 3 is excluded — exactly two levels of descent. ✓

After applying `compareListDirItems` (folders first, then `localeCompare` within each group by full path):

```
Atlas/202 Notes        (folder)   ← 'Atlas/2...' < 'Atlas/P...'
Atlas/202 Notes/Sub    (folder)   ← common prefix with above, longer path sorts after
Atlas/People           (folder)
Atlas/202 Notes/Note1.md (file)   ← files begin here
Atlas/People/Alice.md    (file)
Atlas/README.md          (file)
```

For `depth: 1` on the same tree the collected set is `{Atlas/People, Atlas/202 Notes, Atlas/README.md}` (no descent into any folder), sorted to `[Atlas/202 Notes (folder), Atlas/People (folder), Atlas/README.md (file)]`.

### §8 — Validation and error messages

New or changed error surfaces introduced by this spec:

| Where | Condition | Code | Message |
|-------|-----------|------|---------|
| `mapSearchRequest` | `args['depth']` present but not a positive integer | `VALIDATION_ERROR` | `"depth must be a positive integer"` |
| `mapSearchRequest` | `args['path'] === ""` | `VALIDATION_ERROR` | `"path must not be empty. Use '/' to list the vault root."` |
| `listDir` adapter | `path` resolves to a `TFile` | `VALIDATION_ERROR` | `"listDir target must be a folder, got file: {path}"` |
| `listDir` adapter | `path` does not resolve to any existing entry | `NOT_FOUND` | `"Path not found: {path}"` |

The `"/"` → `undefined` normalization is **not** an error — it is a silent mapper transformation. The path-access gate and the adapter both see `undefined` in that case.

## Testing Strategy

### Unit tests — `test/obsidian/search-adapter.test.ts` (or new `listdir.test.ts`)

- `depth` omitted → recursive, files + folders, deterministic set matching the fixture tree
- `depth: 1` on root → only direct children of vault root
- `depth: 1` on `Atlas` → only direct children of `Atlas`, not `Atlas` itself
- `depth: 2` → two levels of descent (matches the worked trace in §7)
- `childCount` correctness for a folder with mixed files and subfolders
- `type` correctly set to `'file'` and `'folder'`
- Empty folder → `childCount: 0`, walks without errors
- Path resolves to a file → returns `VALIDATION_ERROR` with the exact message from §8
- Path does not exist → returns `NOT_FOUND` with the exact message from §8
- `path: "/"` on root → equivalent result to `path` omitted
- Hidden folder (`.obsidian`) → skipped entirely, children not recursed into
- Hidden file (e.g. `.DS_Store` added to fixture) → skipped
- **Sort ordering:** folders precede files in the result; within each group sort is alphabetical; multiple runs on the same fixture return identical order

### Unit tests — `test/mcp/request-mapper.test.ts`

- `depth: 0` → `VALIDATION_ERROR: depth must be a positive integer`
- `depth: -1` → `VALIDATION_ERROR`
- `depth: 1.5` → `VALIDATION_ERROR`
- `depth: "1"` (string) → `VALIDATION_ERROR`
- `depth: 1` → mapped to `result.depth = 1`
- `depth` omitted → `result.depth === undefined`
- `path: ""` → throws `VALIDATION_ERROR` with message `"path must not be empty. Use '/' to list the vault root."` (Bug #4 fix)
- `path: "/"` → mapped to `result.path === undefined` (canonical root marker)
- `path` omitted → `result.path === undefined`
- `path: "Atlas"` → mapped to `result.path === "Atlas/"` (existing normalization)
- `path: "Atlas/"` → mapped to `result.path === "Atlas/"` (existing, unchanged)

### Integration test — MCP tool layer

- End-to-end `kado-search operation="listDir" path="100 Inbox/"` reproducer for Bug #1. Asserts no 406 / proper success response. This is the test that drives the root-cause investigation.
- Scope-filtered listDir: key with `scopePatterns: ["Atlas/**"]` sees the `Atlas` folder itself in a root listing.
- Hidden folder: listing vault root does not include `.obsidian` or `.trash` folder entries.
- `path: "/"` on `listDir` returns the same items as `path` omitted.
- `path: "/"` on `byContent` returns the same items as `path` omitted (whole-vault search parity).
- `path: ""` on any search operation returns `VALIDATION_ERROR` with the helpful "use '/' instead" message.
- `path: "nonexistent/folder"` returns `NOT_FOUND`, not an empty list.
- `path: "existing-file.md"` returns `VALIDATION_ERROR` with the "got file" message.
- Paginated listDir with `limit: 3` on a folder with mixed folders and files: page 1 contains folders first; the file section only begins once all folders have been served.

### Test vault

The existing `test/MiYo-Kado/` fixture vault must be extended to support the new walk semantics. Required additions:

- At least one subdirectory three levels deep (to exercise `depth: 1`, `depth: 2`, `depth: 3`)
- A folder containing only subfolders (no files) to verify empty-intermediate-folder walk
- An empty folder at some level to verify `childCount: 0`
- A hidden folder (`.obsidian` already exists, confirm it stays invisible)

## Documentation Updates

- **`src/mcp/tools.ts`** — `kadoSearchShape`:
  - Add `depth: z.number().int().positive().optional().describe('Walk depth for listDir. Omit for unlimited recursion. depth=1 returns only direct children.')`
  - Update `listDir` description in the tool definition to mention: "returns both files and folders sorted folders-first then alphabetically; items have a `type: 'file'|'folder'` discriminator; folder items include `childCount`."
  - Update `path` description to document: `/` is the canonical vault-root marker; trailing slashes are accepted on non-root paths; empty string is rejected with a helpful error; non-existent paths return `NOT_FOUND`; file targets return `VALIDATION_ERROR`.
- **`docs/api-reference.md:498-509`** — update listDir section with new response shape, depth parameter, `/` root marker, folders-first sort, error semantics, and examples for both `depth: 1` shallow scan and unlimited recursive.
- **Handoff acknowledgements** (post-ship):
  - `_inbox/from-kokoro/2026-04-09_kokoro-to-kado_listdir-depth-and-folder-items.md` → `status: done`
  - `_inbox/from-tomo/2026-04-11_tomo-to-kado_listdir-api-gaps.md` → `status: done` with note that Tomo can now remove the Python workarounds

## Migration & Rollout

- No feature flag. Additive optional parameters + additive optional response fields.
- Version bump in `manifest.json` (patch or minor — decide at implementation based on whether we consider depth a user-visible feature).
- Update `docs/api-reference.md` in the same PR as the implementation.
- The change is behavior-visible (listDir now returns folders by default), but all consumers are LLMs reading the MCP tool schema — the updated schema description is the migration.

## Parking Lot — explicit non-goals for follow-up specs

- Add `type: 'file'` to responses from `byName`, `byTag`, `byContent`, `byFrontmatter` for response-shape consistency across search operations.
- Folder `mtime` / `ctime` via `app.vault.adapter.stat()` if a use case emerges.
- Richer folder metadata (total descendant count, aggregate size) via a dedicated `folderInfo` or `stats` operation.
- Separate `listChildren` operation if we ever need different semantics than depth-based listDir.

## Approach Selection Rationale

Three approaches were considered during brainstorming:

- **A: Boolean `recursive`** — simpler API (`recursive: true | false`) but cannot express depth=2 or depth=3.
- **B: Numeric `depth`** — ✅ **selected.** Matches Kokoro's original proposal 1:1, supports arbitrary depth if needed later, and `undefined` still means unlimited recursion so the default stays backward compatible.
- **C: Separate `listChildren` operation** — maximum backward compatibility but leaves two operations with overlapping semantics in the long term.

Approach B was chosen because the flexibility cost over A is marginal (one extra validation branch at the mapper, same adapter walk code) and the "obvious" semantics (undefined = unlimited, N = N levels) are easy to document and reason about.

Scope filtering, hidden entries, default folder visibility, and the root marker were all explicitly decided during the gap-review pass and subsequent user-review iteration:
- Folders are visible in the default (no-depth) recursive listing, not just when depth is set. Rationale: all consumers are MCP clients reading the updated tool schema, there are no dumb clients assuming file-only responses.
- Folders pass scope filtering if any scope pattern could match a child of that folder (user-intuition resolution, not pure glob-match).
- Hidden entries (any file or folder whose name starts with `.` — includes `.obsidian`, `.trash`, `.git`, `.DS_Store`, `.gitignore`) are skipped entirely during the walk.
- **Sort order: folders first, then files** (within each group alphabetical). Rationale: paginated responses need to let clients know when the folder set is complete without fetching every page — placing folders first gives a clean boundary.
- **`/` is the canonical vault-root marker;** `""` is rejected with a helpful error. Rationale: making `/` explicitly mean root removes the undocumented "omit path" convention and gives callers a documentable, intuitive form.
- **Non-existent path → `NOT_FOUND`, file target → `VALIDATION_ERROR`.** Rationale: silent empty lists hide debugging information; explicit errors let clients distinguish typos from wrong-type requests.
