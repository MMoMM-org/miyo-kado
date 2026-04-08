---
title: "Kado v1 Hardening"
status: draft
version: "1.0"
---

# Product Requirements Document

## Validation Checklist

### CRITICAL GATES (Must Pass)

- [x] All required sections are complete
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Problem statement is specific and measurable
- [x] Every feature has testable acceptance criteria (Gherkin format)
- [x] No contradictions between sections

### QUALITY CHECKS (Should Pass)

- [x] Problem is validated by evidence (not assumptions)
- [x] Context -> Problem -> Solution flow makes sense
- [x] Every persona has at least one user journey
- [x] All MoSCoW categories addressed (Must/Should/Could/Won't)
- [x] Every metric has corresponding tracking events
- [x] No feature redundancy (check for duplicates)
- [x] No technical implementation details included
- [x] A new team member could understand this PRD

---

## Product Overview

### Vision

Kado v1 ships production-ready: every MCP request is fast, every admin input is safe, and every UI component is verified by tests.

### Problem Statement

A comprehensive code review (2026-04-01) of the `feat/kado-v1-implementation` branch identified five hardening gaps before the plugin can be considered production-grade:

1. **Audit logging I/O is O(file-size) per request.** Every MCP operation reads the entire audit log, appends one line, and writes it back. On a vault with heavy MCP traffic, a 1 MB log means 1 MB of disk I/O per tool call, blocking Obsidian's event loop.

2. **API key lookup is repeated 5x per request.** Each gate in the permission chain independently calls `config.apiKeys.find()`. With N keys, a single request triggers O(N) scans five times. The duplication also makes it easy for future gate authors to add a sixth scan by copying the pattern.

3. **Settings UI has zero test coverage.** Eight components (`PermissionMatrix`, `PathEntry`, `TagEntry`, `TagPickerModal`, `VaultFolderModal`, `ApiKeyTab`, `GeneralTab`, `GlobalSecurityTab`) render Obsidian UI and wire user actions to config mutations with no automated verification.

4. **Glob patterns have no complexity validation.** Admin-configured path patterns are compiled into RegExp objects with no length or depth limit. A pattern like `a/**/**/**/**/**/**/**` could exhibit catastrophic backtracking.

5. **Rate-limit map entries are never evicted.** The `requestCounts` map only cleans expired entries when it reaches 10,000 IPs. In a typical single-user deployment, entries accumulate indefinitely for the process lifetime.

**Evidence source:** Code review report at `docs/reviews/2026-04-01-v1-review.md`, findings H5, M6, M18, L4, L8.

### Value Proposition

Addressing these items gives the plugin author confidence that:
- The plugin won't degrade Obsidian performance on active vaults (audit I/O, key lookups).
- Admin configuration mistakes can't cause regex-based denial of service (glob validation).
- Settings UI behavior is verified and won't silently corrupt config on future changes (component tests).
- Memory usage stays bounded over long-running sessions (rate-limit cleanup).

## User Personas

### Primary Persona: Plugin Author

- **Demographics:** Solo developer maintaining an Obsidian plugin, deep TypeScript knowledge, operates from Docker-based dev environment.
- **Goals:** Ship a v1 that is safe to publish to the Obsidian community plugin index. Ensure the codebase is maintainable and regression-proof before inviting external contributors or users.
- **Pain Points:** Review identified measurable quality gaps. Without addressing them, any public release carries risk of user-facing performance issues or silent config corruption.

### Secondary Personas

No secondary personas for this hardening spec. End users benefit indirectly through improved performance and reliability, but the work is developer-facing.

## User Journey Maps

### Primary User Journey: Pre-Release Hardening

1. **Awareness:** Code review identified 52 findings; 35 were fixed immediately. The remaining 5 are tracked in this spec.
2. **Consideration:** Each item was evaluated for scope, risk, and effort. Items that required architectural decisions or external action were separated from those that are purely implementation work.
3. **Adoption:** This spec is the decision to address all 5 items before the next release after v1 merges.
4. **Usage:** The plugin author implements each item following TDD, validates with the existing test infrastructure, and verifies with live testing in Docker.
5. **Retention:** Once hardened, the codebase supports confident iteration on new features (e.g., kado-delete tool, Tomo integration) without accumulating technical debt.

## Feature Requirements

### Must Have Features

#### Feature 1: Buffered Audit Log Writes

- **User Story:** As the plugin author, I want audit log writes to be batched so that each MCP operation does not perform a full file read-modify-write cycle.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given the MCP server receives 10 rapid tool calls, When audit logging is enabled, Then the audit log file is written at most twice (batch flush) rather than 10 times
  - [ ] Given the audit buffer contains unflushed entries, When 500ms passes without new entries, Then the buffer flushes to disk automatically
  - [ ] Given the audit buffer contains unflushed entries, When the plugin unloads, Then all buffered entries are flushed before shutdown completes
  - [ ] Given a disk I/O error occurs during flush, When the next flush attempt runs, Then previously failed entries are retried and the error is logged without crashing

#### Feature 2: Single Key Resolution in Permission Chain

- **User Story:** As the plugin author, I want the API key to be resolved once per request so that the permission chain does not perform redundant lookups.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a request with a valid API key, When the permission chain evaluates all 5 gates, Then `config.apiKeys.find()` is called exactly once (not per-gate)
  - [ ] Given a request with an unknown key ID, When the authenticate gate runs, Then the request is rejected before any subsequent gate executes (existing behavior preserved)
  - [ ] Given the key resolution is centralized, When a new gate is added to the chain, Then the gate receives the resolved key object without needing its own lookup

#### Feature 3: Settings UI Component Tests

- **User Story:** As the plugin author, I want behavioral tests for all settings UI components so that config mutations are verified and regressions are caught automatically.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given the `ApiKeyTab` component is rendered, When the "Generate Key" button is activated, Then a new key appears in the config with a `kado_` prefix
  - [ ] Given the `ApiKeyTab` component is rendered, When the "Delete Key" confirm flow completes, Then the key is removed from config
  - [ ] Given the `GlobalSecurityTab` component is rendered, When a path is added via the "add path" button, Then the path appears in `config.security.paths`
  - [ ] Given the `PermissionMatrix` component is rendered with a disabled dot, When the dot is clicked, Then the permission flag does not change
  - [ ] Given any settings component is rendered, When an interactive element is activated, Then `plugin.saveSettings()` is called exactly once
  - [ ] Given the test suite runs, When all settings component tests execute, Then at least 80% of settings component lines are covered

### Should Have Features

#### Feature 4: Glob Pattern Complexity Validation

- **User Story:** As the plugin author, I want glob patterns to be validated at config time so that malformed patterns cannot cause catastrophic regex backtracking.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given an admin enters a glob pattern longer than 256 characters, When the config is saved, Then the pattern is rejected with a visible error message
  - [ ] Given an admin enters a pattern with more than 3 consecutive `**` segments, When the config is saved, Then the pattern is rejected with a visible error message
  - [ ] Given an admin enters a bare `**` pattern (matches entire vault), When the config is saved, Then a warning is displayed (not blocked, but flagged)

### Could Have Features

#### Feature 5: Periodic Rate-Limit Map Eviction

- **User Story:** As the plugin author, I want expired rate-limit entries to be cleaned up periodically so that the in-memory map does not grow indefinitely.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given the rate-limit map contains expired entries, When 60 seconds have passed since the last eviction, Then expired entries are removed regardless of map size
  - [ ] Given the MCP server has been running for 24 hours with sporadic traffic, When the rate-limit map is inspected, Then it contains only entries from the current or previous window

### Won't Have (This Phase)

- **Separate auth secret field** (v2 architectural decision, tracked in ADR-6)
- **Background content indexer** for `byContent` search (separate feature, not hardening)
- **MCP schema versioning** (MCP protocol uses dynamic `tools/list` discovery)
- **HTTP-transport integration tests in CI** (covered by Docker live tests)

## Detailed Feature Specifications

### Feature: Buffered Audit Log Writes

**Description:** Replace the current per-entry read-modify-write cycle with an in-memory line buffer that flushes to disk on a timer or when the buffer reaches a size threshold.

**User Flow:**
1. MCP tool call completes and produces an audit entry
2. Entry is appended to an in-memory buffer (array of NDJSON lines)
3. If the buffer has not been flushed in the last 500ms, a flush timer is scheduled
4. On flush: all buffered lines are joined and appended to the log file in a single write
5. On plugin unload: any remaining buffer is flushed synchronously before shutdown

**Business Rules:**
- Rule 1: Buffer flush interval is 500ms (configurable is out of scope for this phase)
- Rule 2: A flush must write all buffered entries atomically (single write call)
- Rule 3: If a flush fails, entries remain in the buffer for the next attempt
- Rule 4: Log rotation checks happen once per flush, not once per entry
- Rule 5: The existing `writeChain` serialization guarantee must be preserved

**Edge Cases:**
- Scenario 1: Plugin unloads mid-flush -> Expected: unload waits for in-flight flush to complete, then flushes remaining entries
- Scenario 2: Disk full during flush -> Expected: entries stay in buffer, error logged, next flush retries
- Scenario 3: Rapid burst of 100 entries in <500ms -> Expected: all 100 entries flush in a single write

## Success Metrics

### Key Performance Indicators

- **Adoption:** N/A (internal hardening, not user-facing feature adoption)
- **Engagement:** N/A
- **Quality:** All 5 features pass acceptance criteria; zero new test failures introduced; settings component coverage reaches 80%
- **Business Impact:** Plugin author has confidence to submit to Obsidian community plugin index

### Tracking Requirements

| Event | Properties | Purpose |
|-------|------------|---------|
| Audit flush | `entryCount`, `flushDurationMs`, `bytesWritten` | Verify batching reduces I/O |
| Permission chain evaluation | `keyResolutionCount` (should always be 1) | Verify single-lookup invariant |
| Settings test suite | `coveragePercent`, `testCount` | Track coverage improvement |
| Glob validation rejection | `pattern`, `reason` | Monitor admin misconfigurations |

---

## Constraints and Assumptions

### Constraints
- All changes must be backward-compatible with existing `data.json` config format
- No new runtime dependencies (hardening must use only existing packages)
- Settings UI tests must work with the existing Obsidian mock (`test/__mocks__/obsidian.ts`)
- Plugin must continue to pass all existing tests (444 passing, 5 pre-existing failures in adapters)

### Assumptions
- The Docker-based dev environment is the exclusive development platform going forward
- The existing `writeChain` promise serialization pattern is the correct concurrency model for audit I/O
- The Obsidian mock accurately represents the `Setting`, `Modal`, and `ButtonComponent` APIs needed for component tests
- Rate-limit eviction frequency of once per minute is sufficient for the single-user deployment model

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Buffered audit entries lost on crash | Medium | Low | Flush timer is short (500ms); Obsidian plugin crashes are rare; audit is supplementary not critical |
| Changing key resolution interface breaks existing gate tests | Medium | Medium | Implement as additive change (pass resolved key through context); existing gates continue to work |
| Obsidian mock gaps block settings tests | Medium | Medium | Extend mock incrementally; mock already covers Setting, Modal, ButtonComponent |
| Glob validation rejects valid user patterns | Low | Low | Conservative limits (256 chars, 3x `**`); bare `**` is warned, not blocked |

## Open Questions

None. All items are well-defined by the code review findings and have clear acceptance criteria.

---

## Supporting Research

### Competitive Analysis

Not applicable. This is internal hardening of a novel plugin (no direct competitors implement an MCP gateway for Obsidian).

### User Research

The code review (2026-04-01) serves as the primary research artifact. All 5 items were identified through systematic multi-perspective analysis (security, performance, quality, testing, accessibility, compatibility, constitution).

### Market Data

Not applicable for internal hardening work.
