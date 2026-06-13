---
title: "Partial Note Read/Write"
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
- [x] Context → Problem → Solution flow makes sense
- [x] Every persona has at least one user journey
- [x] All MoSCoW categories addressed (Must/Should/Could/Won't)
- [x] Every metric has corresponding tracking events
- [x] No feature redundancy (check for duplicates)
- [x] No technical implementation details included
- [x] A new team member could understand this PRD

---

## Product Overview

### Vision
Let an MCP client read and write *parts* of a note — a heading section, a range, the first N characters, or an appended line — instead of being forced to fetch and rewrite the whole note body every time.

### Problem Statement
Today the note body is all-or-nothing. `kado-read` (`n: "note"`) returns the full markdown content, and `kado-write` (`n: "note"`) replaces the entire body. Frontmatter and Dataview inline fields are already fine-grained (`mode: merge|n`, single-field reads), but the note body has no equivalent granularity.

This produces two concrete costs:
- **Read cost:** Grounding an assistant in a 6,000-word note returns all 6,000 words even when the client only needs the first paragraph or one section. Tokens are wasted and large notes can blow context budgets.
- **Write cost & risk:** Adding a single line to a daily note requires read-whole → modify-in-client → send-whole. That round-trip is slow, and the whole-body overwrite widens the window for lost updates and for clobbering content the client never intended to touch.

For a 1.0.0 release the note API should be feature-complete relative to the frontmatter/inline-field surface that already exists. Partial note read/write is the gap.

### Value Proposition
A `mode` parameter on `kado-read` and `kado-write` for `n: "note"` that exposes partial operations while reusing the entire existing safety chain — per-datatype CRUD permissions, audit logging, the dirty-editor CONFLICT guard, and `expectedModified` optimistic concurrency. Clients opt into a narrow operation; users get the same least-privilege guarantees they have today. No new tool, no new permission type — partial reads are still Note-Read, partial writes are still Note-Update.

## User Personas

### Primary Persona: MCP-aware Assistant Client
- **Demographics:** An AI client (Claude Desktop, Claude Code, a custom agent) integrated with Kado over MCP, operating on the user's vault under a scoped API key.
- **Goals:** Ground responses in just the relevant slice of a note; make small, surgical edits (append a log line, update one section) without re-sending the whole note.
- **Pain Points:** Full-note reads waste context budget on large notes; full-body writes are slow and risk overwriting unrelated content the client had no reason to touch.

### Secondary Persona: Obsidian-native Knowledge Worker
- **Demographics:** Age 25–55, daily Obsidian user who runs assistants against their vault (developer, researcher, writer).
- **Goals:** Let assistants capture into daily/inbox notes and revise specific sections without fear that a stray write nukes the rest of the note they were editing.
- **Pain Points:** Worries that "let the AI edit my note" means "the AI rewrites my whole note"; wants additive capture (append) to be cheap and safe even while they are typing.

## User Journey Maps

### Primary User Journey: "Read only what I need"
1. **Awareness:** Assistant must answer a question about a long note.
2. **Consideration:** A full read would return thousands of tokens of irrelevant content.
3. **Adoption:** The client calls `kado-read` with `mode: section` (heading) or `mode: firstXChars` (preview cap).
4. **Usage:** Kado returns just the requested slice plus a `truncated` flag indicating whether content was omitted.
5. **Retention:** The client routinely uses bounded reads; large notes no longer threaten its context budget.

### Secondary User Journey: "Append without clobbering"
1. User has a daily note open and is actively typing in it.
2. Assistant wants to append a captured task to that note.
3. Client calls `kado-write` with `mode: append` (no `expectedModified` needed for additive capture).
4. Because the user is actively editing the file, Kado raises a CONFLICT and shows a Notice; the client retries after the user pauses — the user's keystrokes are never overwritten.
5. Once the file is idle, the append succeeds and adds only the new line; the rest of the note is untouched.

### Tertiary User Journey: "Revise one section safely"
1. Client reads a section via `mode: section`, capturing the note's `modified` timestamp.
2. Client edits that section's text and calls `kado-write` with `mode: replaceSection` and `expectedModified` set to the read timestamp.
3. If the note changed since the read, mtime mismatches → CONFLICT → client re-reads and retries. Otherwise only that section is replaced; surrounding content is preserved.

## Feature Requirements

### Must Have Features

#### Feature 1: Partial READ modes (`kado-read`, `n: "note"`)
- **User Story:** As an MCP client, I want to request only part of a note so that I can ground my work without pulling the entire body.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given a note longer than N characters, When the client reads with `mode: firstXChars` and a limit N, Then Kado returns at most the first N characters of the body and `truncated: true`.
  - [ ] Given a note shorter than or equal to N characters, When the client reads with `mode: firstXChars`, Then Kado returns the full body and `truncated: false`.
  - [ ] Given a note containing a heading that matches the requested section, When the client reads with `mode: section`, Then Kado returns the content under that heading (down to the next heading of equal or higher level) and `truncated: false` for that slice.
  - [ ] Given a requested section heading that does not exist in the note, When the client reads with `mode: section`, Then Kado returns a NOT_FOUND-style error naming the missing section (not an empty success).
  - [ ] Given a note, When the client reads with `mode: range` and start/end bounds, Then Kado returns exactly the requested line- or character-range and a `truncated` flag indicating whether content outside the range exists.
  - [ ] Given a `mode: range` request whose bounds exceed the note length, When the read runs, Then Kado clamps to the available content and reports the effective bounds rather than erroring.
  - [ ] Given any partial read, When it completes, Then the response still includes the file `modified` timestamp usable as `expectedModified` for a subsequent write.
  - [ ] Given an omitted `mode`, When the client reads, Then behavior is identical to today's full-note read (backward compatible).
  - [ ] Given the API key lacks Note-Read permission for the path, When any partial read is attempted, Then it is denied exactly as a full read would be (no new bypass).

#### Feature 2: Partial WRITE modes (`kado-write`, `n: "note"`)
- **User Story:** As an MCP client, I want to add or replace part of a note so that I make surgical edits without re-sending the whole body.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given an existing note, When the client writes with `mode: append` and content, Then the content is added at the end of the body and no existing content is altered.
  - [ ] Given an existing note, When the client writes with `mode: prepend` and content, Then the content is added at the start of the body (after frontmatter, if present) and no existing content is altered.
  - [ ] Given an existing note containing the target heading, When the client writes with `mode: insertUnderHeading`, Then the content is inserted under that heading and surrounding sections are unchanged.
  - [ ] Given a target heading that does not exist, When the client writes with `mode: insertUnderHeading`, Then Kado returns a NOT_FOUND-style error (it does not silently append at the end).
  - [ ] Given an existing note containing the target section, When the client writes with `mode: replaceSection`, Then only that section's body is replaced and the rest of the note is preserved.
  - [ ] Given an existing note, When the client writes with `mode: replaceRange` and bounds, Then only the content within those bounds is replaced.
  - [ ] Given `mode: append` or `mode: prepend` with no `expectedModified`, When the file is idle, Then the additive write succeeds without an optimistic-lock check.
  - [ ] Given `mode: replaceSection`, `mode: replaceRange`, or `mode: insertUnderHeading` with no `expectedModified`, When the write is attempted, Then Kado rejects it as a malformed update (these modes require `expectedModified`).
  - [ ] Given any replace/insert mode with a stale `expectedModified`, When the note's current mtime differs, Then Kado returns CONFLICT and makes no change.
  - [ ] Given any write mode targeting a note the user is actively editing (open and dirty), When the write is attempted, Then Kado raises CONFLICT, shows the editor Notice, and leaves the file untouched.
  - [ ] Given the API key lacks Note-Update permission for the path, When any partial write is attempted, Then it is denied exactly as a full update would be.
  - [ ] Given an omitted `mode`, When the client writes, Then behavior is identical to today's full-note create/update (backward compatible).

#### Feature 3: Consistent observability and contract
- **User Story:** As a vault owner / auditor, I want partial operations to be visible and documented so that I can reason about what an assistant did.
- **Acceptance Criteria (Gherkin Format):**
  - [ ] Given any partial write, When it completes, Then the audit log records the `mode` used and whether the note body was touched, consistent with existing audit fields.
  - [ ] Given the public API reference, When a reader consults it, Then every read and write `mode` is documented with its parameters, response shape, and error conditions.

### Should Have Features
- Block-reference targeting for `mode: section` (resolve `^block-id` in addition to headings) — improves precision for clients that already track block ids.

### Could Have Features
- A `mode: tail` / `lastXChars` read symmetric to `firstXChars`.
- A `mode: replaceUnderHeading` convenience that combines section-replace semantics with heading addressing beyond the first match.

### Won't Have (This Phase)
- Frontmatter or Dataview inline-field partial operations — already granular; out of scope.
- Partial operations on the binary `file` n.
- Partial operations in `kado-delete` (deletes stay whole-note / whole-field).
- Diff/patch-format writes (e.g. unified diff application) — heavier contract, deferred.

## Detailed Feature Specifications

### Feature: Partial WRITE — concurrency model by mode
**Description:** Partial writes reuse the existing `expectedModified` mechanism but split into two safety profiles based on whether the operation is additive or destructive.

**User Flow (replace/insert):**
1. Client reads the note (any mode), capturing `modified`.
2. Client sends a `replaceSection` / `replaceRange` / `insertUnderHeading` write with that `expectedModified`.
3. System validates mtime, applies the change to only the targeted span, returns the new `modified`.

**User Flow (append/prepend):**
1. Client sends an `append` / `prepend` write, optionally without `expectedModified`.
2. System checks the dirty-editor guard, then adds content additively, returns the new `modified`.

**Business Rules:**
- BR-1: Partial writes always target an existing note and are classified as **Note-Update** for permission and audit purposes (never as create).
- BR-2: `append` / `prepend` MAY omit `expectedModified`; when omitted, the optimistic-lock check is skipped but the dirty-editor CONFLICT guard still applies.
- BR-3: `replaceSection` / `replaceRange` / `insertUnderHeading` MUST carry `expectedModified`; a request without it is malformed.
- BR-4: A partial read MUST NOT report itself as complete when content was omitted — it reports a `truncated` flag (mirrors the search-scope "no partial-as-complete" rule).
- BR-5: An addressing target that does not resolve (missing heading/section) is an error, never a silent no-op or silent append.

**Edge Cases:**
- Heading appears multiple times in the note → Expected: operate on the first match; document the rule (block-ref targeting is the Should-Have escape hatch).
- `firstXChars` limit lands mid-multibyte-character → Expected: do not split a character; return a clean boundary.
- `replaceRange` bounds invert (start > end) → Expected: reject as a malformed request.
- Note has frontmatter and client uses `prepend` → Expected: content goes after the frontmatter block, not before it.

## Success Metrics

### Key Performance Indicators
- **Adoption:** Partial-mode calls appear in real client usage (share of `kado-read`/`kado-write` calls that specify a non-default `mode`).
- **Engagement:** Average response size for reads using `firstXChars`/`section` is materially smaller than full-note reads (token savings realized).
- **Quality:** Zero lost-update or clobber incidents attributable to partial writes; CONFLICT correctly raised on stale replace/insert.
- **Business Impact:** 1.0.0 ships with a note API at parity with the frontmatter/inline-field surface.

### Tracking Requirements

| Event | Properties | Purpose |
|-------|------------|---------|
| `kado-read` call | `mode`, `truncated`, response size | Measure partial-read adoption and token savings |
| `kado-write` call | `mode`, `bodyTouched`, had `expectedModified` | Measure partial-write adoption and verify additive vs locked profiles |
| CONFLICT raised | `mode`, cause (stale mtime / dirty editor) | Verify concurrency safety behaves as specified |

## Constraints and Assumptions

### Constraints
- Must reuse the existing gate chain (CRUD permissions, audit, request-mapper) — no new permission datatype.
- Must preserve full backward compatibility: omitting `mode` behaves exactly as today.
- Single-user local Obsidian deployment; no multi-instance coordination.
- Heading/section addressing relies on the Obsidian metadata cache being current for the target note.

### Assumptions
- Clients that need precise section/range targeting will read first to discover structure and `modified`.
- Additive capture (append) is the highest-frequency partial-write case and benefits most from lock-free operation.
- The MCP API contract is consumed downstream (e.g. Kokoro) and any new `mode` field must be reflected there.

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Heading addressing is ambiguous (duplicate headings) | Medium | Medium | Define "first match" rule; offer block-ref targeting as Should-Have |
| Lock-free append enables a stale-but-additive write during user edits | Medium | Low | Dirty-editor guard still applies to append; only the optimistic lock is skipped |
| `mode` proliferation complicates the contract and client integration | Medium | Medium | Keep the Must set tight; document each mode; defer diff/patch and tail modes |
| Partial write misclassified as create, bypassing update permission | High | Low | BR-1: partial writes are always Note-Update; covered by acceptance criteria and tests |
| Multibyte/offset boundary bugs corrupt content | High | Low | Character-safe boundaries; range-bound edge cases in acceptance criteria and tests |

## Open Questions
- [ ] Should `mode: section` address by heading text, heading path (H1 > H2), or both for disambiguation? (Resolve in SDD.)
- [ ] Are `range` bounds line-based, character-based, or both? (Resolve in SDD — affects client ergonomics.)

---

## Supporting Research

### Competitive Analysis
Obsidian's own Vault API offers `vault.process` (atomic in-place transform) and a metadata cache exposing headings/sections/blocks — the building blocks for partial operations. Other note/MCP integrations that only expose whole-file read/write hit the same large-note token problem this PRD addresses.

### User Research
Internal: frontmatter/inline-field operations already proved the per-datatype granularity model; per-datatype CRUD semantics were just clarified (#68). Partial note operations extend the same model to the note body. Issue #65 (vault.process migration) and the retraction of the #10 file-watcher race confirm `vault.process` is the correct write primitive.

### Market Data
N/A — this is a capability-parity feature for an existing plugin, not a new market entry.
