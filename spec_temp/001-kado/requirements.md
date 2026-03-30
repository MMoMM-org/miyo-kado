---
title: "Kado — Obsidian MCP Server Plugin"
status: draft
version: "1.2"
---

# Product Requirements Document

## Validation Checklist

### CRITICAL GATES (Must Pass)

- [x] All required sections are complete
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Problem statement is specific and measurable
- [x] Every feature has testable acceptance criteria (Gherkin format)
- [x] No contradictions between sections

### QUALITY CHECKS (Should Pass)

- [x] Problem is validated by evidence (not assumptions)
- [x] Context → Problem → Solution flow makes sense
- [x] Every persona has at least one user journey
- [x] All MoSCoW categories addressed (Must/Should/Could/Won't)
- [x] Every metric has corresponding tracking events
- [x] No feature redundancy (check for duplicates)
- [x] No technical implementation details included
- [x] A new team member could understand this PRD

---

## Product Overview

### Vision

Kado gives AI assistants and automation tools secure, granular, read/write access to an Obsidian vault through a standard MCP server — entirely self-contained, with no external services required.

### Problem Statement

AI tools (Claude Desktop, Cursor, custom agents) increasingly need access to personal knowledge bases to be useful. Obsidian users have no standard, secure way to grant that access:

- Sharing the vault folder directly exposes all notes, with no access control.
- Existing community plugins for MCP access either require additional plugins, an external MCP server process, or lack any meaningful security model.
- No existing solution offers granular, per-client access control (path, tag, frontmatter restrictions).

The consequence: privacy-conscious users either avoid AI integration entirely or accept unacceptably broad vault exposure.

### Value Proposition

Kado is the only Obsidian plugin that:
1. Exposes a fully MCP-compliant server that any standard MCP client can connect to without custom code.
2. Enforces a two-tier, fail-secure security model with blacklist/whitelist configuration at the global and per-key level.
3. Runs completely standalone inside Obsidian — no cloud services, no separate process, no other plugins, no internet connection.
4. Defaults to maximum restriction (empty whitelist) — the user explicitly grants access rather than restricting it after the fact.

---

## User Personas

### Primary Persona: Privacy-Conscious Knowledge Worker (Persona C)

- **Demographics:** Individual user, 25–55, moderate to high technical literacy, runs Obsidian as a personal knowledge base, security-aware.
- **Goals:** Allow a local AI tool to read and selectively write notes without exposing the entire vault. Needs to control exactly which notes (by folder, tag, or frontmatter) any given client can see. Success means AI assistance works on the notes the user explicitly chose, and nothing else is accessible.
- **Pain Points:** All existing MCP solutions give an AI client full vault access or no access. Privacy is non-negotiable — the user does not want their private notes, journals, or sensitive frontmatter visible to any tool they haven't deliberately authorized.

### Secondary Personas

**Persona A: AI Integration Engineer**
- **Demographics:** Developer, 25–45, high technical expertise, uses Claude Desktop or Cursor with MCP support.
- **Goals:** Configure AI assistants to autonomously read and write specific parts of a vault (project notes, meeting summaries). Needs reliable, stable API without custom scripting.
- **Pain Points:** No MCP-compliant Obsidian API with access control exists. Custom scripts break on Obsidian updates and lack security.

**Persona B: Automation Developer**
- **Demographics:** Technical, 25–50, builds workflows in Make, n8n, or custom scripts.
- **Goals:** Push external data into Obsidian notes (CRM updates, task syncs) and pull structured data out. Needs separate keys per workflow with minimal required permissions.
- **Pain Points:** Fragile file-write scripts, no versioned API, no per-workflow access control.

**Persona D: Power User / Multi-Client Admin**
- **Demographics:** Knowledge worker with multiple AI clients or shared vault, 30–55.
- **Goals:** Create separate API keys for different AI tools with different scopes (read-only analytics, write-enabled assistant, restricted to specific tags).
- **Pain Points:** Binary access — no tool today lets them give one client read access to `/projects/` and another write access to `/inbox/`.

---

## User Journey Maps

### Primary User Journey: Privacy-Conscious Knowledge Worker

1. **Awareness:** User wants Claude to help with project notes but refuses to expose journals or private folders. Searches for Obsidian MCP with access control — finds Kado.
2. **Consideration:** Reviews Kado's whitelist model (nothing allowed until explicitly granted), localhost-only binding, no external services. Satisfies privacy requirements.
3. **Adoption:** Installs Kado. Opens settings, enables read and write operations globally, adds path whitelist `/projects/**`. Generates an API key and grants it read+write, scoped to `/projects/**`. Pastes endpoint and key into Claude Desktop.
4. **Usage:** Claude reads and updates project notes. Attempts to access `/journal/` — rejected at the path gate. User confirms this is working as intended.
5. **Retention:** User creates a second key with only read access to notes tagged `#shared` for a reporting tool. The first key continues working independently.

### Secondary User Journeys

**AI Integration Engineer Journey:**
1. Finds Kado as the standard, secure MCP bridge for Obsidian.
2. Creates a key with write access to `/inbox/` and `/projects/**`.
3. Claude creates meeting summaries and updates frontmatter `status` fields autonomously.
4. Reviews audit log to verify what was created/modified.

**Automation Developer Journey:**
1. Creates a dedicated key with write-only access to `/inbox/`.
2. n8n workflow calls `create_note` to log daily CRM updates.
3. A second key with read-only access to `/reports/**` feeds a dashboard.
4. Both keys operate independently with no shared scope.

---

## Feature Requirements

### Must Have Features

All vault operations (note CRUD, frontmatter, attachments, search) are governed by the API key used in the request. The key determines which operations are permitted and which paths/tags/frontmatter are in scope. Every feature below assumes this key-based access control is enforced.

#### Feature 1: Note CRUD Operations

- **User Story:** As a knowledge worker, I want an AI tool to create, read, update, and delete notes within the paths I've authorized, so that it can help me manage my knowledge base without accessing anything outside my defined scope.
- **Acceptance Criteria:**
  - [ ] Given a valid API key with read permission, When `read_note` is called with an authorized path, Then the note's content, frontmatter, and tags are returned.
  - [ ] Given a valid API key, When `read_note` is called with a path outside the key's allowed scope, Then a 403 error is returned before any vault access occurs.
  - [ ] Given a valid API key with write permission, When `create_note` is called with a path and content, Then the note is created and a success response with the new path is returned.
  - [ ] Given a valid API key with write permission, When `create_note` is called with a path that already exists, Then a conflict error is returned and the existing note is not overwritten.
  - [ ] Given a valid API key with write permission, When `write_note` is called with updated content, Then the note content is replaced.
  - [ ] Given a valid API key with delete permission, When `delete_note` is called with a valid path, Then the note is deleted using Obsidian's built-in delete function.
  - [ ] Given a valid API key without delete permission (or delete disabled globally), When `delete_note` is called, Then a 403 error is returned before any vault access occurs.
  - [ ] Given a path containing `../` or other traversal sequences, When any operation is called, Then the request is rejected immediately with a security error — no vault access occurs.

#### Feature 2: Frontmatter and Metadata Access

- **User Story:** As an automation developer, I want to read and update YAML frontmatter independently of note content, so that I can enrich metadata without risking content corruption.
- **Acceptance Criteria:**
  - [ ] Given a valid API key with read permission, When `get_frontmatter` is called on an authorized note, Then the frontmatter is returned as a structured key-value object.
  - [ ] Given a note without frontmatter, When `get_frontmatter` is called, Then an empty object is returned, not an error.
  - [ ] Given a valid API key with write permission, When `update_frontmatter` is called, Then only the frontmatter block is modified and the note body is preserved exactly.
  - [ ] Given malformed YAML in the update request, When processed, Then a validation error is returned before any write occurs.
  - [ ] Given a key with frontmatter access disabled, When any frontmatter operation is called, Then a 403 error is returned before vault access.

#### Feature 3: Tag and Path Search / Discovery

- **User Story:** As a knowledge worker, I want an AI tool to discover relevant notes by folder or tag without knowing exact filenames, so that it can find context without requiring me to specify every file.
- **Acceptance Criteria:**
  - [ ] Given a valid API key, When `search_by_tag` is called, Then only notes within the key's allowed scope that carry the tag are returned (path and metadata, not full content).
  - [ ] Given a valid API key, When `list_notes` is called with an optional folder path, Then all notes in that folder visible to the key are returned with path and modification time.
  - [ ] Given a vault with 10,000+ notes, When `list_notes` is called, Then the response is paginated with a continuation token and returns within acceptable latency.
  - [ ] Given a valid API key, When `list_tags` is called, Then all tags visible to the key (given its scope) are returned with note counts.

#### Feature 4: Non-Markdown File Access

- **User Story:** As an AI integration engineer, I want to read and create non-markdown files (images, PDFs, audio) in authorized vault paths, so that AI tools can work with the full range of vault content.
- **Note:** Obsidian does not have a formal "attachment" concept — files are either embedded (`![[picture.jpg]]`) or linked (`[[picture.jpg]]`) within notes. Whether to expose non-markdown files under unified `read_file`/`create_file` tool names (alongside markdown) or separate `read_binary`/`create_binary` names is an implementation decision, deferred to the SDD phase based on what the Obsidian API makes practical.
- **Acceptance Criteria:**
  - [ ] Given a valid API key with read permission, When a non-markdown file is requested by path, Then the file content is returned (format TBD: base64 or streaming).
  - [ ] Given a valid API key with write permission, When a non-markdown file is submitted with a target path, Then the file is created in the vault at that path.
  - [ ] Given a non-markdown file request targeting a path outside the key's allowed scope, Then a 403 error is returned before any vault access.

#### Feature 5: API Key Management

- **User Story:** As a knowledge worker, I want to create, label, configure, and revoke API keys via a settings UI, so that each AI tool integration has exactly the access I intend.
- **Acceptance Criteria:**
  - [ ] Given the Kado settings panel is open, When a user clicks "Generate Key", Then a new key is created and the full secret is shown in the UI and remains visible for future reference.
  - [ ] Given an existing API key, When the user revokes it, Then all subsequent requests using that key receive a 401 response immediately.
  - [ ] Given a key configuration, the user can set path restrictions, tag restrictions, and frontmatter access as either whitelist or blacklist mode per option — but only from the set of items already allowed by global config.
  - [ ] Given a new API key is created, Then it defaults to no permissions and no scope (empty whitelist = nothing allowed) until the user explicitly grants access.
  - [ ] Given global config has an operation disabled, When a user attempts to grant that operation to any key via the UI, Then the UI prevents it and shows a clear explanation.

#### Feature 6: Two-Tier Access Control (Fail Fast + Queue)

- **User Story:** As a privacy-conscious knowledge worker, I want a global security policy that no individual key can exceed, and I want all security checks to happen before any vault operation begins, so that unauthorized requests are rejected immediately without consuming vault resources.
- **Acceptance Criteria:**
  - [ ] Given any request, When it arrives, Then all security checks (authentication, global gate, key permissions, path/tag/frontmatter scope) complete before the request enters the operation queue.
  - [ ] Given a request that fails any security check, Then a 401 or 403 response is returned immediately — no queue entry is created, no vault operation occurs.
  - [ ] Given a request that passes all security checks, Then it is added to the internal request queue and processed in order.
  - [ ] Given multiple requests arriving concurrently, Then each undergoes independent fail-fast security checks and valid requests are queued without blocking each other.
  - [ ] Given delete is disabled in global config, When any key attempts `delete_note`, Then a 403 is returned immediately regardless of key permissions.
  - [ ] Given global config uses whitelist mode for operations (default), When the whitelist is empty, Then all operations are denied.
  - [ ] Given a key's path whitelist is empty (default), Then all path-based operations are denied for that key until paths are explicitly added.
  - [ ] Rights can be configured at three levels: global, per-API-key, and per-resource-scope (path, tag, frontmatter). Lower levels can only restrict what higher levels permit — never expand beyond them.

#### Feature 7: Embedded MCP Server with Payload Versioning

- **User Story:** As an AI integration engineer, I want Kado to expose a standards-compliant MCP server that handles protocol evolution transparently, so that clients connecting with different API versions continue to work without requiring client updates.
- **Acceptance Criteria:**
  - [ ] Given the Kado plugin is loaded, When Obsidian starts, Then the MCP server starts on the configured port (default: 23026, configurable).
  - [ ] Given the Kado plugin is unloaded or Obsidian closes, Then all active client connections are closed gracefully and the port is released.
  - [ ] Given the server is running with default configuration, Then it binds only to `127.0.0.1`. Optionally, the user can configure a specific external IP address to bind to instead — this is an explicit opt-in with no UI warning suppression.
  - [ ] Given an MCP request without a valid Authorization header, Then a 401 response is returned immediately (before any other processing).
  - [ ] Each MCP tool request includes a `version` field in the JSON payload. The server routes it through the appropriate version adapter and responds with the matching version format.
  - [ ] Given an MCP client, When it connects and lists available tools, Then it only sees tools it has permission to call (based on key configuration) — not the full tool list.
  - [ ] Given two clients simultaneously sending write requests to the same note, The first write enters the queue and succeeds. The second receives a conflict error and must re-read before retrying.
  - [ ] The server port is configurable per vault. Each vault runs its own independent Kado instance on its own port.

#### Feature 8: Obsidian Settings UI

- **User Story:** As a knowledge worker, I want a clear settings panel inside Obsidian to configure Kado, so that I can manage the server, keys, and permissions without editing raw JSON.
- **Acceptance Criteria:**
  - [ ] Given the Kado plugin is installed, A dedicated settings tab is available in Obsidian's Settings panel.
  - [ ] The settings tab shows: server status (running/stopped), endpoint URL, and configured port.
  - [ ] The settings tab allows: enabling/disabling the server, changing port, configuring global permissions (whitelist/blacklist per option).
  - [ ] The settings tab allows: creating new API keys, viewing existing keys and their configuration, revoking keys.
  - [ ] Per-key configuration is editable in the UI: label, allowed operations, path filter (mode + values), tag filter (mode + values), frontmatter access.
  - [ ] Changes to global config that would conflict with existing key permissions show a clear warning.

---

### Should Have Features

- **Request Logging (Audit + Debug):**
  - Audit log: all vault-modifying operations (create, write, delete) with timestamp, key ID, operation, and path. Written to a configurable file. Toggleable, default ON.
  - Debug log: detailed request/response tracing. Written to Obsidian console. Toggleable, default OFF.
  - Both logs are independent. Log file location and max file size with rotation are configurable.
  - Always-on minimal console logging (not toggleable): plugin load, config changes, server start/stop, errors. This is informational and not request-level.
- **Rate Limiting:** Per-key request rate limit (configurable, default 60 req/min). Returns `429 Too Many Requests`.

### Could Have Features

- **Batch Operations:** A single MCP call that accepts multiple note creates/updates, processed sequentially through the queue, returning per-item results.
- **Active Note Resource:** An MCP resource exposing the currently open note in the Obsidian editor.
- **Link/Backlink Exposure:** `get_links` and `get_backlinks` tools for wikilink graph traversal.
- **Frontmatter Key-Level Access Control:** Whitelist/blacklist not just for "all frontmatter" but for individual frontmatter keys. (MVP: all-or-nothing frontmatter access per key.)
- **Settings Import/Export:** Backup and restore key configurations across Obsidian installs.

### Won't Have (This Phase)

- Full-text content search across the entire vault (future phase with dedicated indexing).
- Multi-vault support — one Kado instance serves one vault, 1:1.
- Obsidian Mobile support (MCP over TCP not viable on iOS/Android).
- Real-time collaborative editing or conflict resolution UI.
- External cloud authentication or accounts of any kind.
- API key expiration or automated rotation — keys are revoked manually.
- Note template management or generation recipes.
- Vault backup, versioning, or git integration.

---

## Detailed Feature Specifications

### Feature: Two-Tier Access Control with Fail-Fast and Request Queue

**Description:** Every MCP request passes through all security gates before any vault operation is queued or executed. Gates are evaluated in order; the first failure terminates the request immediately. Once a request clears all gates, it enters an internal FIFO queue and is processed in order to prevent concurrent vault conflicts.

**User Flow:**

1. Client sends a tool call with a Bearer token in the Authorization header and a `version` field in the JSON payload.
2. Gate 0 — Authentication: Is the token present and does it match a known key? If not → 401 immediately.
3. Gate 1 — Global Config: Is the requested operation in the global allowlist (or not in the global blacklist)? If not → 403 immediately.
4. Gate 2 — Key Permissions: Does this key's permission configuration allow the operation? If not → 403 immediately.
5. Gate 3 — Path Scope: If the key has a path filter, does the target path satisfy it (whitelist: must match; blacklist: must not match)? If not → 403 immediately.
6. Gate 4 — Tag Scope: If the key has a tag filter, does the target note satisfy it? If not → 403 immediately.
7. Gate 5 — Frontmatter Scope: If the operation accesses frontmatter and the key has frontmatter access disabled → 403 immediately.
8. All gates pass → add the request to the internal queue.
9. Queue processes requests in FIFO order. The vault operation executes. Result is returned to the client.

**Business Rules:**

- Rule 1: Global config and per-key configs each support two modes per option: **whitelist** (only listed items are allowed) or **blacklist** (listed items are denied, everything else allowed). Default for all options: **whitelist with empty content** = nothing is allowed.
- Rule 2: Per-key restrictions can only be equal to or narrower than global config. A key cannot grant access to an operation or path not permitted globally.
- Rule 3: Delete is off by default at the global level (empty whitelist). It must be explicitly added to the global whitelist before any key can use it.
- Rule 4: New API keys default to empty whitelist on all options — no operations, no paths, no tags permitted until the user explicitly configures them.
- Rule 5: Path filter uses glob patterns. Whitelist mode: request path must match at least one pattern. Blacklist mode: request path must match no listed pattern.
- Rule 6: Tag filter: whitelist mode requires the note to carry all listed tags; blacklist mode rejects notes carrying any listed tag.
- Rule 7: Frontmatter access is binary in v1: either all frontmatter is accessible to the key, or none. Per-key frontmatter field filtering is a Could Have for a later phase.
- Rule 8: The internal request queue serializes vault writes. Concurrent read requests may bypass the queue. If two write requests target the same note, the second receives a conflict error and must re-read before retrying.
- Rule 9: The server port is configurable per vault. Default: 23026.
- Rule 10: The MCP server runs 1:1 with a vault — there is no vault-switch scenario. If Obsidian closes, the server stops.

**Edge Cases:**

- Note deleted externally (via Obsidian UI or filesystem) while a queued request targets it → Operation returns 404; queue continues normally.
- Tag filter set on a key, but target note has no tags → Whitelist mode: denied (note has no tags, cannot satisfy the required tag list). Blacklist mode: allowed (no tags means no blacklisted tags present).
- Path traversal attempt (`/projects/../../private/secret.md`) → Detected at Gate 3 after path normalization; rejected with security error. No vault access occurs.
- Two clients send write requests to the same note concurrently → Both pass security gates independently. Both enter the queue. First processes successfully. Second detects a modification-time conflict, returns a conflict error; client must re-read and retry.
- Global config changed while a queued request is in-flight → In-flight request completes under the permissions it was validated with. Subsequent requests use the new config.

---

## Success Metrics

### Key Performance Indicators

- **Adoption:** 500 active installations within 90 days of public release.
- **Engagement:** Median active installation executes ≥ 10 MCP tool calls per day.
- **Quality:** Fewer than 1% of tool calls result in a server-side error (5xx). Auth/permission errors (4xx) are excluded — those are user-configuration events.
- **Security Posture:** 100% of installations where delete is used have explicitly added it to the global whitelist (no accidental deletions).

### Logging Requirements

Kado does not collect telemetry. All operational insight comes from two local, user-controlled logs:

**Always-on console logging (not toggleable):**
- Plugin loaded / unloaded (with version)
- Server started / stopped (with port)
- Configuration changes (field name, not values)
- Errors (server-level, not per-request)

**Audit log (toggleable, default ON, file-based):**
- All vault-modifying operations: timestamp, key ID, operation, path, result status.
- All auth failures: timestamp, reason (missing/invalid/revoked key).
- All security gate denials: timestamp, gate that denied, key ID.
- File location, max size, and rotation configurable.

**Debug log (toggleable, default OFF, console):**
- Full request/response details for development and troubleshooting.

---

## Constraints and Assumptions

### Constraints

- **Platform:** Obsidian desktop (Windows, macOS, Linux via Electron). Mobile is explicitly out of scope.
- **Standalone:** No external services, cloud accounts, or additional plugins may be required for any core feature.
- **Network:** The MCP server must bind to localhost (`127.0.0.1`) only. External network binding is not supported in v1.
- **Obsidian API:** All vault operations must go through Obsidian's official plugin API. Direct filesystem access is not permitted.
- **Vault 1:1:** One Kado instance serves one vault. Multi-vault operation requires multiple Obsidian instances with separate port configurations.
- **Minimum Obsidian version:** Target Obsidian plugin API 1.4.x or later.

### Assumptions

- Primary users are comfortable with developer-level configuration (generating API keys, editing glob patterns, configuring MCP clients).
- Claude Desktop is the primary MCP client; other clients (Cursor, Windsurf, custom) are supported but secondary.
- Vaults up to 10,000 notes perform acceptably. Larger vaults may experience degraded search performance (documented limitation).
- API keys are stored as-is in Obsidian's plugin data — Kado is a personal local service. If a key is lost, a new one is generated — no recovery flow is needed.
- The MCP protocol (v1.0+) with payload-based versioning is the stable foundation for the server's external interface. Internal protocol evolution is handled via the versioning and Anti-Corruption Layer described in the architecture decisions.

---

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| MCP protocol changes break client compatibility | High | Low | Payload-based API versioning: each request carries a `version` field; server maintains version adapters and a canonical inner model so older clients continue working. See architecture decision: MCP Server with Payload Versioning and Anti-Corruption Layer. |
| Obsidian Plugin API changes break vault operations | Medium | Low | Abstract all Obsidian API calls behind an adapter layer (ACL pattern). API changes are isolated to the adapter, not spread across tool handlers. |
| Path traversal allows access outside vault | High | Low | Canonical path resolution and vault-root boundary check at Gate 3 on every request, before queue entry. |
|Performance degrades on large vaults causing Obsidian UI stutter | Medium | Medium | Async, yielding operations; pagination on list calls; request queue prevents concurrent write conflicts. |
| Users accidentally configure overly permissive global settings | High | Medium | Default is empty whitelist (nothing allowed). All permissions must be explicitly granted. UI shows warnings for broad configurations. |
| Concurrent writes from queued clients cause note corruption | Medium | Low | Write requests are serialized via the internal FIFO queue. Conflict detection returns a clear error to the second writer. |

---

## Open Questions

- [ ] Rate limiting: per-key only, or also a global vault-wide cap? (Current plan: per-key for MVP, global cap after MVP.)
- [ ] Soft-delete (to Obsidian trash) is the only delete mode — using Obsidian's built-in delete function. No separate "permanent delete" operation in v1.
- [ ] Default port: 23026.
- [ ] Settings import/export (key config backup): deferred to post-MVP.

---

## Supporting Research

### Competitive Analysis

Several Obsidian MCP plugins exist, but none fully address the security and standalone requirements:

- **obsidian-mcp (and similar):** Provides MCP tool access to vault notes. Requires an external MCP server process running alongside Obsidian, or depends on another community plugin. No per-client access control.
- **obsidian-local-rest-api:** REST API for Obsidian, not MCP-compliant. Basic API key authentication but no granular path/tag restrictions.
- **obsidian-copilot:** AI assistant plugin; reads vault context but does not expose an MCP server for external clients.
- **Custom scripts (Python/Node.js):** File-system access, no auth, no MCP compliance, breaks when Obsidian is not running.
- **MCP filesystem server (Anthropic reference):** Generic filesystem MCP server; no Obsidian-specific features (no MetadataCache, no frontmatter/tag awareness), no access control.

**Key differentiation:** All existing solutions are either not MCP-compliant, require external processes/plugins, have no access control, or require an internet connection. Kado addresses all four gaps simultaneously.

### User Research

Consistent signals from Obsidian community forums and Discord:
1. "Let Claude read my notes" — high demand, no clean solution.
2. "Restrict AI to specific folders" — access control is the #1 concern after basic access.
3. "Don't send my notes to the cloud" — offline/privacy requirement is consistent across all user segments, especially the primary persona.
4. Key complaint about existing tools: "It either sees everything or nothing."

### Market Data

- Obsidian has over 1 million users (2024). Top community plugins reach 500k+ installs.
- MCP (released November 2024) is rapidly adopted: Claude Desktop, Cursor, Windsurf, and dozens of MCP servers emerged within months of release.
- The combination of Obsidian × MCP with granular security represents a high-demand, currently unserved niche.
