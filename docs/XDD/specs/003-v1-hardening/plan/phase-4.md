# Phase 4 — H5 Buffered Audit Writes

**Spec refs:** PRD Feature 1, SDD §2.4

## Tasks

1. **Buffer state** in `src/core/audit-logger.ts`
   - Add private `buffer: string[]`, `flushTimer`, `flushingPromise`, `FLUSH_INTERVAL_MS = 500`
   - Refactor `log(entry)` to push to buffer + schedule timer instead of direct write
   - New public `flush(): Promise<void>` — idempotent, reentrant, drains buffer

2. **Append-only write migration** in `src/main.ts`
   - Change `deps.write(line)` from read+concat+write to `adapter.append(path, line)`
   - Preserve `writeChain` wrapping
   - Verify behavior against both create-file and append-existing cases

3. **Rotation per flush** — move size check into `_doFlush`, not per `log`

4. **Retry on failure** — prepend failed lines back to `buffer`, log via `kadoError`, do not throw

5. **updateConfig** — flush before disabling audit

6. **Unload flush** in `src/main.ts:onunload`
   - `await this.auditLogger?.flush()` before `mcpServer.stop()`

7. **Unit tests** in `test/core/audit-logger.test.ts`
   - `vi.useFakeTimers()` + `advanceTimersByTimeAsync`
   - Test: 10 entries in <500ms → 0 writes; after 500ms → 1 write with 10 lines
   - Test: `flush()` called twice concurrently → single underlying write
   - Test: write failure retained in buffer, next flush retries
   - Test: `updateConfig({enabled:false})` flushes pending first
   - Test: rotation runs once per flush, not per entry

8. **Integration tests** in `test/mcp/audit-integration.test.ts`
   - Update assertions to `await auditLogger.flush()` before reading captured lines
   - Or switch to fake timers + advance

## Files touched

- `src/core/audit-logger.ts` (buffer + flush)
- `src/main.ts` (append migration + unload flush)
- `test/core/audit-logger.test.ts` (+tests)
- `test/mcp/audit-integration.test.ts` (assertion flush)

## Acceptance

- PRD Feature 1 acceptance criteria pass
- Existing audit tests green
- `npm test`, `npm run lint`, `npm run build` green

## Commit

`feat(audit): buffered writes with 500ms flush timer (H5)`
