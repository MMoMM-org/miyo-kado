# PRD — Kado v1 (Obsidian MCP Gateway)

---

## 1. Product Overview

### Vision
Kado makes the use of AI agents in Obsidian practical for security-conscious users by acting as a finely controllable gateway between Vault and AI — without compromising on control or transparency.

### Problem Statement
Today, users who want to connect AI tools to their Obsidian Vault must either rely on generic MCP servers or direct IDE integrations, which often grant agents broad or full access to all content. This leads to justified concern that highly personal data, sensitive notes, or important project documents might be read, overwritten, or deleted unintentionally. As a result, many users forgo deeper AI integration entirely or resort to cumbersome workarounds (e.g., separate "AI Vaults"), which significantly reduces the usefulness of these tools.

### Value Proposition
Kado enables the user to define exactly which areas of the Vault an AI may see and with which permissions (CRUD) it may operate there — separately for Notes, Frontmatter, Dataview Inline Fields, and other files, as well as per API key/agent. This allows AI agents to work productively with the user's actual knowledge base, while the user no longer has to worry about private content being accidentally shared or important data being modified without control.

### Scope of this Feature
This PRD describes Kado v1 as an Obsidian plugin that provides a local MCP server, supports global and API-key-specific access configurations, covers four data types (Notes, Frontmatter, Dataview Inline Fields, other files), and provides search/listing functions with complete, chunked results. Persistent indexes, RAG features, complex network security (TLS), and multi-instance coordination are explicitly outside the v1 scope and will be addressed separately.

---

## 2. User Personas

### Primary Persona: Security-Conscious Knowledge Worker

- **Profile**
  Works intensively with Obsidian as a "second brain": personal reflection, client notes, project ideas, long-term knowledge collection. Technically proficient enough to configure plugins, but not an infrastructure expert.

- **Goals**
  - Use AI agents to search, summarize, and structure notes more quickly.
  - Be confident that certain sensitive areas (e.g., diary, health data, confidential client data) are never read or modified by AI.
  - Clearly separate which note areas each agent (e.g., coaching bot, coding companion) is allowed to use.

- **Pain Points**
  - Distrust of generic integrations that make "everything in the Vault" accessible.
  - Fear of accidental deletion or overwriting of important notes by AI actions.
  - Cumbersome workarounds (separate Vaults, manual copy/paste flows) that cost time and create error-prone processes.
  - Complex security configurations that are hard to understand and increase the risk of accidentally granting too much access.

### Secondary Persona 1: Technical Power User / Developer

- **Profile**
  Develops software and uses Obsidian for project documentation (architecture notes, decision logs, to-dos). Connects multiple AI tools/IDEs (e.g., Tomo, repo-specific agents) to the same Vault.

- **Goals**
  - Equip different agents with different permissions (e.g., build agent may read project folders but not the private journal).
  - Have a clear mapping between API keys and agents to be able to trace behavior.
  - Unified, reusable permission profiles for multiple repos/agents.

- **Pain Points**
  - Lack of separation between workspaces and private areas in the Vault with existing MCP servers.
  - Difficult debugging when an agent has too many permissions and makes unexpected changes.
  - Configurations that are not easy to document or version, making it unclear later why an agent had certain permissions.

### Secondary Persona 2: Privacy-Sensitive Professional (Consultant, Coach, Therapist)

- **Profile**
  Uses Obsidian for confidential client or customer data and wants to use AI for preparation, analysis, and structuring of this content without violating ethical or legal frameworks.

- **Goals**
  - Ensure that certain dossiers or folders are never touched by AI.
  - Transparently trace which content a specific agent could potentially have seen or modified.
  - Conservative, easily explainable security configurations (e.g., for internal compliance or toward clients).

- **Pain Points**
  - Strong concern that sensitive data might unintentionally end up in external AI contexts.
  - Existing solutions are either too coarse (all or nothing) or too technical to configure trustworthily.
  - Lack of auditability regarding which areas of a Vault were accessible to an agent and when.

---

## 3. User Journey Maps

### Journey 1 (Primary, Happy Path): Knowledge Worker sets up Kado and gives an existing agent targeted access

**Trigger**
The Knowledge Worker already uses an AI agent (e.g., Tomo) and wants to connect it to the Obsidian Vault without the agent being able to see or modify the entire "second brain."

**Steps**

1. **Install and activate Kado**
   - User discovers Kado in the plugin catalog or through documentation and installs the plugin.
   - On first launch, a brief intro explains that Kado acts as an MCP server and offers API-key-based permission management.

2. **Review the global security framework**
   - In the Global Config, the user sees that Kado runs in whitelist mode with "nothing permitted" by default (Default-Deny).
   - They leave this secure default in place and define one or more global areas (e.g., "Projects/Client A", "Notes/Work") where AI access may generally be permitted, and assign coarse CRUD permissions there (e.g., Notes: RU, Frontmatter: RU, Files: R).

3. **Create an API key for the agent**
   - User generates a new API key and assigns a descriptive name like "Tomo – Work Assistant."
   - In the API Config, they select which global areas this key may use and refine the permissions (e.g., Notes: R, Frontmatter: RU, Files: R).
   - They copy the API key and enter it in the AI client's configuration.

4. **Test access**
   - User asks the agent in the AI tool to find or summarize a specific work note.
   - The agent can only read and optionally update notes within the configured areas; attempts to access private areas (e.g., "Journal/Personal") fail visibly.
   - User gains confidence that the access boundaries work.

5. **Incremental adjustment as needed**
   - After initial experience, the user adjusts permissions, e.g., allows the agent to edit Frontmatter (status fields, tags) but leaves delete permissions disabled for now.
   - Adjustments are traceable per API key without making global settings unwieldy.

**Result**
The Knowledge Worker uses their existing agent productively with a relevant portion of the Vault, while sensitive areas remain protected. They understand which folders and permissions the agent has and can fine-tune them at any time without needing to resort to separate "AI Vaults."

---

## 4. Feature Requirements (MoSCoW)

### Must Have

#### 1. Default-Deny global access model
**User story**
As a security-conscious Obsidian user, I want Kado to start with no content shared, so that no AI agent has access without my explicit approval.

**Acceptance criteria**
- Given Kado is newly installed or reset, when the user opens the configuration, then no Notes, Frontmatter, or other files are accessible to any API key by default.
- Given no global areas have been permitted, when an AI agent sends a validly authenticated request, then Kado denies access to all Vault content.
- Given a path is not explicitly permitted globally, when an API key requests access to that path, then Kado denies the request.

#### 2. Global scope configuration for Vault areas
**User story**
As a user, I want to define globally permitted Vault areas, so that only selected folders or path scopes are even eligible for AI access.

**Acceptance criteria**
- Given the user is in the global configuration, when they define a permitted area, then Kado stores that area as part of the global access model.
- Given a path lies outside all globally permitted areas, when an API key requests access to that path, then Kado denies the request.
- Given a path is globally within a permitted area, when no API key scope grants access to it, then access remains denied.

#### 3. API-key-based authorization
**User story**
As a user, I want each AI agent to work with its own API key, so that I can control permissions per agent or agent group.

**Acceptance criteria**
- Given a user creates an API key, when they assign it to an agent, then requests with that key are evaluated against the key-specific permissions.
- Given a request is sent without an API key or with an unknown key, when Kado receives it, then it is rejected.
- Given two agents use the same API key, when they send requests, then Kado treats them as the same permission identity.

#### 4. Per-key scoped permissions within global bounds
**User story**
As a user, I want to define per-API-key permitted scopes within the global areas, so that different agents can access different parts of my Vault.

**Acceptance criteria**
- Given a global area is permitted, when the user configures an API key scope within that area, then the key may only operate within that scope, not the entire global area, unless explicitly granted.
- Given an API key has no scope for a globally permitted area, when it requests access there, then Kado denies the request.
- Given an API scope attempts to access beyond global boundaries, when Kado evaluates the configuration, then access is restricted to the globally permitted boundaries.

#### 5. Independent CRUD permissions by data type
**User story**
As a user, I want to configure separate CRUD permissions for Notes, Frontmatter, Dataview Inline Fields, and other files, so that I can precisely control which data an AI agent may read or modify.

**Acceptance criteria**
- Given an API key has read but no update permissions for Notes, when it attempts to modify a note, then Kado denies the request.
- Given an API key has update permissions for Frontmatter but only read permissions for Notes, when it uses a Frontmatter update tool, then Kado allows the Frontmatter modification.
- Given an API key has only read permissions for other files, when it attempts to create or delete a non-Markdown file, then Kado denies the request.
- Given an API key has read permissions for Dataview Inline Fields, when it queries inline fields of a note, then Kado returns the inline fields as structured data.
- Given an API key has no write permissions for Dataview Inline Fields, when it attempts to modify an inline field, then Kado denies the request.

#### 6. Distinct Note and Frontmatter permission model
**User story**
As a user, I want to configure Frontmatter permissions independently of Note permissions, so that I can allow metadata workflows without giving full control over the note content.

**Acceptance criteria**
- Given an API key has Frontmatter update permissions, when it uses a Frontmatter-specific operation, then it may update Frontmatter even if Note update is not permitted.
- Given an API key has Note update permissions, when it modifies the content of a note, then the operation may also change the Frontmatter, because the entire file is being updated.
- Given an API key has no Frontmatter read permissions but has Note read permissions, when it reads the note via a Note read operation, then it receives the complete file content including the embedded Frontmatter.

#### 7. Fail-fast authorization before execution
**User story**
As a user, I want unauthorized operations to be rejected before any work begins, so that impermissible requests do not consume resources or create risks.

**Acceptance criteria**
- Given a request targets a path or operation outside the API key's permissions, when Kado receives it, then the request is rejected before any execution.
- Given a request is unauthorized, when it is evaluated, then it is not placed into any queue.
- Given a request is authorized, when the evaluation is complete, then it may proceed to execution or queuing.

#### 8. Auditability of access decisions and file operations
**User story**
As a user, I want Kado to log access decisions and file operations, so that I can trace what an agent attempted and what was allowed or denied.

**Acceptance criteria**
- Given audit logging is enabled, when an API request is processed, then Kado records whether the request was allowed or denied.
- Given audit logging is enabled, when a file operation succeeds or fails, then Kado logs metadata about the operation without storing sensitive file content in the log.
- Given the user disables audit logging, when requests are processed, then Kado does not generate new audit entries.

#### 9. Global configuration screen
**User story**
As a user, I want a central global configuration area in Obsidian, so that I can understand and control the overall security posture of Kado in one place.

**Acceptance criteria**
- Given Kado is installed, when the user opens the settings, then they can view and edit the global configuration in a dedicated section.
- Given the user opens the global settings, when no configuration has been created yet, then the interface clearly shows the Default-Deny initial state.
- Given the user changes global settings, when they save or confirm the change, then Kado uses the updated global configuration for subsequent requests.

#### 10. Configurable server exposure mode
**User story**
As a user, I want to choose whether Kado is reachable only on localhost or on a configured IP, so that I can adapt access to my local or multi-device usage.

**Acceptance criteria**
- Given the user is in the global configuration, when they configure the server exposure mode, then they can choose between "localhost only" and a configured IP.
- Given "localhost only" is selected, when the user checks the settings, then the interface clearly shows that Kado is only reachable locally.
- Given IP-based is selected, when the user views or edits the setting, then the configured bind target is visible and understandable.

#### 11. Manage global allowed areas
**User story**
As a user, I want to define named global areas of my Vault, so that I can reuse these areas as the outer permission boundary for API keys.

**Acceptance criteria**
- Given the user is in the global configuration, when they create a new global area, then they can define the relevant Vault scope in a reusable manner.
- Given one or more global areas exist, when the user reviews them, then each area is presented clearly enough to understand its purpose and coverage.
- Given the user modifies or removes a global area, when the change is confirmed, then future effective permissions reflect the updated definition.

#### 12. API key management interface
**User story**
As a user, I want to create and manage API keys in Kado, so that I can connect different agents without losing track of their access.

**Acceptance criteria**
- Given the user opens API key management, when they create a key, then Kado generates a new API key and makes it available for copying.
- Given an API key exists, when the user views the list of keys, then they can identify each key by its descriptive name.
- Given an API key should no longer be used, when the user deactivates or revokes it, then future requests with that key are rejected.

#### 13. Per-key configuration screen
**User story**
As a user, I want a dedicated configuration view for each API key, so that I can manage an agent's permissions without confusing them with other settings.

**Acceptance criteria**
- Given an API key exists, when the user opens its configuration, then they can view and edit scope and permissions for that key in a dedicated section.
- Given the user edits an API key, when they make changes, then those changes affect only that key and no other keys.
- Given the user reviews an API key, when they inspect the configuration, then they can understand what that key is allowed to do.

#### 14. API-key-level area selection inside global bounds
**User story**
As a user, I want to select per API key which globally defined areas it may use, so that I can tailor each agent precisely to its working contexts.

**Acceptance criteria**
- Given global areas exist, when the user configures an API key, then they can only assign areas that are globally available.
- Given an API key is configured, when the user reviews it, then they see which subset of global areas is assigned to that key.
- Given a global area is removed or restricted, when the user reviews an affected API key, then the UI reflects that the effective access of that key has changed.

#### 15. CRUD permission editing per data type
**User story**
As a user, I want to assign CRUD permissions separately for Notes, Frontmatter, Dataview Inline Fields, and other files per area and API key, so that I can create precise agent profiles without needing deep technical knowledge.

**Acceptance criteria**
- Given the user configures an API key for an area, when they edit permissions, then they can distinguish permissions for Notes, Frontmatter, and other files.
- Given permissions are displayed in the UI, when the user reviews them, then it is clearly visible which operations are allowed and which are not.
- Given the user changes permissions, when the configuration is saved, then the new effective permissions apply to future requests.

#### 16. Understandable effective-permissions view
**User story**
As a user, I want to see the effective permissions of an API key after combining global and API-specific rules, so that I can verify what an agent is actually allowed to do.

**Acceptance criteria**
- Given global and API key settings exist, when the user views an API key, then they can understand the resulting effective permissions without having to manually calculate them from both layers.
- Given an API key is more restrictive than the global configuration, when the user reviews it, then the additional restrictions are visible.
- Given a desired capability is not effectively permitted, when the user inspects the key configuration, then they can see that this capability is blocked.

#### 17. Path/directory listing within the permitted scope
**User story**
As a user, I want an agent to be able to list the structured contents within its permitted areas, so that it knows which notes and files are available.

**Acceptance criteria**
- Given an API key with valid permissions, when the agent requests a listing for a path, then Kado returns only entries that lie within the global and API-specific scope.
- Given a listing contains many entries, when the agent retrieves results, then Kado delivers them in clearly delineated chunks or pages.
- Given a path is not within the effective scope, when a listing is requested, then Kado denies the request.

#### 18. Complete, chunked note content search
**User story**
As a user, I want an agent to be able to search for text in notes and receive complete but chunked results, so that nothing is overlooked, even if the search takes longer.

**Acceptance criteria**
- Given an API key with read permissions on Notes, when a search term is searched across notes in the permitted scope, then Kado searches all relevant notes within that scope.
- Given the number of matches is large, when the agent retrieves search results, then Kado delivers the matches in chunked/paged result sets with a mechanism for loading additional matches.
- Given an area is not readable, when a search is issued, then content from that area does not appear in the results.

#### 19. Frontmatter and tag-based search
**User story**
As a user, I want an agent to be able to search by Frontmatter fields and tags, so that it can use structured workflows (e.g., status fields, categories, tags) without relying on full-text search.

**Acceptance criteria**
- Given an API key with read permissions on Frontmatter and Notes, when Frontmatter or tag-based filters are used, then Kado considers all matching notes within the permitted scope.
- Given the agent filters by a tag or simple Frontmatter field, when results are delivered, then they are complete with respect to the effective scope.
- Given an API key has no Frontmatter read permissions, when Frontmatter-specific search criteria are submitted, then Kado handles these criteria so that no unauthorized data is disclosed (e.g., rejection or clearly indicated non-support).

#### 20. Use Obsidian APIs before custom scans
**User story**
As a user, I want Kado to rely on Obsidian APIs and caches as much as possible, so that search and listing efficiently and consistently reflect the Vault state.

**Acceptance criteria**
- Given Obsidian APIs or metadata caches exist for a type of search/listing, when Kado provides corresponding functions, then Kado uses these Obsidian mechanisms before initiating custom full scans.
- Given a search/listing case cannot be fully covered via Obsidian APIs, when Kado uses its own reads, then those reads are limited to the effective scope and the necessary minimum.

#### 21. Clear separation of reading vs. writing in search results
**User story**
As a user, I want search and listing functions to show only what the agent is allowed to read and not create implicit write permissions, so that I do not unknowingly grant more access than intended.

**Acceptance criteria**
- Given an API key has only read permissions, when it uses search or listing functions, then all returned information is read-only and does not enable covert write operations.
- Given an API key has write permissions, when it uses results from a search, then write operations are still checked against the RBAC rules and not automatically derived from the search results.

### Should Have

- API keys can have a descriptive name for easier administration.
- Users can deactivate or revoke an API key without deleting all other configurations.
- Users can see per API key which areas and CRUD permissions are currently effective.
- Unauthorized responses make clear that the action was blocked by permissions without disclosing protected content.
- Ability to filter search results by file type (Notes vs. other files), provided permissions allow it.
- Option to restrict search queries to a specific global or API key area without manually specifying paths.
- Simple mechanism on the agent side to load additional search or listing chunks via cursor/page token.
- Clear text and labels in the UI that explain the difference between global configuration and API-key-specific configuration.
- UI wording that reduces accidental over-permissioning (especially delete permissions).
- Simple onboarding explanation that clearly describes Default-Deny and the two layers of permissions.

### Could Have

- Reusable permission templates for typical agent roles.
- Warnings when a user configures unusually broad permissions.
- Plain-language summary of an API key's permissions (e.g., "May read Notes in /Work, but cannot delete anything").
- Guided setup for a first agent (e.g., Tomo).
- Combination of multiple filters (tag + sub-path + text fragment) in a single query, as long as performance remains controllable.
- Sorting of search results by simple criteria (e.g., path name, modification date), if available via Obsidian.
- "Count only" queries to preview the result volume.

### Won't Have (v1)

- Field-level Frontmatter policies or tag-specific permissions independent of Notes/Frontmatter.
- Persistent global search indexes or RAG/vector search.
- Complex boolean query languages or regex search beyond what Obsidian natively offers.
- Automatic protection layers that prevent indirect Frontmatter changes through Note writes.
- Transport-layer security such as full TLS/certificate management.
- Cross-device or cross-instance permission coordination.
- Versioned configuration history or multi-admin collaboration in the v1 scope.

---

## 5. Detailed Feature Specifications

### 5.1 Permission Evaluation (Effective Permissions)

**User Flow (high level)**
1. An agent sends a request with an API key, the desired operation (e.g., read note, update Frontmatter), and a target (path/file).
2. Kado identifies the API key and loads the associated API Config and Global Config.
3. Kado calculates the effective permissions from Global Config and API Config for:
   - the affected path (including the associated area),
   - the affected data type (Note, Frontmatter, other file),
   - the requested CRUD operation.
4. If the operation is not permitted, it is rejected fail-fast; otherwise, it may proceed to execution.

**Business Rules**

- **BR-P1: Existence of a known API key**
  - Requests without an API key or with an unknown key are considered fully unauthorized.
  - Consequence: The request is immediately rejected; no further permission evaluation takes place.

- **BR-P2: Default-Deny — Global Layer**
  - Global Config is always Default-Deny (whitelist with "nothing permitted").
  - A path can only be considered if it lies within at least one global area that fundamentally permits the requested data type/CRUD combination.

- **BR-P3: API key can only restrict globally, not extend**
  - API key scopes may never grant access to paths that are not globally permitted.
  - Effective permissions of an API key for a path are the intersection of global permissions and key-specific permissions.

- **BR-P4: Path scoping per area**
  - For each request, the path is mapped to one or more configured areas (e.g., by folder structure).
  - If a path falls within no permitted area, all CRUD operations on it are impermissible, regardless of data type.

- **BR-P5: Data-type-specific permissions (Note/Frontmatter/Dataview Inline Fields/other files)**
  - For each area, permissions are defined separately for Note, Frontmatter, Dataview Inline Fields, and other files.
  - The effective permission for an operation depends on the data type of the operation (e.g., Note-Read vs. Frontmatter-Update vs. Inline-Field-Read).
  - Dataview Inline Fields are fields in the note body (e.g., `key:: value`). They are treated as their own data type because they represent structured metadata within running text.

- **BR-P6: Note operations technically encompass the entire Markdown document**
  - Note operations (read, write, delete) act on the `.md` document including embedded Frontmatter.
  - If Note-Write is permitted, changes to Frontmatter caused by Note-Write are considered permissible.

- **BR-P7: Frontmatter operations are logically limited to the Frontmatter block**
  - Frontmatter operations target exclusively the Frontmatter block, not the remaining note text.
  - Frontmatter permissions are independent of Note permissions but are not additionally checked during Note operations.

- **BR-P8: Other files follow their own CRUD set**
  - Permissions for non-Markdown files are managed separately.
  - A key with R permission for "other files" may read them, but without C/U/D permissions cannot create, overwrite, or delete them.

- **BR-P9: Fail-fast decision**
  - Before an operation is executed or placed in a queue, the effective permission is checked.
  - Impermissible requests are immediately rejected with a non-leaking justification (e.g., "not permitted").

- **BR-P10: Audit entry for authorized and denied requests (if enabled)**
  - If audit is enabled, the following is logged per request: key, operation type, target area/path, decision (allowed/denied).
  - File content is not written to the log.

**Edge Cases**

- **EC-P1**: A path belongs to multiple global areas with different permissions → Rules must define how global permissions are combined (e.g., union globally, then intersection with key permissions).
- **EC-P2**: A global area is changed/removed while API keys reference it → Effective permissions immediately reflect the new global state, without privileging legacy access.

---

### 5.2 Chunked Search & Listing

**User Flow (Search)**
1. An agent submits a search query (e.g., full text, tags, Frontmatter filter) within its permitted scope.
2. Kado checks the permissions (read permissions, scope).
3. Kado executes the search across the permitted scope and collects all matching results.
4. Kado delivers the results in chunks/pages with the ability to load additional chunks.

**Business Rules**

- **BR-S1: Scope-First Search**
  - Before every search, the effective scope of the API key is calculated.
  - Only files/notes within the effective scope are included in the search set.

- **BR-S2: Obsidian-API-First Strategy**
  - Listing/search uses Obsidian APIs/metadata caches where possible.
  - Custom file reads are used only where Obsidian is insufficient and are restricted to the scope.

- **BR-S3: Completeness over speed**
  - A search is considered successful when all relevant files in the scope have been checked.
  - Slowness is acceptable; performance is managed through chunking/throttling, not premature termination.

- **BR-S4: Chunking of results**
  - If the number of matches exceeds a threshold, results are delivered in multiple chunks.
  - Each chunk contains enough information for the agent to continue meaningful work.

- **BR-S5: Cursor/"Next Page" mechanism**
  - Each chunk contains metadata for targeted loading of the next chunk (e.g., cursor/token).
  - When no further results are available, Kado signals this clearly.

- **BR-S6: Separation of data types in search**
  - Specific note searches exclude other files, and vice versa, unless the agent explicitly requests mixed types.
  - Frontmatter filters apply to notes; Frontmatter read permissions affect which metadata is visible in results.

- **BR-S7: No implicit extension of permissions through search**
  - Search/listing must not reveal information about paths/areas for which the API key has no read permissions.
  - Matches from non-readable areas are completely suppressed.

- **BR-S8: Error/timeout handling**
  - If a search is aborted due to a runtime limit or error, Kado informs the agent that results are incomplete.
  - Kado does not declare partial results as complete if parts of the scope were not searched.

**Edge Cases**

- **EC-S1**: Very large result sets in one area → Chunk sizes must keep Obsidian responsive while still ensuring complete reloadability.
- **EC-S2**: Vault changes during multi-step search/listing sequences → Kado does not guarantee historical consistency, operates on the current state, but does not signal false completeness.

---

### 5.3 MCP Tool Architecture ("Fat Tools" Pattern)

Kado deliberately exposes only three MCP tools. The sub-operation is controlled via a JSON field in the request. This design minimizes context consumption in LLM clients and simplifies permission checking per tool type.

| MCP Tool | Sub-operations (JSON `operation`) | Data types |
|----------|-------------------------------------|------------|
| `kado-read` | `note`, `frontmatter`, `file`, `dataview-inline-field` | All four |
| `kado-write` | `note`, `frontmatter`, `file`, `dataview-inline-field` | All four |
| `kado-search` | `byTag`, `byName`, `listDir`, `listTags` | Note/file metadata |

**Business Rules**

- **BR-T1: Three tools, no explosion**
  - Kado registers exactly three MCP tools. New functionality is added through sub-operations in the JSON, not through new tool names.

- **BR-T2: Read and Search include timestamps**
  - All `kado-read` and `kado-search` responses contain the timestamps (created, modified) of the affected files.
  - These timestamps serve as the basis for optimistic concurrency during write operations (see 5.4).

- **BR-T3: Sub-operation determines the data type for permission checking**
  - The sub-operation (`note`, `frontmatter`, `file`, `dataview-inline-field`) determines which data type CRUD is checked.
  - A `kado-write` with `operation: "frontmatter"` checks Frontmatter write permissions, not Note write permissions.

- **BR-T4: No payload versioning**
  - MCP clients (Claude, Cursor, etc.) discover tools dynamically via `tools/list` and work with the current schema. A `version` field in the payload is not required and is not supported.

---

### 5.4 Optimistic Concurrency via Timestamps

Kado uses timestamp-based optimistic concurrency instead of queue-based conflict detection for write operations on existing files.

**User Flow**
1. Agent reads a file via `kado-read` → Response contains the `modified` timestamp.
2. Agent sends an update via `kado-write` → Request contains the `modified` timestamp of the read version.
3. Kado checks: Does the supplied timestamp match the current file state?
   - Yes → Write operation is executed.
   - No → Error: "File was updated in the background" — Agent must re-read.

**Business Rules**

- **BR-C1: Timestamp required for partial updates**
  - Partial writes and updates (Frontmatter, Dataview Inline Fields, Note content update) require the `modified` timestamp of the target file in the request.
  - If the timestamp is missing, the request is rejected with a validation error.

- **BR-C2: Create does not need a timestamp**
  - `kado-write` with a new file (Create) does not require a timestamp. If the file already exists, a conflict error is returned.

- **BR-C3: Timestamp mismatch is not a permission error**
  - A mismatch is returned as a 409 Conflict, not a 403. The agent has permission, but the file has changed.

---

### 5.5 Layered Architecture (Dual Anti-Corruption Layer)

Kado is structured into four clearly separated layers. Changes to the MCP protocol or the Obsidian API affect only the outer layer on the respective side. The Core remains stable.

```
MCP Client (Claude, Cursor, Tomo, ...)
    ↕
[MCP API Handler]              ← ACL outward (MCP protocol → canonical model)
    ↕
[Kado Core]                    ← Business logic: permissions, routing, concurrency
    ↕
[Obsidian Plugin Interface]    ← ACL inward (canonical model → Obsidian API)
    ↕
Obsidian Vault API
```

**Business Rules**

- **BR-A1: Kado Core knows neither MCP nor Obsidian**
  - The Core works exclusively with canonical internal models. It imports neither MCP SDK types nor Obsidian API types.

- **BR-A2: MCP API Handler encapsulates the protocol**
  - Changes to the MCP protocol or SDK are handled exclusively in the MCP API Handler.
  - The handler translates MCP requests into canonical Core requests and Core responses back into MCP responses.

- **BR-A3: Obsidian Plugin Interface encapsulates the host API**
  - All Vault access (reading, writing, metadata, search) goes through the Obsidian Plugin Interface.
  - If Obsidian changes an API or does not offer a needed function, the adaptation is made here — not in the Core.

- **BR-A4: Both ACLs are replaceable**
  - If a different protocol (not MCP) or a different host (not Obsidian) needs to be supported in the future, the outer layers can be replaced without changing the Core.

---

## 6. Success Metrics

**Security & Correctness**

1. Proportion of blocked unauthorized requests
   - Target: >= 99% of all requests that lie outside the effective scope are correctly rejected.
   - Measurement: Ratio of "requests rejected due to permissions" to "all requests with invalid paths/operations" (audit/logs, if available).

2. Zero incidents of data loss caused by Kado
   - Target: 0 confirmed cases where Kado v1 led to unintended deletion/overwriting outside the permitted permissions.
   - Measurement: Incident tracking (issues/support), classification by cause.

3. Correct scope adherence in search/listing
   - Target: 100% of search/listing results contain only entries within the effective scope of the API key.
   - Measurement: Snapshot tests with test Vaults, comparison of expected vs. delivered results.

**Usability & Configuration**

4. Time to first successfully configured agent
   - Target: Median < 15 minutes from plugin install to the first successful agent call on desired areas.
   - Measurement: User tests or telemetry proxies (time between "settings opened" and "first permitted request from a new key").

5. Configuration error rate per API key
   - Target: < 10% of API keys are configured such that users later report "agent sees too much or too little."
   - Measurement: Support/issue analysis, possibly telemetry on repeated permission errors.

6. Clarity of effective permissions
   - Target: >= 80% of surveyed users say they can understand from the UI what an API key is allowed to do.
   - Measurement: Brief survey/beta feedback (Likert scale).

**Adoption & Engagement**

7. Number of active installations with at least one used API key
   - Target: Specific target value X within Y months (to be defined).
   - Measurement: Anonymous install/usage signals, if permissible; otherwise proxy metrics (downloads, issues).

8. Usage of multiple API keys per installation
   - Target: >= 30% of active installations use more than one API key.
   - Measurement: Aggregated count of configured keys (if technically and privacy-feasible).

---

## 7. Constraints and Assumptions

**Technical Constraints**

1. Obsidian plugin model
   - Kado v1 runs exclusively as an Obsidian plugin.
   - All functions must work with the available Obsidian APIs and a local Vault.

2. MCP server within the plugin
   - Kado provides the MCP server itself and runs on the user's machine.
   - No additional external infrastructure is required.

3. No persistent index in v1
   - Kado v1 does not use a persistent on-disk index.
   - Search/listing: Obsidian-API-first, on-demand reads with chunking.

4. Network/transport
   - v1 supports binding to localhost or a configured IP, but no full TLS/certificate infrastructure.
   - Securing transport between devices is the user's responsibility.

5. No multi-instance coordination
   - Kado v1 does not coordinate state between multiple Obsidian instances.
   - Obsidian Sync/other syncs are separate layers.

**Product & Scope Constraints**

6. Security focus with simple modeling
   - RBAC: Path scopes + CRUD per data type.
   - Field-level Frontmatter policies/tag-specific permissions are out of scope.

7. No anti-corruption layer at the note level
   - Indirect Frontmatter changes through Note-Write are accepted, provided Note-Write is permitted.
   - Kado deliberately does not block these paths, even in the future.

8. No RAG/vector in v1
   - RAG/vector search and semantic indexes are deliberately excluded and intended as a future, separate plugin/feature.

9. Four-layer architecture (Dual ACL)
   - Kado follows strict layer separation: MCP API Handler → Kado Core → Obsidian Plugin Interface.
   - The Core knows neither MCP SDK types nor Obsidian API types.
   - See ADR-001: Dual Anti-Corruption Layer Architecture.

10. Three MCP tools ("Fat Tools" Pattern)
    - Kado exposes exactly three MCP tools: `kado-read`, `kado-write`, `kado-search`.
    - Sub-operations are controlled via a JSON field, not through separate tool names.

11. Timestamp-based optimistic concurrency
    - Write operations on existing files require the `modified` timestamp of the last read version.
    - On timestamp mismatch, a conflict error is returned.

**Assumptions**

9. User technical competence
   - Target users can install plugins, configure API keys in clients, and understand path/folder concepts.

10. AI clients support MCP stably
   - Key target clients (e.g., Tomo) support MCP stably enough to use Kado as a local server.
   - Client limitations are not a primary scope of Kado v1.

11. Vault sizes within a "reasonable" range
   - Assumption: Typical Vaults are large but not extreme (millions of files are not the primary target).
   - Correctness + acceptable performance for Knowledge Worker Vaults are the focus.

12. Telemetry/privacy
   - Assumption: No content telemetry; if metrics are collected, then without content and ideally opt-in.
   - This PRD does not require a specific telemetry implementation, only possible KPIs.

---

## 8. Open Questions

1. Audit detail level and retention
   - How detailed should audit logs be in v1 (only decision + path/area + operation type vs. additional metadata)?
   - What retention period is sensible, and is UI support for deletion/rotation needed?

2. UX depth for effective permissions
   - How visual should the permissions overview be (table vs. graphical scope view)?
   - Does v1 need an "explain in plain language" view per API key?

3. Configuration of chunk sizes
   - Should chunk sizes be hardcoded or configurable (possibly in Advanced Settings)?
   - Is a "gentle mode" for weaker machines needed in v1?

4. Handling of very large Vaults
   - Does v1 need warnings/hints for extremely large Vaults?
   - Is a "scope health check" useful that makes potential performance issues from configuration + Vault size transparent?

5. Minimum audit/telemetry scope
   - What minimum signals does the team need to assess security and usability without collecting content?
   - Should v1 include optional telemetry at all, or should everything remain strictly local/offline?

6. Interaction with future index/RAG plugins
   - How much should Kado v1 already prepare for later index/RAG plugins (abstracted search interface vs. direct Obsidian calls)?
   - Should an explicit extension point be defined, or will this be deferred to SDD/RFCs?

---

## Validation Checklist

**Critical gates**

- [x] All eight sections are filled out.
- [x] No [NEEDS CLARIFICATION] markers remain.
- [x] Problem Statement is specific and justified (AI access to Vaults without control, workarounds, security concerns).
- [x] All Must-Have features have testable acceptance criteria in Given/When/Then format.
- [x] No obvious contradictions between sections (Scope/Non-Goals, Constraints, Business Rules are consistent).

**Quality checks**

- [x] Problem is motivated by real usage scenarios and existing limitations, not just assumptions.
- [x] Primary persona (Knowledge Worker) has at least one user journey.
- [x] All MoSCoW categories (Must/Should/Could/Won't) are covered.
- [x] No technical implementation details (code, DB schema, API specs) in the PRD — these are reserved for the SDD.
- [x] A new team member can understand from this PRD what Kado v1 is supposed to accomplish and why.

---

## References

- [obsidian-translate](https://github.com/Fevol/obsidian-translate/tree/main) — Reference for plugin configuration UI in Obsidian; also has a GitHub Actions release workflow.
