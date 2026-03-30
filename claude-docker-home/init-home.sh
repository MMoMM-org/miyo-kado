#!/bin/bash
# init-home.sh — Render .template files on first container start
#
# Sourced by entrypoint.sh before Claude Code launches.
# Substitutes {{VAR}} placeholders using env vars from begin-code.sh:
#   REPO_NAME, REPO_MOUNT_PATH, CONFIG_VARIANT
#
# Only renders if the target file does not exist — user edits are preserved.
# Re-render: delete .home-initialized and the target file(s), then restart.

MARKER="${HOME}/.home-initialized"

if [ -f "$MARKER" ]; then
    return 0 2>/dev/null || exit 0
fi

echo "[init-home] Rendering home templates..."

# Substitute {{KEY}} patterns from env vars using perl
_ih_render() {
    local src="$1"
    local dst="$2"
    cp "$src" "$dst"
    REPLACE_VAL="$REPO_NAME"       perl -i -pe 's/\QKado\E/$ENV{REPLACE_VAL}/g'       "$dst"
    REPLACE_VAL="$REPO_MOUNT_PATH" perl -i -pe 's/\Q/Volumes/Moon/Coding/MiYo/Kado\E/$ENV{REPLACE_VAL}/g' "$dst"
    REPLACE_VAL="$CONFIG_VARIANT"  perl -i -pe 's/\Qsecure\E/$ENV{REPLACE_VAL}/g'  "$dst"
}

# Render root-level templates
for tpl in "${HOME}/CLAUDE.md.template" "${HOME}/.claude.json.template"; do
    [ -f "$tpl" ] || continue
    target="${tpl%.template}"
    if [ ! -f "$target" ]; then
        _ih_render "$tpl" "$target"
        echo "[init-home] Rendered: $(basename "$target")"
    fi
done

# Render .claude/**/*.template files
find "${HOME}/.claude" -name "*.template" 2>/dev/null | while IFS= read -r tpl; do
    target="${tpl%.template}"
    if [ ! -f "$target" ]; then
        _ih_render "$tpl" "$target"
        echo "[init-home] Rendered: ${tpl#$HOME/}"
    fi
done

touch "$MARKER"
echo "[init-home] Home initialization complete."
