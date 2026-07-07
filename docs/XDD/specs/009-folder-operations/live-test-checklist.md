# Live-Test Checklist — 009-folder-operations (Phase 5 / T5.1)

> **Status (2026-07-07):** the create / delete / rename **mechanics** below are now
> covered by an automated live suite — `test/live/folder-ops-live.test.ts`
> (7/7 pass against a real Obsidian vault, two-layer MCP + on-disk). Run it with
> `npm run test:live`. That run also surfaced and fixed a real bug (folder ops
> ran optimistic concurrency → spurious CONFLICT on a file path; now skipped).
> **Still manual** (need a bespoke config / vault-setting change): the RBAC
> permission-neutral block section and the auto-update-links-**OFF** timeout path.

Mocked tests assert call sequences and pure policy, **not** Obsidian's real
`vault.createFolder` / `fileManager.trashFile` / `fileManager.renameFile`
behaviour or the auto-update-links confirmation dialog. Run this in a real vault
(see `docs/live-testing.md` for how to point a build at a test vault) before
merging. Tick each item; note any deviation back into `solution.md`.

## Setup
- [ ] Build + load into a real vault; a key with write/delete access to a test
      area, e.g. `Sandbox/**`.
- [ ] Have both settings states ready: Obsidian **Settings → Files and links →
      Automatically update internal links** ON, and later OFF.

## Create — implicit `mkdir -p` (Phase 1)
- [ ] `kado-write` a note at `Sandbox/新規/深い/note.md` where `Sandbox/新規/深い/`
      does **not** exist → folders created, note written, no error.
- [ ] The intermediate folders appear in Obsidian's file explorer.
- [ ] Re-writing the same path (create, no `expectedModified`) → `CONFLICT`.
- [ ] `kado-write` a binary (`operation="file"`) into a fresh folder → same result.
- [ ] Writing to a path **outside** the key's scope still denies (folder creation
      does not widen access).

## Delete — empty only (Phase 2)
- [ ] `kado-delete operation="folder"` on an **empty** folder → trashed; it lands
      in the configured "Deleted files" destination (system trash / `.trash/` /
      permanent — flip the Obsidian setting and confirm it's respected).
- [ ] `kado-delete operation="folder"` on a **non-empty** folder → `VALIDATION_ERROR`
      "Folder not empty", contents untouched.
- [ ] `operation="folder"` on a path that is a **file** → `VALIDATION_ERROR`
      "not a folder".
- [ ] `operation="folder"` on a missing path → `NOT_FOUND`.
- [ ] No `expectedModified` supplied → still works (folder has no mtime).

## Rename — in place (Phase 3)
- [ ] With auto-update-links **ON**: `kado-rename operation="folder"`
      `Sandbox/alt → Sandbox/neu` → folder renamed; a note **elsewhere** that
      linked to `Sandbox/alt/x.md` now points at `Sandbox/neu/x.md` (descendant
      backlinks rewritten). Silent, no dialog.
- [ ] Cross-parent target `Sandbox/alt → Other/alt` → `VALIDATION_ERROR`
      "rename in place only".
- [ ] Target already exists → `CONFLICT`.
- [ ] Missing source → `NOT_FOUND`.
- [ ] With auto-update-links **OFF**: confirm the rename tool is hidden unless the
      `renameWhenLinkUpdateOff` opt-in is on. With the opt-in on, do a folder
      rename and observe the dialog behaviour + timeout path.
      - [ ] **Known gap to verify (plan T3.4 note):** on the OFF + timeout path the
            handler confirms success via `getFileMtime(target)`, which is
            file-only and returns undefined for a folder — so a folder rename that
            actually succeeded may be reported as `TIMEOUT`. Confirm whether this
            reproduces; if so, decide whether to make `getFileMtime` folder-aware.

## RBAC permission-neutral guard (Phase 4)
- [ ] Add a rule that references the **old** folder name specifically (e.g.
      global security whitelists `Sandbox/alt/**` but not the parent broadly).
      Attempt `Sandbox/alt → Sandbox/neu` → **blocked** with `VALIDATION_ERROR`
      naming the offending descendant and the boundary (global vs key).
- [ ] After a blocked rename, the config file on disk is **byte-identical**
      (nothing migrated).
- [ ] Broaden the rule to cover the parent (`Sandbox/**`), retry → rename
      succeeds (neutral, no friction).
- [ ] Repeat the block/allow pair for a **per-key** scope rule (not just global).

## Cross-cutting
- [ ] Audit log records folder delete/rename as a `note` operation with the
      folder path; denials (including neutrality blocks) are logged.
- [ ] `npm run build`, `npm test`, `npm run lint` still green after any
      adjustments made during live testing.
