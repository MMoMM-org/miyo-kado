# Phase 2 — L8 Rate-Limit Periodic Eviction

**Spec refs:** PRD Feature 5, SDD §2.2

## Tasks

1. **Add periodic timer** in `src/mcp/server.ts`
   - Add `EVICTION_INTERVAL_MS = 60_000` constant
   - Add private field `evictionInterval: ReturnType<typeof setInterval> | null`
   - In `start()`: schedule `setInterval(() => this.evictExpiredRateLimitEntries(Date.now()), EVICTION_INTERVAL_MS)`
   - In `stop()`: `clearInterval` and null out
   - New method `evictExpiredRateLimitEntries(now)` reuses existing logic but without the 10k guard

2. **Unit tests** in `test/mcp/server.test.ts`
   - `vi.useFakeTimers()` pattern (already used in this file for retry tests)
   - Test: after 60s tick, expired entry removed even with map size < 10k
   - Test: `stop()` clears the interval (advance time after stop, no eviction)
   - Test: timer not started if `start()` was never called

## Files touched

- `src/mcp/server.ts` (additive: interval + lifecycle)
- `test/mcp/server.test.ts` (+tests)

## Acceptance

- PRD Feature 5 acceptance criteria pass
- Existing size-triggered eviction still works (hard backstop)
- No timer leak after `stop()`
- `npm test`, `npm run lint`, `npm run build` green

## Commit

`feat(mcp): periodic eviction of expired rate-limit entries (L8)`
