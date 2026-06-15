---
title: "Rename & Move (kado-rename)"
status: completed
version: "1.0"
---

# Product Requirements Document

> Retrospective PRD — see README.md. Acceptance criteria below match the shipped behavior.

## Product Overview

### Vision
Let an MCP client rename or move a note/file in the vault in one call, with inbound
links updated automatically, gated by the same two-layer access-control model as every
other Kado operation.

### Problem Statement
Kado exposed create/read/update/delete but no way to **relocate** a file. The only
workaround was read → write-under-new-name → delete: not atomic, token-heavy, and — most
importantly — it **destroys every `[[wikilink]]`** pointing at the moved note, because a
plain write/delete does not update backlinks. Rename/move was the missing file-level
operation for a complete 1.x surface.

## Users & Journeys
- **AI assistant (via Tomo or a generic MCP client):** "Rename `draft.md` to `2026-budget.md`"
  or "move this note from `Inbox/` to `Notes/`" — without breaking links or round-tripping the body.

## Functional Requirements (MoSCoW)

### Must
- A `kado-rename` MCP tool taking `operation` (`note`|`file`), `source`, `target`, `expectedModified`.
- Backlinks updated automatically on move/rename.
- Two-layer permission enforcement on **both** paths before any filesystem mutation.
- Rename (same parent folder) requires `update`; move (different parent folder) requires
  `delete` on source **and** `create` on target.
- Optimistic concurrency on the source via `expectedModified`.
- Refuse to overwrite an existing target (CONFLICT).
- Extension-strict: source and target share the operation's class (note→`.md`, file→non-`.md`).

### Should
- Clear, client-actionable errors (VALIDATION_ERROR for no-op / extension mismatch /
  missing target folder; NOT_FOUND for missing source; CONFLICT for stale source or occupied target).
- Audit every allowed and denied rename decision (metadata only).

### Won't (this iteration)
- Renaming frontmatter/inline fields (they have no path of their own).
- Bulk/batch rename.

## Acceptance Criteria (Gherkin)

```gherkin
Scenario: In-folder rename with update permission
  Given a key with note.update on the source folder
  When it renames source.md to sibling.md in the same folder
  Then the file is renamed, backlinks are updated, and {source,target,modified} is returned

Scenario: Cross-folder move requires delete + create
  Given a key with note.update but not note.delete on the source folder
  When it moves a note to another folder
  Then the request is denied with FORBIDDEN and no file is moved

Scenario: Stale source
  Given the source file changed since the client's read
  When rename is called with the old expectedModified
  Then CONFLICT is returned and no file is moved

Scenario: Occupied target
  Given a file already exists at the target
  When rename is called
  Then CONFLICT is returned and no file is moved

Scenario: No-op
  Given source equals target (after path normalization)
  When rename is called
  Then VALIDATION_ERROR is returned
```

## Metrics / Tracking
- Audit-log entries for `kado-rename` (allowed/denied, path=source, query=target).
