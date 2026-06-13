# Specification: 007-partial-note-rw

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-06-13 |
| **Current Phase** | Planning |
| **Last Updated** | 2026-06-13 |
| **Tracking** | [#69](https://github.com/MMoMM-org/miyo-kado/issues/69) |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | completed | Approved by user |
| solution.md | completed | Approved by user; 8 ADRs confirmed |
| plan/ | pending | — |

**Status values**: `pending` | `in_progress` | `completed` | `skipped`

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-13 | Spec scaffolded; 1.0.0 blocker | Note body is all-or-nothing; frontmatter/inline-fields already granular |
| 2026-06-13 | READ must-have modes: `firstXChars`, `section`, `range` | User selected all three for 1.0.0 |
| 2026-06-13 | WRITE must-have modes: `append`/`prepend`, `insertUnderHeading`, `replaceSection`/`replaceRange` | User selected all for 1.0.0 |
| 2026-06-13 | `expectedModified` optional for append/prepend, required for replace/insert | Append is additive and conflict-tolerant; forcing a fresh read defeats fire-and-forget capture. Replace/insert need a prior read anyway → optimistic lock is free |
| 2026-06-13 | Dirty-editor CONFLICT guard applies to ALL write modes | User's live keystrokes must never be silently overwritten, regardless of mode |
| 2026-06-13 | PRD approved | All acceptance criteria captured; 2 open questions deferred to SDD (heading addressing, range basis) |
| 2026-06-13 | Section addressing: BOTH heading text + heading path (ADR-3) | Text covers common case; path disambiguates duplicate headings; block-ref deferred to Should-have |
| 2026-06-13 | Range basis: explicit discriminator line\|char (ADR-4) | User chose both; line 1-based inclusive, char 0-based exclusive (code points) |
| 2026-06-13 | API mode: single flat `mode` arg, normalized to discriminated union (ADR-1) | Compact tool schema; operation disambiguates frontmatter vs note |
| 2026-06-13 | Partial write = always Note-Update (ADR-2) | notePartial overrides expectedModified-based create/update discrimination across 3 sites |
| 2026-06-13 | append/prepend lock-free, replace/insert require expectedModified (ADR-5) | Dirty-editor guard applies to all modes |
| 2026-06-13 | SDD approved with 8 ADRs | Pure slice math in core/partial-slice.ts; heading resolution in adapter; truncated flag on CoreFileResult; backward-compatible no-mode path |
