---
title: RBAC folder-rename neutrality — live test fixture
kind: test-fixture
spec: 009-folder-operations
---

# RBAC folder-rename neutrality — live test recipe

This folder is a fixture for verifying the **permission-neutral folder-rename
guard** (spec 009, C-4) against a real vault. It contains two subtrees:

- `neutral/` — the whole subtree is governed by one broad rule → renaming it is
  **access-neutral** and should be **ALLOWED**.
- `guarded/` — one note (`restricted.md`) is governed by a **more-specific** rule
  than its siblings → renaming the folder would move that note under a different
  rule → the rename should be **BLOCKED** with `VALIDATION_ERROR`
  (gate `folder-scope-neutrality`), and Kado must **not** rewrite the config.

## Second key to create (whitelist) — TWO rules, both bare folder picks

The neutrality guard only fires when the **base permission passes** (the key can
update both the source and target folder) **AND** a descendant would fall under a
different rule after the rename. The trick: put the differing rule on a
**deeper** folder than the one you rename, so the renamed folder *node* stays
writable while a descendant's scope changes. No `**` typing needed — both rules
are plain folder picks:

1. **Broad** — `allowed/**` — **full CRUD** (this key already has it).
2. **Deeper, differing** — `allowed/rbac-demo/guarded/sub` — **read-only**
   (`update/create/delete = false`, `read = true`). Pick the `guarded/sub` folder
   in the browse modal; the bare path is fine.

You then rename the **parent** `guarded` (not `guarded/sub`):

- The renamed node `allowed/rbac-demo/guarded` is not covered by the
  `guarded/sub` rule, so it stays full under `allowed/**` → **base permission
  passes**.
- Its descendant `guarded/sub` (and `guarded/sub/deep.md`) *is* read-only at the
  old path but would be full at `guarded-x/sub` → scope changes → **BLOCK**.

> ⚠️ Do NOT put the read-only rule on `guarded` itself. A bare folder path
> auto-expands to match the folder *node* too, so a read-only `guarded` makes the
> node read-only → the rename fails the *base* permission with a plain
> `FORBIDDEN`, never reaching the neutrality check. Keep the differing rule on a
> *descendant* (`guarded/sub`) so the renamed node stays writable.

Global security whitelists `allowed/**` with full CRUD, so the **global** scope is
neutral on both sides — the difference lives only in *this key's* scope, so the
block message names "the key's" rule.

## Expected results

| Call | Expected |
|---|---|
| `kado-rename operation=folder source="allowed/rbac-demo/neutral" target="allowed/rbac-demo/neutral-x"` | **ALLOWED** — whole subtree stays under `allowed/rbac-demo/**` |
| `kado-rename operation=folder source="allowed/rbac-demo/guarded" target="allowed/rbac-demo/guarded-x"` | **BLOCKED** — `VALIDATION_ERROR` (`folder-scope-neutrality`), message names `…/guarded/sub → …/guarded-x/sub` (or `…/sub/deep.md`) and "the key's" rule |

After the blocked rename, confirm `guarded/` is untouched on disk and the plugin
`data.json` is byte-identical (the config was not migrated).

To contrast against a plain permission denial: renaming `guarded/` with a key
that lacks `update` on the folder itself returns `FORBIDDEN` (a different gate) —
the neutrality block only fires when the base permission *passes* but a
descendant's effective scope would change.
