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

## Second key to create (whitelist) — TWO rules

The neutrality guard only fires when the **base permission passes** (the key can
update both the source and target folder) **AND** a descendant would fall under a
different rule. So you need TWO path entries — a broad one plus a more-specific
one. **Both can be folders** (fully pickable in the browse modal — no file
selection needed):

1. **Broad** — `allowed/rbac-demo/**` — **full CRUD**. Grants update on the folder
   itself at both the old and new name, so the base permission passes.
2. **More specific** — `allowed/rbac-demo/guarded/**` — **read-only**
   (`update/create/delete = false`, `read = true`). Because it has more literal
   characters, it wins over the broad rule for everything under `guarded/`.

> ⚠️ **Rule 2 MUST be `allowed/rbac-demo/guarded/**` (with `/**`), not the bare
> `allowed/rbac-demo/guarded`.** A bare folder path auto-expands and matches BOTH
> the folder node itself AND its contents — so a bare read-only rule makes the
> folder node read-only too, and the rename fails the *base* permission with a
> plain `FORBIDDEN` (you can't update a read-only folder), never reaching the
> neutrality check. `guarded/**` matches only the *contents*, so the folder node
> stays writable via rule 1 (base passes) while its contents flip rule → the
> neutrality guard fires. **The folder browse picker returns the bare path — add
> `/**` by hand for this rule.**
>
> ⚠️ Also do NOT give the key *only* rule 2. Then the rename **target**
> (`allowed/rbac-demo/guarded-x`) is outside scope → plain `FORBIDDEN` again. The
> block needs the broad rule 1 present so the base permission passes on both ends.

Global security already whitelists `allowed/**` with full CRUD, so the **global**
scope is neutral on both sides — the difference lives only in *this key's* scope,
so the block message names "the key's" rule.

(You could make rule 2 a single file — `allowed/rbac-demo/guarded/restricted.md`
read-only — for a tighter illustration; that works too, but you'd type the path
rather than pick it. Folder-granularity is the realistic, pickable case.)

## Expected results

| Call | Expected |
|---|---|
| `kado-rename operation=folder source="allowed/rbac-demo/neutral" target="allowed/rbac-demo/neutral-x"` | **ALLOWED** — whole subtree stays under `allowed/rbac-demo/**` |
| `kado-rename operation=folder source="allowed/rbac-demo/guarded" target="allowed/rbac-demo/guarded-x"` | **BLOCKED** — `VALIDATION_ERROR`, message names the first descendant under `guarded/` (e.g. `…/guarded/public.md → …/guarded-x/public.md`) and "the key's" rule |

After the blocked rename, confirm `guarded/` is untouched on disk and the plugin
`data.json` is byte-identical (the config was not migrated).

To contrast against a plain permission denial: renaming `guarded/` with a key
that lacks `update` on the folder itself returns `FORBIDDEN` (a different gate) —
the neutrality block only fires when the base permission *passes* but a
descendant's effective scope would change.
