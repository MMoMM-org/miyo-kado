# ADR-002: kado-graph Link-Disclosure Guard

*Status:* Accepted
*Date:* 2026-06-23

## Context and Problem Statement

`kado-graph` navigates the vault's link structure (`backlinks`, `outgoing`, `neighbors`, `related`, `dangling`). Unlike `kado-search listNotes` — which returns each note's *raw, unresolved* outlink text (the source-note disclosure boundary, see [decisions.md 2026-06-04]) — graph navigation **resolves links to concrete vault paths** and follows them across notes:

- `backlinks(X)` returns the paths of notes that link **to** X — notes the calling key may have no permission to read.
- `outgoing(X)` / `neighbors(X)` / `related(X)` resolve X's links to target **paths**, which may sit outside the key's scope.

This is materially different from `listNotes`. There, a returned link target is literal text already present in a note the key can read in full, so echoing it grants no new access. Here, a resolved path is a *fact about a file the key was never authorized to see* — its existence, name, and location. Returning it unfiltered would be a disclosure channel: an allowed-only key could enumerate paths in `nope/` simply by traversing links from an allowed note that happens to link there.

The Core must therefore decide (a) what permission authorizes a graph traversal at all, and (b) what to do with resolved nodes that fall outside the key's scope.

## Decision

### 1. Authorize a graph traversal as a `note` read on the source

`kado-graph` requires `note.read` permission on the **source** `path`. Rather than teach the gate chain a new request shape, the tool composes the **existing** gate chain over a synthetic `CoreReadRequest { operation: 'note', path }` (`src/core/graph-policy.ts` → `evaluateGraphPermissions`). This mirrors the rename-policy pattern (synthetic single-path requests, [decisions.md 2026-06-14]): global-scope, key-scope, path-access, and datatype-permission all enforce with **zero new gates**. A graph request is audited as a `note` read (`extractDataType` maps it to `note`).

### 2. Scope-filter resolved result nodes; never filter dangling

After traversal, the tool layer (`registerGraphTool` in `src/mcp/tools.ts`) **drops every resolved result node the key cannot read**, using the same `isPathPermittedForKey` predicate as `kado-open-notes`' ACL filter (global AND key path scope). Out-of-scope neighbours are **silently omitted** — no error, no count, no existence signal — the same privacy invariant as open-notes' silent ACL filtering ([decisions.md 2026-04-20]).

`dangling` targets are the **exception**: they are the source note's own unresolved link *text* (raw strings, not paths, that resolve to nothing), identical in nature to `listNotes` raw outlinks. The key can already read that text via `operation='note'`, so dangling targets are returned unfiltered.

### Invariant

> A `kado-graph` response never contains a resolved vault path the calling key lacks `note.read` permission for. The only paths a key sees are: its authorized source, and resolved neighbours within its own scope. Dangling (unresolved) targets are source-note content and are exempt.

## Options Considered

### 1. No filtering — return all resolved nodes (Rejected)
Simplest, and consistent with "the graph is just structure." **Rejected:** it is a real disclosure channel. An allowed-only key could map `nope/` by reading backlinks/outgoing of any allowed note that links across the boundary. Graph resolves to paths; `listNotes`' "it's just readable text" justification does not apply.

### 2. Deny the whole traversal if any neighbour is out of scope (Rejected)
Fail-closed at the request level. **Rejected:** leaks existence by side channel (the denial itself signals an out-of-scope neighbour exists), and makes graph nearly useless near scope boundaries. Silent per-node filtering is both safer and more useful.

### 3. Gate graph as a first-class request type with its own gate logic (Rejected)
Add `graph` awareness to `datatype-permission` etc. **Rejected:** duplicates the read-permission semantics already in the chain and risks drift between graph and the other tools. The synthetic-read composition (option chosen) reuses one source of truth.

### 4. Synthetic note read on source + silent per-node scope filter (Chosen)
Authorizes via the existing chain, filters resolved nodes with the existing ACL predicate, exempts dangling as source content. Minimal new code, no new gates, consistent with open-notes and rename precedents.

## Consequences

### Positive
- **No path disclosure across scope** — live-verified: an allowed-only key traversing a note that links to `nope/Credentials.md` sees the in-scope neighbour only; the out-of-scope target is absent.
- **Zero new gates** — graph inherits global-scope/key-scope/path-access/datatype-permission unchanged; the two-layer access model can't drift.
- **Consistent privacy model** — silent filtering matches `kado-open-notes`; dangling-as-content matches `listNotes`.

### Negative / Risks
- **Partial graphs near boundaries** — a traversal may return fewer nodes than the raw link structure has. This is intended, but a client cannot distinguish "no neighbour" from "neighbour filtered." Acceptable: the alternative leaks existence.
- **Two-step cost** — permission is checked on the source, then every resolved node is re-checked against the ACL. O(nodes) predicate calls per traversal; negligible for normal link counts.
- **Index lag inherited** — graph reads Obsidian's in-memory `resolvedLinks` (see [decisions.md 2026-06-23 kado-graph]), so results can briefly lag the disk like `kado-search`.

## References

- ADR-001 (Dual ACL architecture) — graph stays Core-pure; traversal logic in `src/core/graph-traverse.ts`, adjacency/dangling in `src/obsidian/link-graph-index.ts`
- `decisions.md` 2026-06-04 — `listNotes` source-note disclosure boundary (the contrasting case: raw targets, no resolution)
- `decisions.md` 2026-04-20 — `kado-open-notes` silent path-ACL filtering (same privacy invariant)
- `decisions.md` 2026-06-14 — rename-policy synthetic single-path permission composition (same pattern)
- Implementation: `src/core/graph-policy.ts`, `src/mcp/tools.ts` (`registerGraphTool`), `src/obsidian/graph-adapter.ts`
