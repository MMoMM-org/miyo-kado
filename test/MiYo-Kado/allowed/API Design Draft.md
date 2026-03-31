---
title: API Design Draft
status: draft
tags:
  - engineering
  - api
  - documentation
version: 0.3
---

# Kado API Design

## Endpoints

The MCP server exposes three tools:

| Tool | Operation | Description |
|------|-----------|-------------|
| kado-read | note, frontmatter, file | Read vault content |
| kado-write | note, frontmatter, file | Write vault content |
| kado-search | byTag, byName, listDir, listTags, byContent, byFrontmatter | Search vault |

## Authentication

Bearer token via API key ID. Keys are scoped to areas with per-data-type CRUD permissions.

## Example

```json
{
  "operation": "note",
  "path": "allowed/Project Alpha.md"
}
```

[confidence:: high]
[review-needed:: false]
