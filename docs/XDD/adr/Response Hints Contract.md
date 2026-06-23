# ADR-003: `_hints` Response-Enrichment Contract

*Status:* Accepted
*Date:* 2026-06-23

## Context and Problem Statement

Kado's tool responses are bare canonical results — a read returns content + timestamps, a search returns items + cursor, an error returns `{code, message}`. An MCP client (usually an LLM) frequently has to infer the obvious next step on its own: re-read after a `CONFLICT`, pass the cursor to get the next page, read the top search hit, continue a truncated read. When it guesses wrong it wastes a round-trip or stalls.

A survey of `aaronsb/obsidian-mcp-plugin` showed a richer model — responses carry `workflow.suggested_next` guidance — but with two failure modes worth avoiding: (1) the suggestions are driven by a Petri-net-style **state-token machine** whose router is re-instantiated per call, so the cross-call state is effectively dead; (2) the guidance is configured via a JSON DSL whose shipped default is nearly empty, so most hints never fire. The lesson: guidance is valuable, but it must be **stateless and always-on**, not a stateful engine or an opt-in config.

We need to decide whether/how to add next-step guidance to Kado responses without (a) breaking the existing response contract, (b) introducing server-side session state, or (c) becoming prescriptive.

## Decision

Add an **optional, additive `_hints` array** to any tool response (success or error).

### Shape
```ts
interface Hint {
  do?: string;                       // tool to call next (absent ⇒ advisory only)
  with?: Record<string, unknown>;    // suggested arguments
  why: string;                       // one-sentence rationale
}
```
Attached under the `_hints` key only when non-empty; absent otherwise. It never changes the rest of the payload.

### Stateless by construction
Every hint is a **pure function of the current request + result/error** — there is no cross-call state machine and no config DSL. Kado's MCP server is already stateless per request (a fresh server per call, ADR-001), so a state machine would be dead weight exactly as in the surveyed plugin. Hints live as plain TypeScript in `src/mcp/hints.ts` (`deriveHints`), are always active, and are unit-tested.

### Covered cases (each derivable from one response alone)
| Trigger | Hint |
|---|---|
| `CONFLICT` (write/delete/rename) | re-read the path, then retry with the fresh `expectedModified` |
| search `cursor` present | re-call the same search with the cursor (next page) |
| non-empty `byContent`/`byName`/`byTag` | read the top-ranked hit |
| read `truncated: true` | continue with a `range` read at the next char offset |
| `tags` read `returnedTags: "FrontmatterOnly"` | advisory: inline tags need `note.read` |
| `FORBIDDEN` | advisory only (`why`, no `do`); no internal gate detail leaked |

### Non-prescriptive
Hints are guidance, not instructions. Clients may ignore `_hints` entirely; it carries no control semantics and is safe to drop. The `do`-less advisory form exists precisely so error guidance never implies a mandatory action.

## Options Considered

### 1. No hints — keep bare responses (Rejected)
Zero risk, zero help. **Rejected:** the round-trip waste (especially the CONFLICT→re-read→retry loop and un-paginated searches) is real and cheap to remove.

### 2. State-token / workflow engine (as surveyed) (Rejected)
Track session state, drive suggestions from accumulated tokens. **Rejected:** Kado is stateless per request; the engine's state would be dead on arrival (the exact failure observed in the surveyed plugin), and it is far more machinery than the value warrants.

### 3. JSON-DSL-configured hints (as surveyed) (Rejected)
External config mapping operation→hints. **Rejected:** the surveyed default shipped empty (hints silently inert); a DSL adds an untested indirection layer for guidance that is better expressed and tested as code.

### 4. Optional additive `_hints`, derived purely from the current response (Chosen)
Stateless, always-on, typed, unit-tested, ignorable. Minimal surface; cannot break existing clients.

## Consequences

### Positive
- **Tighter agent loops** — the CONFLICT→re-read, pagination, and truncation-continue paths are signposted; live-verified end-to-end.
- **No new failure modes** — stateless and additive; absent when nothing applies; clients that ignore it are unaffected.
- **No leakage** — `FORBIDDEN` hints are generic advisories (M7-consistent: no internal gate details).
- **Testable** — `deriveHints` is pure (no Obsidian/SDK), covered by unit tests; attachment covered in `response-mapper` and end-to-end in `tools` handler tests.

### Negative / Risks
- **Threading cost** — handlers must call `deriveHints` and pass the result into the `map*`/`mapError` functions at each relevant return site (mechanical, repeated across the 7 tools).
- **Naming convention** — clients must know `_hints` is meta (the leading underscore signals "ignorable"); documented in `docs/api-reference.md`.
- **Scope creep risk** — the temptation to add many hints. Kept deliberately to high-value, single-response-derivable cases; no "explore the graph" style noise.

## References

- ADR-001 (stateless per-request MCP server) — the reason a state machine would be dead weight
- Survey: `aaronsb/obsidian-mcp-plugin` semantic-operations / workflow-hints (the anti-patterns avoided: per-call router state, empty default config)
- Implementation: `src/mcp/hints.ts` (`deriveHints`), `src/mcp/response-mapper.ts` (`withHints`), `src/mcp/tools.ts` (handler wiring)
- `docs/api-reference.md` — client-facing `_hints` documentation
