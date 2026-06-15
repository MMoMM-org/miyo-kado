# Context — Kado
<!-- Current sprint focus, active work, known blockers. Updated: 2026-06-15 -->
<!-- This file is short-lived — prune entries older than 2 weeks via /memory-cleanup -->

## Active focus

None — no active sprint. v1 plus specs 006 (open-notes), 007 (partial read/write),
and 008 (kado-rename) have shipped to master. Cross-repo contract handoffs for the
rename tool (Kokoro contract + refinements, Tomo availability) are out; Kokoro
confirmed done.

## Open tech debt (deferred review items)

Carried over from the v1 hardening review (2026-04-01). All low priority, none blocking.

### R1/H5 — Audit buffered writes
- Location: `src/main.ts` / `src/core/audit-logger.ts`
- Concern: audit write reads the full log on every entry; should buffer + batch append.
- Reason deferred: significant write-chain refactor; C1 fix already added `.catch()` recovery.

### R14/L4 — Unbounded glob pattern complexity
- Location: `src/core/glob-match.ts`
- Concern: no validation on pattern length/depth; ReDoS potential.
- Status: largely mitigated — patterns are memoized and "small and finite" by design;
  admin-only config surface. Keep as a watch item, not active work.

### R15/L8 — evictStaleEntries only triggers at 10K IPs
- Location: `src/mcp/server.ts` (`MAX_TRACKED_IPS = 10_000`)
- Concern: stale rate-limit entries never cleaned until the 10K threshold.
- Reason deferred: negligible impact in single-user Obsidian deployment.

<!-- Pruned 2026-06-15 (/memory-cleanup): Spec 002 UI-settings implementation status
     (merged), R2/H9 (resolved — Kokoro contract submitted), R7/M6 (resolved — resolvedKey
     cache added across the gate chain), R13/M18 (resolved — test/settings/** now exists). -->
