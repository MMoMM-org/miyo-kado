#!/bin/bash

# Claude Code Auto-Formatting Hook
# Source: https://github.com/ryanlewis/claude-format-hook
# Automatically formats source code files after Claude edits them

# Read JSON input from stdin
json_input=$(cat)

# Try to extract file path using jq if available, otherwise use grep/sed
if command -v jq &> /dev/null; then
    file_path=$(echo "$json_input" | jq -r '.tool_input.file_path // empty')
else
    file_path=$(echo "$json_input" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
fi

# Exit silently if no file path found or file doesn't exist
if [ -z "$file_path" ] || [ ! -f "$file_path" ]; then
    exit 0
fi

# Get file extension
extension="${file_path##*.}"

# Format based on file extension
case "$extension" in
    # JavaScript/TypeScript — biome first, prettier fallback
    js|jsx|ts|tsx)
        if command -v biome &> /dev/null; then
            biome format --write "$file_path" &> /dev/null
        elif command -v prettier &> /dev/null; then
            prettier --write "$file_path" &> /dev/null
        fi
        ;;

    # Python — ruff via uv tool
    py)
        if command -v uv &> /dev/null; then
            uv tool run ruff format "$file_path" &> /dev/null
        fi
        ;;

    # Markdown — prettier
    md)
        if command -v prettier &> /dev/null; then
            prettier --write "$file_path" &> /dev/null
        fi
        ;;

    # Go — goimports then go fmt
    go)
        if command -v goimports &> /dev/null; then
            goimports -w "$file_path" &> /dev/null
        fi
        if command -v go &> /dev/null; then
            go fmt "$file_path" &> /dev/null
        fi
        ;;

    # Kotlin — ktlint fallback ktfmt
    kt|kts)
        if command -v ktlint &> /dev/null; then
            ktlint --format "$file_path" &> /dev/null
        elif command -v ktfmt &> /dev/null; then
            ktfmt "$file_path" &> /dev/null
        fi
        ;;
esac

# Always exit successfully — never block Claude's operations
exit 0
