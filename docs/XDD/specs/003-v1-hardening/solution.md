---
title: "Kado v1 Hardening — Solution Design"
status: draft
version: "1.0"
---

# Solution Design Document

## Validation Checklist

### CRITICAL GATES (Must Pass)

- [x] Every PRD feature has a design section
- [x] All external interfaces are specified
- [x] Design preserves existing invariants (writeChain, gate order, config format)
- [x] Test strategy is defined for every feature
- [x] No [NEEDS CLARIFICATION] markers remain

### QUALITY CHECKS (Should Pass)

- [x] Trade-offs explicitly documented
- [x] Rollback path exists for every change
- [x] New surface area minimized (no speculative abstractions)
- [x] Risks have mitigations

---

## 1. Scope & Context

Design layer for PRD `requirements.md`. Covers five hardening items:

| ID | Feature | Scope |
|----|---------|-------|
| H5 | Buffered audit writes | `src/core/audit-logger.ts`, `src/main.ts` |
| M6 | Single key resolution | `src/core/permission-chain.ts`, `src/core/gates/*` |
| M18 | Settings UI component tests | `test/settings/**`, `test/__mocks__/obsidian.ts` |
| L4 | Glob pattern validation | `src/core/glob-match.ts`, config save path |
| L8 | Rate-limit periodic eviction | `src/mcp/server.ts` |

Implementation order (ascending risk): L4 → L8 → M6 → H5 → M18.

All five items are additive refactors or pure additions. No public API/config changes. No runtime dependencies added.

---

## 2. Feature Designs

### 2.1 L4 — Glob Pattern Validation

**Problem recap:** admin glob patterns compile to RegExp without length/depth limits → catastrophic backtracking risk.

**Design.** Add a pure validator in `glob-match.ts` alongside the existing `matchGlob` functions. Validation runs at the **config-save boundary** (Settings UI), not at match time — match time stays on the hot path and is unchanged.

**Interface:**

```ts
export type GlobValidationResult =
  | { ok: true; warnings: string[] }
  | { ok: false; error: string };

export function validateGlobPattern(pattern: string): GlobValidationResult;
```

**Rules:**

| Rule | Threshold | Outcome |
|------|-----------|---------|
| Length | pattern.length > 256 | `{ ok: false, error: "pattern exceeds 256 characters" }` |
| Consecutive `**` | `/(\*\*\/){4,}/` | `{ ok: false, error: "too many consecutive ** segments" }` |
| Bare `**` | pattern === `**` | `{ ok: true, warnings: ["matches entire vault"] }` |
| Default | — | `{ ok: true, warnings: [] }` |

**Integration points:**
- `PathEntry` component (`src/settings/components/PathEntry.ts:50`) — call validator in its input validation path. On error: show inline error, don't propagate `onChange`. On warning: surface non-blocking notice.
- Validator is pure and reusable — can also be called from `ApiKeyTab` paths later without adding coupling.

**Test strategy:**
- Unit tests in `test/core/glob-match.test.ts` (existing file) — table-driven: valid, too-long, too-deep, bare, warnings, edge cases.
- Behavioral tests in `PathEntry` component tests (added in M18) — error message surfaces, save is blocked.

**Rollback.** Remove validator call from `PathEntry`; no config format change, no stored data impact.

---

### 2.2 L8 — Rate-Limit Periodic Eviction

**Problem recap:** `requestCounts` map only evicts when size reaches 10k entries. Long-running processes accumulate stale entries.

**Design.** Add a periodic cleanup timer owned by `KadoMcpServer`. Timer runs every 60s, walks the map, deletes expired entries. Lifecycle tied to server start/stop.

**Interface.** Private to `KadoMcpServer`:

```ts
private evictionInterval: ReturnType<typeof setInterval> | null = null;

// In start():
this.evictionInterval = setInterval(() => {
  this.evictExpiredRateLimitEntries(Date.now());
}, EVICTION_INTERVAL_MS);

// In stop():
if (this.evictionInterval !== null) {
  clearInterval(this.evictionInterval);
  this.evictionInterval = null;
}
```

**Constants:**
- `EVICTION_INTERVAL_MS = 60_000` (co-located with existing `WINDOW_MS`).

**Backward compatibility:** the existing size-triggered eviction (`evictStaleEntries` at 10k threshold) stays as a hard backstop. The new periodic timer is additive — makes eviction time-based instead of *only* size-based.

**Test strategy:**
- `test/mcp/server.test.ts` — add tests using vitest `vi.useFakeTimers()`:
  - After 60s tick, expired entries are removed regardless of map size.
  - `stop()` clears the interval (no timer leak after `stop()` + `advanceTimersByTime`).
  - Fresh server without `start()` does not create a timer.

**Rollback.** Remove interval setup; size-triggered eviction remains functional.

---

### 2.3 M6 — Single Key Resolution in Gate Chain

**Problem recap:** 3 request-path gates each independently call `config.apiKeys.find()`. With N keys: O(3N) scans per request. Pattern copies easily to new gates.

**Design.** Resolve the key **once** at chain entry, pass it through an **enriched request context** to every gate.

**Key decision: enrich the request, not the function signature.**

The existing gate signature `evaluate(request, config)` is already used by 5 gates and 7 test files with the `makeRequest()` / `makeConfig()` factories. Breaking that signature is invasive. Instead, add an optional field to the request:

```ts
// In src/types/canonical.ts or a new gate-context.ts
export interface ResolvedApiKey {
  readonly key: ApiKeyConfig; // guaranteed enabled when attached
}

// Extend CoreRequest union:
interface CoreRequest {
  apiKeyId: string;
  // ... existing fields
  resolvedKey?: ApiKeyConfig; // populated by permission-chain entry
}
```

**Flow:**

1. `evaluatePermissions(request, config)` in `permission-chain.ts` resolves `config.apiKeys.find(k => k.id === request.apiKeyId)` exactly once.
2. If not found: pass through to `authenticateGate` which emits the existing "unknown key" error (preserves current error semantics).
3. If found: attach to a new request object `{ ...request, resolvedKey }` and pass that to every gate.
4. Gates use `request.resolvedKey ?? config.apiKeys.find(...)` — the fallback keeps each gate independently testable with the existing `makeRequest()` factory (backward compatible).

**Callsite migration:**

| File | Current | After |
|------|---------|-------|
| `gates/authenticate.ts:28` | `config.apiKeys.find(...)` | Keep — this is the gate that validates existence; it still checks `config.apiKeys` authoritatively for the "unknown key" path. Set `request.resolvedKey` on success. |
| `gates/key-scope.ts:34` | `config.apiKeys.find(...)` | `request.resolvedKey ?? config.apiKeys.find(...)` |
| `gates/datatype-permission.ts:69,86,109` | 3× `config.apiKeys.find(...)` | 3× `request.resolvedKey ?? config.apiKeys.find(...)` |
| `mcp/tools.ts:94,120,147` | `config.apiKeys.find(...)` (pre/post-gate helpers) | Out of scope — these run outside the gate chain, single lookup is fine per call site. |
| `mcp/auth.ts:56` | `config.apiKeys.find(...)` | Out of scope — runs before gate chain for auth middleware. |

**Net result:** 4 request-path `find()` calls collapse to 1 (the entry in `permission-chain.ts`). `authenticateGate` is the only gate that still reads `config.apiKeys` because that is its job.

**Test strategy:**
- Existing gate tests keep working because the `resolvedKey` field is optional — factories don't need to be updated.
- Add new tests in `test/core/permission-chain.test.ts`:
  - `evaluatePermissions` resolves key exactly once (spy on `find`).
  - When `resolvedKey` is attached, downstream gates use it and do not re-scan.
  - Unknown key flows through to authenticate gate unchanged.

**Rollback.** Revert `permission-chain.ts` single-resolve; gates still have their fallback `find()` and keep working.

---

### 2.4 H5 — Buffered Audit Log Writes

**Problem recap:** every audit entry triggers a read-modify-write of the whole log file. O(file-size) per request.

**Design.** Introduce an in-memory line buffer inside `AuditLogger`. Flushes on a 500ms timer **or** on explicit `flush()` call. Unload path calls `flush()` and awaits.

**Key architectural decision: keep `deps` I/O contract stable, add a new `appendLines` dep.**

The current `deps.write(line: string)` reads-modifies-writes. To batch, we need append semantics. Two options:

- Option A: change `write` to append-only and make the caller (main.ts) use `adapter.append()`.
- Option B: add a new dep `appendLines(lines: string[])` and phase out the old `write`.

**Choice: A** — simpler, no new deps, and `adapter.append()` is the natural Obsidian primitive for NDJSON. The write callback in `main.ts:83-84` moves from read+concat+write to `adapter.append(path, line)`. This preserves the `writeChain` serialization.

**New class-level state in `AuditLogger`:**

```ts
private buffer: string[] = [];
private flushTimer: ReturnType<typeof setTimeout> | null = null;
private flushingPromise: Promise<void> | null = null;
private readonly FLUSH_INTERVAL_MS = 500;
```

**Flow:**

1. `log(entry)`:
   - Serialize entry to NDJSON line.
   - `buffer.push(line)`.
   - If `flushTimer === null`: `flushTimer = setTimeout(() => this.flush(), 500)`.
   - Returns immediately (no I/O on the hot path).
2. `flush()` (public, also callable on unload):
   - If `flushingPromise !== null`: await it and return (idempotent / reentrant).
   - Snapshot `buffer`; clear buffer.
   - Clear `flushTimer`.
   - `flushingPromise = this._doFlush(snapshot).finally(() => flushingPromise = null)`.
   - Return `flushingPromise`.
3. `_doFlush(lines)`:
   - Rotation check: `deps.getSize()` once; if > max, `rotate()`.
   - Single `deps.appendLines(lines)` or loop `deps.write(line)` with the new append semantics.
   - On error: **prepend** lines back to `buffer` for retry on next flush, log via `kadoError`, do not throw.

**Concurrency invariants:**
- `writeChain` in `main.ts` still serializes the actual I/O — the flush pipeline calls through `deps` which go through `writeChain`.
- Entries in `buffer` are in insertion order; flush writes them in that order.
- Retry-prepend guarantees FIFO even on partial failure.

**Plugin lifecycle:**
- `onunload()` in `main.ts:131` adds `await this.auditLogger?.flush()` before `mcpServer.stop()`.
- Because unload is async and Obsidian does not strictly await `onunload`, worst-case we lose the final buffer on forced kill — same as today.

**Rotation simplification:** currently called before every `write`. After batching: rotation check runs once per flush (before the append call), not per entry. Satisfies PRD Rule 4.

**Config hot-swap (`updateConfig`):** if the new config disables audit: flush existing buffer first, then apply new config. Prevents "already-queued entries after user disables logging" surprise.

**Test strategy:**
- Unit tests in `test/core/audit-logger.test.ts`:
  - `vi.useFakeTimers()` — 10 entries logged in <500ms → 0 writes. After 500ms tick → 1 write with 10 lines.
  - `flush()` is idempotent when called twice concurrently.
  - `flush()` retries failed entries on next attempt.
  - `updateConfig({enabled:false})` flushes pending entries before disabling.
- Integration tests in `test/mcp/audit-integration.test.ts`: verify existing tests still pass by adding `await auditLogger.flush()` in assertions (or switching them to fake timers).

**Rollback.** Buffer is contained in `AuditLogger`; revert the class and the two-line `main.ts` unload addition. `adapter.append()` migration in `main.ts` can stay (it's strictly better).

---

### 2.5 M18 — Settings UI Component Tests

**Problem recap:** 8 settings components have zero behavioral test coverage.

**Design.** Use `test/__mocks__/obsidian.ts` which already mocks `App`, `Plugin`, `Modal`, `Setting`, `TextComponent`, `ButtonComponent`, `ToggleComponent`, `DropdownComponent`, and DOM helpers. Extend the mock to expose underlying DOM elements (`inputEl`, `buttonEl`, etc.) so tests can simulate clicks/input.

**Mock extensions needed:**

```ts
// test/__mocks__/obsidian.ts
class TextComponent {
  inputEl: HTMLInputElement;
  onChangeCallback: ((value: string) => void) | null = null;
  constructor(containerEl: HTMLElement) {
    this.inputEl = document.createElement('input');
    containerEl.appendChild(this.inputEl);
    this.inputEl.addEventListener('input', () => {
      this.onChangeCallback?.(this.inputEl.value);
    });
  }
  setValue(v: string): this { this.inputEl.value = v; return this; }
  onChange(cb: (v: string) => void): this { this.onChangeCallback = cb; return this; }
}
// Similar for ButtonComponent.buttonEl, ToggleComponent.toggleEl, DropdownComponent.selectEl.
```

All components tested via a shared helper:

```ts
// test/settings/helpers.ts
export function renderInSandbox<T>(render: (el: HTMLElement) => T): { container: HTMLElement; result: T };
export function mockPlugin(configOverrides?: Partial<KadoConfig>): KadoPlugin;
```

**Per-component test plan:**

| Component | Tests |
|-----------|-------|
| `PermissionMatrix` | enabled dot click toggles flag; disabled dot click is no-op; keyboard (Space/Enter) toggles; `onChange` fires once per click |
| `PathEntry` | input updates `rule.path`; invalid path (`..`, `/`, failing `validateGlobPattern`) shows error and does not call `onChange`; remove button fires `onRemove` |
| `TagEntry` | input normalizes `#` prefix on blur; remove button fires `onRemove`; opening picker does not mutate until selection |
| `TagPickerModal` | list renders filtered tags from `availableTags`; selecting a tag calls `onSelect` without `#` prefix; modal closes after select |
| `VaultFolderModal` | lists folders from mock vault; filter narrows list; selecting calls `onSelect(path)`; closes after select |
| `ApiKeyTab` | generate-key creates new key with `kado_` prefix; rename persists to config; delete flow removes key; `plugin.saveSettings()` called exactly once per mutation |
| `GeneralTab` | toggling server enabled mutates config; port input validates; audit toggle mutates; save called per mutation |
| `GlobalSecurityTab` | add-path inserts into `config.security.paths`; list-mode toggle with empty blacklist shows warning; remove path removes from config |

**Coverage target:** 80% line coverage for `src/settings/**` as measured by vitest coverage.

**Test infrastructure additions:**
- `test/settings/helpers.ts` — sandbox DOM helper + plugin factory.
- `test/settings/components/*.test.ts` — one file per component.
- `test/settings/tabs/*.test.ts` — one file per tab.

**Trade-off: jsdom vs. happy-dom.** `jsdom` is already in devDependencies. Confirmed in `package.json`. Use it.

**Rollback.** Tests are additive. Mock extensions in `test/__mocks__/obsidian.ts` are backward-compatible (add fields, don't remove).

---

## 3. Cross-Cutting Concerns

### 3.1 Test Execution

All 5 features add tests. Final state must satisfy:
- `npm run lint` — clean (CI enforces)
- `npm test` — all pass
- `npm run build` — typecheck + esbuild production
- Coverage on `src/settings/**` ≥ 80%

### 3.2 Commit Discipline

One phase per commit (or small commit series inside a phase). Each commit leaves the tree green: `lint + test + build`. This is required by the branch-level CI workflow.

### 3.3 No Runtime Dependency Additions

All five features are implementable with existing packages. Validated.

### 3.4 Backward Compatibility

- `data.json` config format unchanged.
- `ApiKeyConfig` shape unchanged.
- `PermissionGate` interface unchanged.
- `AuditLogger` constructor signature unchanged.
- MCP protocol surface unchanged.

---

## 4. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Audit buffer lost on forced Obsidian kill | Low | Low | 500ms flush interval is short; audit is supplementary |
| Flush-on-unload not awaited by Obsidian | Low | Medium | Best-effort flush; document in troubleshooting.md |
| Fake-timer tests flaky in CI | Medium | Low | Use `vi.useFakeTimers()` with `advanceTimersByTimeAsync` pattern; existing server tests already do this |
| Obsidian mock extensions break existing tests | Low | Low | Extensions are additive; run full suite after each mock change |
| Settings test coverage target (80%) misses edge cases | Medium | Medium | Supplement with mutation-testing check on highest-value components (ApiKeyTab) if time allows |
| Resolved-key fallback hides the single-resolve regression | Low | Medium | Add explicit spy-based test that asserts `apiKeys.find` is called exactly once on the happy path |

---

## 5. Open Questions

None. All design decisions are captured above.

---

## 6. Implementation Order & Phase Boundaries

1. **Phase L4** — Glob validator + PathEntry integration + unit tests.
2. **Phase L8** — Rate-limit interval + lifecycle + tests.
3. **Phase M6** — Permission-chain single-resolve + gate fallbacks + tests.
4. **Phase H5** — Audit buffer + flush lifecycle + append migration + tests.
5. **Phase M18** — Mock extensions + 8 component test files + coverage verification.

Each phase ends with: `lint + test + build` green, commit pushed, CI green before next phase starts.
