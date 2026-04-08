# Phase 3 — M6 Single Key Resolution

**Spec refs:** PRD Feature 2, SDD §2.3

## Tasks

1. **Extend CoreRequest** in `src/types/canonical.ts`
   - Add optional `resolvedKey?: ApiKeyConfig` field
   - Document: "populated by permission-chain entry; gates should prefer this over `config.apiKeys.find`"

2. **Single resolve in permission-chain** in `src/core/permission-chain.ts`
   - Resolve key once at the top of `evaluatePermissions()`
   - Attach via `{ ...request, resolvedKey: found }` before invoking the chain
   - If not found: pass original request (authenticateGate handles unknown-key error)

3. **Gate fallbacks** — each request-path gate uses `request.resolvedKey ?? config.apiKeys.find(...)`
   - `src/core/gates/authenticate.ts:28` — keep direct find (authoritative check); set `resolvedKey` via return? Actually: no — authenticate runs first, and permission-chain already set it. But authenticate must still validate the key exists. Keep its `find` as-is (authoritative), but the downstream gates already got the resolved key.
   - `src/core/gates/key-scope.ts:34` — fallback pattern
   - `src/core/gates/datatype-permission.ts:69, 86, 109` — fallback pattern (3 callsites)

4. **Unit tests** in `test/core/permission-chain.test.ts` (create if missing)
   - Spy on `Array.prototype.find` or wrap `config.apiKeys` with a proxy counting `.find` calls
   - Test: happy-path request triggers exactly 1 `.find` for key resolution (authenticateGate's own check is allowed, counted separately)
   - Test: gates honor `resolvedKey` when set (skip their own find)
   - Test: unknown key path still returns `UNKNOWN_KEY` error

5. **Regression check** — existing gate tests must still pass without modification (factories unchanged)

## Files touched

- `src/types/canonical.ts` (+ optional field)
- `src/core/permission-chain.ts` (single resolve)
- `src/core/gates/key-scope.ts` (fallback)
- `src/core/gates/datatype-permission.ts` (3x fallback)
- `test/core/permission-chain.test.ts` (new or extended)

## Acceptance

- PRD Feature 2 acceptance criteria pass
- Existing 7+ gate test files pass unchanged
- Spy test proves single-resolve invariant
- `npm test`, `npm run lint`, `npm run build` green

## Commit

`refactor(gates): resolve API key once per request (M6)`
