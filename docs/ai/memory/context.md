# Context — Kado
<!-- Current sprint focus, active work, known blockers. Updated: 2026-06-23 -->
<!-- This file is short-lived — prune entries older than 2 weeks via /memory-cleanup -->

## Active focus

Tool-layer enrichment on branch `feat/tool-layer-enrichment` (one PR, not yet
pushed/merged) — three features, all unit-tested (1509 green) AND live-verified
against the running vault:
1. `kado-search byContent` is now full-text *ranked* with `score` + `snippets`
   (pure `src/core/content-score.ts`).
2. Optional additive `_hints` on tool responses (pure `src/mcp/hints.ts`) — see
   ADR-003.
3. New **`kado-graph`** tool (backlinks/outgoing/neighbors/related/dangling) with
   a link-disclosure guard — see ADR-002. Index lifecycle in `main.ts` rebuilds on
   the metadataCache `resolved` event.
Live-test fixtures added under `test/MiYo-Kado/allowed/Graph Demo *`. Decisions in
`decisions.md` (3× 2026-06-23); ADR-002/003 in `docs/XDD/adr/`. Next: open the PR.

v1 plus specs 006 (open-notes), 007 (partial read/write), and 008 (kado-rename)
shipped to master earlier; rename cross-repo handoffs (Kokoro/Tomo) confirmed done.

## Open tech debt

None tracked. The v1-hardening review items (2026-04-01) are all closed:
- R1/H5 (audit buffered writes) — DONE: `audit-logger.ts` buffers + batch-flushes
  (500ms timer / `flush()` on unload); `main.ts` writes via `adapter.append`, size via
  `adapter.stat` (no read-modify-write).
- R14/L4 (glob ReDoS) — DONE: `validateGlobPattern` caps length (256) + consecutive
  `**` (3), wired into the settings path editor (`PathEntry.ts`); regex cache evicts at 1000.
- R15/L8 (rate-limit eviction) — DONE: periodic 60s timer (`evictExpiredEntries`,
  `server.ts`) clears expired entries regardless of map size.
- R2/H9, R7/M6, R13/M18 — resolved earlier (Kokoro contract submitted; `resolvedKey`
  cache across the gate chain; `test/settings/**` now exists).
