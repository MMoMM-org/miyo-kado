# Specification: 007-partial-note-rw

## Status

| Field | Value |
|-------|-------|
| **Created** | 2026-06-13 |
| **Current Phase** | Requirements |
| **Last Updated** | 2026-06-13 |
| **Tracking** | [#69](https://github.com/MMoMM-org/miyo-kado/issues/69) |

## Documents

| Document | Status | Notes |
|----------|--------|-------|
| requirements.md | in_progress | Awaiting user approval |
| solution.md | pending | — |
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
