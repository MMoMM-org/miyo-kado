# Settings UI Rework v2

> Revision of spec 002 (UI Settings Rework) based on changesv1.md feedback.
> Mockups: `temp/gui rework/mockups.html`

## Summary

Simplify the settings UI by removing the multi-area concept, making permissions per-path instead of per-area, giving each API key its own independent whitelist/blacklist toggle, and improving the version header and audit log timestamps.

## Changes

### 1. Audit Log — Human-Readable Timestamps

**Current:** `timestamp` field stores `Date.now()` (epoch milliseconds).

**New:** Store as ISO 8601 string with local OS timezone offset.

```
// Before
{"timestamp":1774902546365,...}

// After
{"timestamp":"2026-03-31T14:29:06.365+02:00",...}
```

Change `createAuditEntry()` in `audit-logger.ts` to emit a formatted string instead of `Date.now()`. Update the `AuditEntry.timestamp` type from `number` to `string`.

### 2. Version Header

**Current:** `Kado v1.0.0 — Documentation` in small muted text, no padding, hardcoded name, wrong docs URL.

**New:** `MiYo Kado v1.0.0 · Marcus Breiden · Documentation`

- Plugin name and version from `manifest.json` (like the Dynbedded pattern)
- Author name linked to `manifest.authorUrl` (mmomm.org)
- Documentation link to `https://github.com/MMoMM-org/miyo-kado`
- Font size increased by one step
- Left padding to align with other settings content
- Sits one line below the top of the settings panel

### 3. Global Security — Single Area

**Current:** Multiple `GlobalArea` objects, each with label, listMode, paths (shared permissions), tags. Users create/remove areas.

**New:** One flat security scope. No areas, no labels, no add/remove area buttons.

Structure:
- **Access Mode toggle** at the top: `Blacklist [toggle] Whitelist` (whitelist default)
- **Paths section**: each path has its own 4x4 permission matrix (per-path, not per-area)
- **Tags section**: read-only filters with R badge (unchanged behavior)

Data model change:
```typescript
// Old
globalAreas: GlobalArea[]

// New
security: {
  listMode: ListMode;
  paths: Array<{ path: string; permissions: DataTypePermissions }>;
  tags: string[];
}
```

### 4. API Key Tab — Independent Permissions

**Current:** Keys reference GlobalAreas by ID and toggle assignment per area. ListMode inherited from area.

**New:** Each key has its own flat scope, same structure as global security.

- **Access mode is independent per key** — each key has its own whitelist/blacklist toggle
- Path picker only offers paths defined in Global Security
- Permission matrix per path, constrained by global: unavailable permissions greyed out (0.3 opacity)
- Tag picker only offers tags defined in Global Security
- User can select/deselect available permissions but cannot enable what's globally off

Data model change:
```typescript
// Old
areas: Array<{ areaId: string; permissions: DataTypePermissions; tags: string[] }>

// New (on ApiKeyConfig)
listMode: ListMode;
paths: Array<{ path: string; permissions: DataTypePermissions }>;
tags: string[];
```

### 4b. Whitelist/Blacklist Flip Behavior

When the user toggles between whitelist and blacklist (in either direction, on either global or key scope):

1. **The `listMode` field changes** — that's the toggle itself
2. **The per-path permission booleans do NOT change**
3. **The display rendering changes** — the same config value maps to a different visual:

| Config value | Whitelist display | Blacklist display |
|---|---|---|
| `true` | checkmark (purple) = "allowed" | empty = "not blocked" |
| `false` | empty = "not allowed" | X cross (red) = "blocked" |
| disabled (globally unavailable) | greyed out | greyed out |

**Why:** If the user accidentally flips the toggle, no configuration is lost. The effective permissions remain the same — only the visual representation changes. The user can then deliberately adjust from the new baseline.

**Example:**

Config stores: `Note.create=true, Note.read=true, Note.update=false, Note.delete=disabled`

- **Whitelist display:** `C✓ R✓ U_ DX` → Create and Read allowed (true=checkmark), Update not allowed (false=empty), Delete unavailable (greyed)
- **Flip to Blacklist display:** `C_ R_ U✕ DX` → Create and Read not blocked (true=empty), Update blocked (false=red X), Delete still unavailable (greyed)
- **Same effective result:** user can Create and Read, cannot Update, Delete unavailable. Config unchanged.

### 5. Edge Case — Stale Global Permissions on API Key Tab

When the user switches to an API key tab, the UI must re-read the current global security config to determine available permissions for each path.

**Display rules when Key is in Whitelist mode:**

| Global allows? | Key config value | Display |
|---|---|---|
| Yes | `true` | checkmark (clickable) |
| Yes | `false` | empty dot (clickable) |
| No | `false` | greyed out empty (disabled) |
| No | `true` | greyed out checkmark (was set, now unavailable) |

**Display rules when Key is in Blacklist mode:**

| Global allows? | Key config value | Display |
|---|---|---|
| Yes | `true` | empty dot (clickable) — not blocked |
| Yes | `false` | X cross red (clickable) — blocked |
| No | `false` | greyed out X cross (was blocking, now unavailable) |
| No | `true` | greyed out empty (disabled) |

The "greyed out with indicator" cases (last row in each table) show the user what they previously configured, even though the global scope no longer allows it. This avoids silent data loss and makes the conflict visible.

**Storage principle:** Each instance (Global, Key) stores only its own config. Cross-reference happens at render time, not save time.

### Enforcement Logic

Global and Key each have independent listMode — 4 combinations possible. The enforcement algorithm:

```
function isAllowed(request: { path, dataType, operation, keyId }): boolean {
  // Step 1: Resolve global scope
  const globalPerms = resolveScope(config.security, request.path);
  if (!globalPerms) return false;

  // Step 2: Check global permission
  if (!globalPerms[request.dataType][request.operation]) return false;

  // Step 3: Resolve key scope (independent listMode)
  const keyPerms = resolveScope(key, request.path);
  if (!keyPerms) return false;

  // Step 4: Check key permission
  return keyPerms[request.dataType][request.operation];
}

function resolveScope(scope, requestPath): Perms | null {
  const match = scope.paths.find(p => matchPath(requestPath, p.path));

  if (scope.listMode === 'whitelist') {
    return match ? match.permissions : null;  // only matched paths allowed
  } else {
    if (!match) return ALL_PERMISSIONS;        // not blacklisted = full access
    return invertPermissions(match.permissions); // set = blocked
  }
}
```

**Key principle:** `resolveScope()` handles listMode interpretation per layer. The outer function intersects (AND) global and key results. Global is always the ceiling — a key can never bypass global restrictions.

**The 4 combinations:**

1. **Global=WL, Key=WL** — Both whitelist their paths. Result: intersection of both.
2. **Global=WL, Key=BL** — Global allows listed paths. Key blocks specific ops within that. Result: global allows minus key blocks.
3. **Global=BL, Key=WL** — Global blocks some paths. Key only allows a subset of what's left. Result: narrowed to key's whitelist, excluding global's blacklist.
4. **Global=BL, Key=BL** — Global blocks some paths. Key additionally blocks more. Result: both blacklists combine.

## Approach Chosen

**Single flat scope per layer** (over the previous multi-area approach).

Why:
- Simpler mental model for users — one toggle, one list of paths, one list of tags
- Per-path permissions give more granular control than per-area
- Independent key listMode allows flexible configurations without inheriting constraints
- Removes area management overhead (labels, create/remove, cascading deletes)

Alternatives considered:
- Multi-area with per-path permissions (too complex for the value added)
- Inherited listMode from global (less flexible, confusing when modes differ)

## Parking Lot (Future)

From changesv1.md section X:
- Fuzzy path and tag picker
- Display real dynamic effective rights (live intersection preview)

## No Migration

Config changes are applied directly. Test vault config (`test/MiYo-Kado/.obsidian/plugins/miyo-kado/data.json`) updated manually after code is done.
