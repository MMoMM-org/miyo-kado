---
title: "Phase 5: MCP surface, docs & end-to-end"
status: pending
version: "1.0"
phase: 5
---

# Phase 5: MCP surface, docs & end-to-end

## Phase Context

**GATE**: Read all referenced files before starting this phase.

**Specification References**:
- `[ref: SDD/Interface Specifications/Tool Contract]` — Zod params + describe text
- `[ref: SDD/ADR-6]` — surface `truncated` in the read response
- `[ref: PRD/Feature 3]` — audit `mode`/`bodyTouched`; api-reference documents every mode
- `[ref: SDD/Cross-Cutting Concepts]` — auditing, backward compatibility

**Key Decisions**:
- Tool schemas describe the operation-dependent valid `mode` values via Zod `.describe()` (clients read these).
- Audit records `mode` + `bodyTouched:true` for partial writes, consistent with frontmatter `bodyTouched:false`.

**Dependencies**: Phases 1–4 complete.

---

## Tasks

Exposes the capability to MCP clients, makes it observable and documented, and proves the whole pipeline end-to-end including backward compatibility.

- [ ] **T5.1 Tool schemas (`tools.ts`)** `[activity: backend-api]`

  1. Prime: Read `src/mcp/tools.ts` (kado-read / kado-write registration, Zod shapes, `.describe()` conventions)
  2. Test: schema accepts the new params; `.describe()` text present for `mode` + addressing params; existing params unaffected
  3. Implement: add `mode` + `limit`/`heading`/`headingPath`/`rangeBasis`/`start`/`end` to the kado-read and kado-write Zod input schemas with descriptions
  4. Validate: schema tests green; `npm run build` clean
  5. Success: clients can discover and call every mode `[ref: SDD/Interface Specifications/Tool Contract]`

- [ ] **T5.2 Response `truncated` + audit `mode`** `[activity: backend-api]`

  1. Prime: Read `src/mcp/response-mapper.ts` (`mapFileResult`) and the audit entry creation (ref `src/main.ts:81`)
  2. Test: `mapFileResult` includes `truncated` when present and omits/false-defaults otherwise; a partial write produces an audit entry carrying `mode` and `bodyTouched:true`
  3. Implement: surface `truncated` in the mapped read result; thread `mode`/`bodyTouched` into the audit entry for partial writes
  4. Validate: response-mapper + audit specs green; `npx tsc -p tsconfig.test.json` clean
  5. Success: truncation visible to clients; partial writes audited `[ref: PRD/AC Feature 3]` `[ref: SDD/ADR-6]`

- [ ] **T5.3 API reference docs** `[activity: documentation]` `[parallel: true]`

  1. Prime: Read `docs/api-reference.md` (kado-read / kado-write sections, frontmatter `mode` precedent)
  2. Test: doc review — every read/write mode has params, response shape, error conditions; concurrency rule (append optional vs replace/insert required `expectedModified`) documented; backward-compat note (omit `mode`)
  3. Implement: extend the kado-read and kado-write sections with the mode tables and examples
  4. Validate: no stale claims; cross-check against the Zod schema and adapter behaviour; no literal NUL/control bytes (auto-memory `git_nul_byte_in_text_files`)
  5. Success: contract fully documented `[ref: PRD/AC Feature 3]`

- [ ] **T5.4 End-to-end & backward-compat** `[activity: validate]`

  1. Prime: Read `[ref: SDD/Runtime View]` flows and `[ref: PRD/User Journey Maps]`
  2. Test: end-to-end through the full pipeline (request-mapper → gate chain → adapter) for a representative read mode and write mode incl. the additive-lock-free and dirty-editor CONFLICT paths; **backward-compat regression** — a no-`mode` read and write behave identically to pre-feature; optionally a live test per `docs/live-testing.md`
  3. Implement: integration specs (no production code beyond wiring already built)
  4. Validate: full `npx vitest run` green; `npm run build` clean; `npx tsc -p tsconfig.test.json` clean across all touched test files; `npm run lint` (eslint src/) clean
  5. Success: every PRD acceptance criterion exercised; zero regression on no-mode paths `[ref: PRD/Success Metrics]` `[ref: SDD/Quality Requirements]`

- [ ] **T5.5 Phase Validation** `[activity: validate]`

  - Full suite + build + test typecheck + lint all green. Update `docs/XDD/specs/007-partial-note-rw/README.md` status and the memory index. Ready for PR closing #69.
