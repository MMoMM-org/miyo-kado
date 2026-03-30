# /setup-docker-home

Sets up plugin marketplaces and installs required plugins for this Docker home.

Run **once** after the first container start, or whenever the plugin warning appears in begin-code.sh.

## What this does

1. Registers the custom plugin marketplaces defined in `~/.claude/settings.json`
2. Installs each plugin listed in `enabledPlugins`
3. Creates `~/.claude/.plugins-initialized` to suppress the startup warning

## Steps

Read `~/.claude/settings.json` and execute the following in order:

### 1. Register marketplaces

For each entry in `extraKnownMarketplaces`, run:
```
/plugin marketplace add <name> <github-repo>
```

Current marketplaces (from settings.json):
- `the-custom-startup` → `MMoMM-org/the-custom-startup`

### 2. Install plugins

For each key in `enabledPlugins`, run:
```
/plugin install <plugin-id>
```

Current plugins (from settings.json):
- `typescript-lsp@claude-plugins-official`
- `tcs-helper@the-custom-startup`
- `tcs-team@the-custom-startup`
- `tcs-workflow@the-custom-startup`
- `tcs-patterns@the-custom-startup`

### 3. Mark as initialized

After all plugins are installed successfully, create the marker file:

```bash
touch ~/.claude/.plugins-initialized
```

## Notes

- If a plugin is already installed, `/plugin install` is a no-op — safe to re-run
- If a marketplace is already registered, adding it again is a no-op
- This command only needs to run once per container (the marker persists in claude-docker-home/)
- To reset and re-run: `rm ~/.claude/.plugins-initialized` then run `/setup-docker-home` again
