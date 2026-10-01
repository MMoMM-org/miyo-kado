# ADR-004: Pathless / Vault-Wide Tool Authorization

*Status:* Accepted
*Date:* 2026-10-01 (records the design shipped in Kado 1.2.0, 2026-07-18, #98/#99)

## Context and Problem Statement

Every per-note Kado tool authorizes against a concrete `path`: the full gate chain (global-scope → key-scope → path-access → datatype-permission) runs on the request's path, and tools that touch additional paths compose that same chain over synthetic single-path requests (rename-policy, [decisions.md 2026-06-14]; graph-policy, ADR-002).

`kado-graph-audit` (orphans + dead wikilinks across the whole vault, in one call) is Kado's first **pathless, vault-wide aggregate** tool. It has no source path. There is nothing for the gate chain to evaluate, and there is no natural synthetic path to stand in for one. `kado-open-notes` was already pathless, but it is gated by explicit feature flags (`allowActiveNote`/`allowOtherNotes`) and returns workspace state rather than a vault-wide scan.

The Core must decide (a) what authorizes a request that names no path, and (b) how to keep a vault-wide result from disclosing paths, or content, outside the calling key's scope. The answer sets the pattern for any future pathless or aggregate tool (vault statistics, tag census, link health, …).

## Decision

### 1. Authorize with the authenticate gate only

A pathless tool runs `authenticateGate.evaluate(request, config)` directly: a valid, enabled key is required, and nothing more is checked at request level. It does **not** run the full gate chain and does **not** synthesize a source path. Denials are audited via `logDenied` like any other gate failure.

### 2. Enforce disclosure per result node, in the tool layer

After the Core returns the unfiltered vault-wide result, the MCP tool layer drops every node the key may not see, using `isPathPermittedForKey(path, key, config)` (global AND key path scope). This is the same predicate used by `kado-graph` and `kado-open-notes`. Each node is filtered by the path it **discloses**:

- **Orphans** are real note paths, so each is filtered by its own path.
- **Dead links** are filtered by their `source` path. The `target` is unresolved link *text*, not a path, so it rides on the source note's visibility. This is the same rule as `kado-graph`'s `dangling` exemption (ADR-002) and the `listNotes` source-note boundary ([decisions.md 2026-06-04]).

Out-of-scope nodes are **silently omitted**: no error, no count, no existence signal.

### 3. Totals and pagination are post-ACL

`total` counts and the pagination window are computed **after** filtering (`paginateAudit`). A pre-filter total would leak the number of out-of-scope orphans or dead links.

### Invariant

> A pathless tool's response contains only nodes whose disclosing path lies within the calling key's global AND key path scope. Every count and cursor it returns is derived from the filtered set.

## Options Considered

### 1. Run the full gate chain on a synthetic vault-root path (Rejected)
For example, gate a `note.read` on `''` or `/`. **Rejected:** whether a key "can read the root" has no meaning in a whitelist model. It would deny most narrowly scoped keys outright, even though they could legitimately audit their own subtree. It would also invent a permission semantics the config UI never exposes.

### 2. Require permission on every path in the vault (Rejected)
Fail closed if any node is out of scope. **Rejected:** this is the same side-channel ADR-002 rejected. A denial signals that out-of-scope content exists, and the tool becomes unusable for any key that isn't vault-wide.

### 3. A dedicated per-tool feature flag, as in `kado-open-notes` (Rejected for now)
**Rejected:** it adds a settings toggle per aggregate tool, and it doesn't replace per-node filtering, which is still needed for disclosure. YAGNI until a pathless tool exposes something beyond in-scope paths and their own content.

### 4. Authenticate-only gate + per-node ACL filtering + post-ACL totals (Chosen)
No new gates and no new config. It reuses the existing scope predicate and the precedents from ADR-002 and open-notes. A narrowly scoped key gets a correct audit of exactly its slice of the vault.

## Consequences

### Positive
- **Reusable shape** — any future pathless tool follows the same three steps: authenticate, filter each node by its disclosing path, compute totals and cursors after filtering.
- **No new gates, no config surface** — the access model stays two-layer (global ∧ key) and can't drift from the per-note tools.
- **No count leaks** — post-ACL totals mean an allowed-only key can't infer how much lies outside its scope.

### Negative / Risks
- **Path scope, not datatype permission.** `isPathPermittedForKey` checks path *scope* only, not the per-path `DataTypePermissions`. A key whose rule matches a path but grants no `note.read` there (e.g. frontmatter-only) still sees that path's orphans, and the dead-link target text from those notes' bodies. `kado-graph` doesn't have this gap, because it gates `note.read` on the source first (ADR-002 §1). The exposure is limited to paths already inside the key's scope. Tightening the per-node filter to also require `note.read` is a candidate follow-up.
- **Unfiltered work in the Core** — the adapter computes the full vault-wide result before the tool layer filters it. The cost scales with vault size, not key scope. This is acceptable because the data comes from Obsidian's in-memory link maps, with no per-note disk reads.
- **Union-type friction** — the pathless `CoreGraphAuditRequest` has no `operation`. Code that assumed every `CoreRequest` has one (`extractDataType`, `debugFields`, audit logging) now guards with `'operation' in request`. The request is audited as a note read.
- **Index lag inherited** — the same characteristic as `kado-graph` and `kado-search`.

## References

- ADR-001 (Dual ACL architecture): filtering lives in the MCP tool layer; the Core stays unaware of keys
- ADR-002 (kado-graph link-disclosure guard): the per-path counterpart; dangling-as-source-content rule reused for dead links
- `decisions.md` 2026-04-20: `kado-open-notes` silent path-ACL filtering and authenticate-gate precedent
- `decisions.md` 2026-06-04: `listNotes` source-note disclosure boundary
- Implementation: `src/mcp/tools.ts` (`registerGraphAuditTool`, `paginateAudit`, `isPathPermittedForKey`), `src/obsidian/graph-adapter.ts` (`audit`), `CoreGraphAuditRequest` in `src/types/canonical.ts`
- Client docs: `docs/api-reference.md` § Tool: kado-graph-audit
