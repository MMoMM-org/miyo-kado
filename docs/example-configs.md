# Example Configurations

Practical examples showing how to set up Kado for common workflows. For the full settings reference, see the [Configuration Guide](configuration.md).

## Researcher with AI assistant

**Goal:** Let the AI read your notes and create new ones in an inbox.

1. **Global security**: whitelist mode, add `Notes` (read-only) and `AI Inbox` (full CRUD)
2. **API key**: same paths, notes = read only, AI Inbox = create + read + update
3. **Tags**: add `project/*` so the AI can search by project tags

## Shared vault with multiple agents

**Goal:** Different AI agents have different access levels.

1. **Global security**: whitelist all shared folders
2. **Key "Research Agent"**: read-only access to everything
3. **Key "Writing Agent"**: read + write to `Drafts`, read-only to `Sources`
4. **Key "Admin Agent"**: full CRUD on all paths

## Permission matrix examples

### Global Security Tab

A typical configuration with two paths -- `allowed/**` has nearly full access, `maybe-allowed/**` is read-only across all data types:

**Access Mode:** `Whitelist` -- *Only listed paths and tags are accessible. Everything else is blocked.*

**Paths:**

```
allowed/**             C   R   U   D
  Note                 Y   Y   Y   Y
  Frontmatter (FM)     Y   Y   Y   -
  Dataview (DV)        Y   Y   -   -
  File                 Y   Y   Y   Y

maybe-allowed/**       C   R   U   D
  Note                 -   Y   -   -
  Frontmatter (FM)     -   Y   -   -
  Dataview (DV)        -   Y   -   -
  File                 -   Y   -   -
```

Legend: `Y` = permission granted, `-` = permission not granted

**Tags:**

```
#project/alpha    [R]
#status/*         [R]
```

Tags are read-only filters (the `[R]` badge). They restrict which tags are visible in `listTags` and searchable via `byTag`. A pattern like `#status/*` matches `#status/active`, `#status/done`, etc.

### API Key Tab

An API key can only select **from paths that Global Security already allows**. Permissions that are disabled globally appear greyed out and cannot be enabled on the key.

Building on the global example above, a restricted key might look like this:

**Access Mode:** `Whitelist` (independent of global -- each key has its own)

```
allowed/**             C   R   U   D
  Note                 Y   Y   -   -      <- key selects C,R; global has all 4
  Frontmatter (FM)     Y   Y   -   #      <- D is greyed (disabled globally)
  Dataview (DV)        -   -   #   #      <- U,D greyed
  File                 -   Y   -   -      <- key selects R only

maybe-allowed/**       C   R   U   D
  Note                 #   Y   #   #      <- only R available globally
  Frontmatter (FM)     #   Y   #   #
  Dataview (DV)        #   Y   #   #
  File                 #   Y   #   #
```

Legend: `Y` = selected, `-` = not selected (still clickable), `#` = greyed (disabled globally, cannot be enabled)

**Tags:**

```
#project/alpha    [R]
```

The tag picker only offers tags from Global Security. A key can take a subset of the global tag list.
